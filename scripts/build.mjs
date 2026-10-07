// SPDX-License-Identifier: AGPL-3.0-only
//
// Builds the three deliverables:
//   dist/wikijs-module/html-psono-connector/   Wiki.js rendering module (bind-mount it)
//   dist/sidecar/main.cjs                      sidecar, bundled with its dependencies
//   dist/sidecar/client/{client.js,settings.html}  browser bundle served by the sidecar

import { build } from 'esbuild'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const banner = (src) => `// SPDX-License-Identifier: AGPL-3.0-only\n// ${pkg.name} ${pkg.version} — generated file, do not edit. Source: ${src}`
const moduleDir = 'dist/wikijs-module/html-psono-connector'

await rm('dist', { recursive: true, force: true })
await mkdir(moduleDir, { recursive: true })
await mkdir('dist/sidecar/client', { recursive: true })

// --- Wiki.js rendering module -------------------------------------------
await build({
  entryPoints: ['src/renderer/index.ts'],
  outfile: `${moduleDir}/renderer.js`,
  bundle: true,
  platform: 'node',
  // Wiki.js 2.5.170 ships Node 14 (oldest image tested).
  target: 'node14',
  format: 'cjs',
  legalComments: 'inline',
  banner: { js: banner('src/renderer/index.ts') },
})
await cp('wikijs-module/html-psono-connector/definition.yml', `${moduleDir}/definition.yml`)
await cp('LICENSE', `${moduleDir}/LICENSE`)
await writeFile(`${moduleDir}/VERSION`, `${pkg.version}\n`)

// --- Sidecar ---------------------------------------------------------------
await build({
  entryPoints: ['src/sidecar/main.ts'],
  outfile: 'dist/sidecar/main.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // Optional native binding of `pg`; the pure-JS client is used.
  external: ['pg-native'],
  legalComments: 'linked',
  banner: { js: banner('src/sidecar/main.ts') },
})

// --- Browser bundle --------------------------------------------------------
await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'dist/sidecar/client/client.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2020', 'chrome100', 'firefox100', 'safari15'],
  minify: true,
  legalComments: 'none',
  banner: { js: banner('src/client/index.ts') },
})
await cp('src/client/static/settings.html', 'dist/sidecar/client/settings.html')

console.log('Built dist/wikijs-module, dist/sidecar')
