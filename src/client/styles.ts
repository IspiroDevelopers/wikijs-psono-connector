// SPDX-License-Identifier: AGPL-3.0-only

export const STYLES = `
:host {
  --pc-bg: #f7f8fa; --pc-fg: #1d2330; --pc-muted: #5b6475; --pc-border: #d9dde5;
  --pc-accent: #1565c0; --pc-btn-bg: #ffffff; --pc-btn-hover: #eef2f7; --pc-warn-bg: #fff6e5; --pc-warn-fg: #6b4a00;
  --pc-err-bg: #fdecec; --pc-err-fg: #8a1c1c; --pc-focus: #1565c0;
  display: block; margin: 0.75em 0; font: inherit; color: var(--pc-fg);
}
:host([data-theme="dark"]) {
  --pc-bg: #23272f; --pc-fg: #e6e9ef; --pc-muted: #a3abba; --pc-border: #3a404c;
  --pc-accent: #64b5f6; --pc-btn-bg: #2c313b; --pc-btn-hover: #353b47; --pc-warn-bg: #3a3220; --pc-warn-fg: #f3d58c;
  --pc-err-bg: #3d2224; --pc-err-fg: #f4b3b3; --pc-focus: #90caf9;
}
* { box-sizing: border-box; }
.card { background: var(--pc-bg); border: 1px solid var(--pc-border); border-radius: 6px; padding: 0.75em 1em; max-width: 46em; }
.head { display: flex; align-items: center; gap: 0.5em; margin-bottom: 0.5em; flex-wrap: wrap; }
.icon { width: 1.1em; height: 1.1em; flex: none; color: var(--pc-accent); }
.title { font-weight: 600; flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.muted { color: var(--pc-muted); }
dl { display: grid; grid-template-columns: max-content minmax(0, 1fr) auto; gap: 0.35em 0.75em; margin: 0; align-items: center; }
dt { color: var(--pc-muted); font-size: 0.9em; }
dd { margin: 0; overflow-wrap: anywhere; min-width: 0; }
dd.value { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
dd.notes { grid-column: 2 / 4; white-space: pre-wrap; font-family: inherit; }
.actions { display: flex; gap: 0.35em; justify-content: flex-end; flex-wrap: wrap; }
button, .btn { font: inherit; font-size: 0.85em; line-height: 1.2; padding: 0.3em 0.7em; border-radius: 4px; border: 1px solid var(--pc-border);
  background: var(--pc-btn-bg); color: var(--pc-fg); cursor: pointer; text-decoration: none; display: inline-block; }
button:hover, .btn:hover { background: var(--pc-btn-hover); }
button:focus-visible, .btn:focus-visible, input:focus-visible { outline: 2px solid var(--pc-focus); outline-offset: 2px; }
button[disabled] { opacity: 0.6; cursor: default; }
.otp { font-size: 1.15em; letter-spacing: 0.08em; }
.countdown { font-size: 0.8em; color: var(--pc-muted); margin-left: 0.5em; font-family: inherit; letter-spacing: 0; }
.msg { padding: 0.5em 0.75em; border-radius: 4px; background: var(--pc-warn-bg); color: var(--pc-warn-fg); margin: 0.25em 0; }
.msg.error { background: var(--pc-err-bg); color: var(--pc-err-fg); }
.msg.alert { border: 2px solid currentColor; font-size: 1.02em; padding: 0.75em 1em; margin-bottom: 0.9em; }
.row { display: flex; gap: 0.5em; align-items: center; flex-wrap: wrap; margin-top: 0.5em; }
.skeleton { height: 0.9em; border-radius: 3px; background: var(--pc-border); width: 60%; margin: 0.4em 0; animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }
form { display: grid; gap: 0.6em; }
label { display: grid; gap: 0.2em; font-size: 0.9em; }
input { font: inherit; padding: 0.4em 0.5em; border-radius: 4px; border: 1px solid var(--pc-border); background: var(--pc-btn-bg); color: var(--pc-fg);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; width: 100%; }
dialog { border: 1px solid var(--pc-border); border-radius: 8px; padding: 1.2em; max-width: min(36em, 92vw); background: var(--pc-bg); color: var(--pc-fg); }
dialog::backdrop { background: rgba(0, 0, 0, 0.45); }
h2 { font-size: 1.1em; margin: 0 0 0.6em; }
p { margin: 0 0 0.6em; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`

export const KEY_ICON =
  'M7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm5.65-4A6 6 0 1 0 12.65 14H17v4h4v-4h2v-4H12.65Z'
