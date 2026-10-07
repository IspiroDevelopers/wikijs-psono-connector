// SPDX-License-Identifier: AGPL-3.0-only
//
// Command line helpers shipped in the sidecar image:
//   node main.cjs print-server-pin     print the Psono server's verify key
//   node main.cjs install-module DIR   copy the Wiki.js rendering module to DIR
//   node main.cjs doctor               check the deployment
// Without a command the sidecar starts.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { formatFindings, runDoctor } from './doctor'
import { fetchServerInfo } from './psono/server-identity'

export const COMMANDS = ['print-server-pin', 'install-module', 'doctor'] as const

export const HELP = `Wiki.js Psono Connector

Usage: node main.cjs [command]

  (none)                   start the sidecar
  print-server-pin         print PSONO_SERVER_VERIFY_KEY for $PSONO_API_BASE_URL
  install-module <dir>     copy the Wiki.js rendering module into <dir>/html-psono-connector
  doctor                   check configuration, database, Wiki.js, Psono and the proxy
  --help                   this text
`

export async function printServerPin(): Promise<void> {
  const raw = process.env.PSONO_API_BASE_URL?.trim()
  if (!raw) {
    console.error('Set PSONO_API_BASE_URL (e.g. https://psono.example.com/server) and run again.')
    process.exit(2)
  }
  const apiBaseUrl = raw.replace(/\/+$/, '')
  if (!apiBaseUrl.startsWith('https://') && process.env.PSONO_CONNECTOR_ALLOW_HTTP !== 'true') {
    console.error('PSONO_API_BASE_URL must use https:// (set PSONO_CONNECTOR_ALLOW_HTTP=true for development only).')
    process.exit(2)
  }
  const info = await fetchServerInfo(apiBaseUrl, 8000)
  if ('error' in info) {
    console.error(info.error === 'unavailable' ? 'Psono server not reachable.' : 'The server did not return a validly signed /info/ document.')
    process.exit(1)
  }
  console.log(`PSONO_SERVER_VERIFY_KEY=${info.verifyKey}`)
  console.error('Trust on first use: compare this value with the "server signature" in the Psono web client (Other → API keys) before using it.')
}

/** Copies the module folder; returns the destination. Replaces an older copy. */
export function installModule(targetDir: string, sourceDir = join(__dirname, 'wikijs-module', 'html-psono-connector')): string {
  if (!existsSync(join(sourceDir, 'renderer.js'))) throw new Error(`Module files not found in ${sourceDir}`)
  const destination = join(resolve(targetDir), 'html-psono-connector')
  mkdirSync(resolve(targetDir), { recursive: true })
  rmSync(destination, { recursive: true, force: true })
  cpSync(sourceDir, destination, { recursive: true })
  return destination
}

export function runInstallModule(targetDir: string | undefined): void {
  if (!targetDir) {
    console.error('Usage: node main.cjs install-module <target directory>')
    process.exit(2)
  }
  try {
    const destination = installModule(targetDir)
    const version = readFileSync(join(destination, 'VERSION'), 'utf8').trim()
    console.log(`Installed module version ${version} to ${destination}`)
    console.log('Mount it read-only into the Wiki.js container:')
    console.log('  - ./modules/html-psono-connector:/wiki/server/modules/rendering/html-psono-connector:ro')
  } catch (err) {
    console.error(`Could not install the module: ${(err as Error).message}`)
    process.exit(1)
  }
}

export async function runDoctorCommand(): Promise<void> {
  const findings = await runDoctor(process.env)
  console.log(formatFindings(findings))
  process.exit(findings.some((f) => f.level === 'fail') ? 1 : 0)
}
