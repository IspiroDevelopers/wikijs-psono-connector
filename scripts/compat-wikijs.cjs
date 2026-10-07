// SPDX-License-Identifier: AGPL-3.0-only
//
// Runs inside an official Wiki.js 2.x image (see compat-wikijs.sh). Loads the
// built module from the path Wiki.js would use, runs it on the image's own
// cheerio, then through the image's own html-security renderer.
/* eslint-disable no-console */
const assert = require('assert')
const path = require('path')

const SERVER = '/wiki/server'
const cheerio = require('/wiki/node_modules/cheerio')
const security = require(path.join(SERVER, 'modules/rendering/html-security/renderer.js'))
const yaml = require('/wiki/node_modules/js-yaml')
const fs = require('fs')
const _ = require('/wiki/node_modules/lodash')

const moduleDir = path.join(SERVER, 'modules/rendering/html-psono-connector')
const def = yaml.safeLoad(fs.readFileSync(path.join(moduleDir, 'definition.yml'), 'utf8'))
// html-core loads children by kebab-case(key): the folder name must match.
assert.strictEqual(_.kebabCase(def.key), 'html-psono-connector')
assert.strictEqual(def.dependsOn, 'htmlCore')
const renderer = require(path.join(SERVER, 'modules/rendering', _.kebabCase(def.key), 'renderer.js'))
assert.strictEqual(typeof renderer.init, 'function')

const ID = '0b6c9a3e-1f2d-4c5b-8a7e-9d0c1b2a3f4e'
const LINK = `https://psono.example.com/index.html#!/datastore/search/${ID}`
const html = `<p><a href="${LINK}">ok</a> <a href="https://psono.example.com.evil.example/index.html#!/datastore/search/${ID}">evil</a></p><pre><code><a href="${LINK}">code</a></code></pre>`

;(async () => {
  const $ = cheerio.load(html, { decodeEntities: true })
  await renderer.init($, { psonoWebBaseUrl: 'https://psono.example.com', allowHttp: false })
  const body = $.html('body').replace('<body>', '').replace('</body>', '')
  const out = await security.init(body, { safeHTML: true, allowDrawIoUnsafe: true, allowIFrames: false })
  const $o = cheerio.load(out)
  const marked = $o('a[data-psono-secret-id]')
  assert.strictEqual(marked.length, 1, 'exactly one link marked')
  assert.strictEqual(marked.attr('data-psono-secret-id'), ID)
  assert.strictEqual(marked.attr('href'), LINK)
  assert.ok(marked.hasClass('psono-connector-link'))
  const version = require('/wiki/package.json').version
  console.log(`OK  Wiki.js ${version} (node ${process.version}): module loads, marker survives html-security`)
})().catch((err) => {
  console.error('FAIL', err && err.message)
  process.exit(1)
})
