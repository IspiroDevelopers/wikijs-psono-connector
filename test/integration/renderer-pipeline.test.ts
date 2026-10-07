// SPDX-License-Identifier: AGPL-3.0-only
//
// Runs the renderer the way Wiki.js 2.5 does: on a cheerio 1.0.0-rc.5 DOM,
// followed by DOMPurify 3.3.1 configured like modules/rendering/html-security.
// The real-image check lives in scripts/compat-wikijs.sh.
import { describe, expect, it } from 'vitest'
import cheerio from 'cheerio'
import createDOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import { init, LINK_CLASS, SECRET_ID_ATTR } from '../../src/renderer/index'

const ID = '0b6c9a3e-1f2d-4c5b-8a7e-9d0c1b2a3f4e'
const LINK = `https://psono.example.com/index.html#!/datastore/search/${ID}`
const config = { psonoWebBaseUrl: 'https://psono.example.com', allowHttp: false }

function sanitizeLikeWikiJs(html: string): string {
  const DOMPurify = createDOMPurify(new JSDOM('').window as never)
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['v-pre', 'v-slot:tabs', 'v-slot:content', 'target'],
    ADD_TAGS: ['tabset', 'template'],
  }) as string
}

async function render(html: string, cfg: Parameters<typeof init>[1] = config): Promise<string> {
  const $ = cheerio.load(html, { decodeEntities: true })
  await init($ as never, cfg)
  const body = $.html('body').replace('<body>', '').replace('</body>', '')
  return sanitizeLikeWikiJs(body)
}

function anchors(html: string) {
  const $ = cheerio.load(html)
  return $('a')
    .toArray()
    .map((el) => ({
      href: $(el).attr('href'),
      cls: $(el).attr('class'),
      id: $(el).attr(SECRET_ID_ATTR),
      text: $(el).text(),
    }))
}

describe('renderer + Wiki.js sanitizer', () => {
  it('marks a Psono link and the marker survives sanitization', async () => {
    const out = await render(`<p>See <a href="${LINK}">DB admin</a></p>`)
    expect(anchors(out)).toEqual([{ href: LINK, cls: LINK_CLASS, id: ID, text: 'DB admin' }])
  })

  it('keeps existing classes (e.g. markdown-it autolinks)', async () => {
    const out = await render(`<p><a href="${LINK}" class="foo">${LINK}</a></p>`)
    expect(anchors(out)[0]?.cls).toBe(`foo ${LINK_CLASS}`)
  })

  it('leaves other links untouched', async () => {
    const html = `<p><a href="https://psono.example.com.attacker.example/index.html#!/datastore/search/${ID}">x</a> <a href="https://example.org">y</a></p>`
    const out = await render(html)
    expect(anchors(out).every((a) => a.cls === undefined && a.id === undefined)).toBe(true)
  })

  it('does not touch links inside code blocks or inline code', async () => {
    const out = await render(`<pre><code><a href="${LINK}">a</a></code></pre><p><code><a href="${LINK}">b</a></code></p>`)
    expect(anchors(out).every((a) => a.id === undefined)).toBe(true)
  })

  it('does not transform plain-text URLs', async () => {
    const out = await render(`<p>${LINK}</p>`)
    expect(out).not.toContain(SECRET_ID_ATTR)
  })

  it('never transforms link-share URLs', async () => {
    const share = `https://psono.example.com/link-share-access.html#!/link-share-access/${ID}/secret/srv`
    const out = await render(`<p><a href="${share}">s</a></p>`)
    expect(out).not.toContain(SECRET_ID_ATTR)
  })

  it('is a no-op when no Psono URL is configured', async () => {
    const out = await render(`<p><a href="${LINK}">x</a></p>`, {})
    expect(out).not.toContain(SECRET_ID_ATTR)
  })

  it('is a no-op (and does not throw) on an invalid setting', async () => {
    const out = await render(`<p><a href="${LINK}">x</a></p>`, { psonoWebBaseUrl: 'http://psono.example.com' })
    expect(out).not.toContain(SECRET_ID_ATTR)
  })

  it('cannot be abused to inject markup via the href', async () => {
    const evil = `https://psono.example.com/index.html#!/datastore/search/${ID}"><img src=x onerror=alert(1)>`
    const out = await render(`<p><a href='${evil}'>x</a></p>`)
    // The payload may survive only as inert, escaped text inside href.
    const $ = cheerio.load(out)
    expect($('img').length).toBe(0)
    expect($('[onerror]').length).toBe(0)
    expect(out).not.toContain(SECRET_ID_ATTR)
  })
})
