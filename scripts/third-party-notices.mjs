// SPDX-License-Identifier: AGPL-3.0-only
//
// Prints the licenses of every production dependency bundled into the sidecar.
// Run after `npm ci`; output goes into the container image.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json', '--long'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
const seen = new Map()
;(function walk(deps) {
  for (const [name, info] of Object.entries(deps ?? {})) {
    if (info.path && !seen.has(`${name}@${info.version}`)) seen.set(`${name}@${info.version}`, { name, ...info })
    walk(info.dependencies)
  }
})(tree.dependencies)

const out = ['Third-party software bundled in wikijs-psono-connector', '='.repeat(56), '']
for (const [id, info] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
  const pkg = JSON.parse(readFileSync(join(info.path, 'package.json'), 'utf8'))
  const licenseFile = existsSync(info.path)
    ? readdirSync(info.path).find((f) => /^(licen[cs]e|copying|unlicense)(\.|$)/i.test(f))
    : undefined
  out.push('-'.repeat(72), `${id}`, `License: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? 'UNKNOWN')}`)
  if (pkg.repository) out.push(`Source: ${typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url}`)
  out.push('')
  out.push(licenseFile ? readFileSync(join(info.path, licenseFile), 'utf8').trim() : '(no license file shipped in the package)')
  out.push('')
}
process.stdout.write(out.join('\n') + '\n')
