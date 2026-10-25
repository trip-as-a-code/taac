/** Worker-rendered pages: self-contained, no external assets, nothing from the build. */

import { loginStrings } from './i18n'

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const STYLE = `
:root{color-scheme:light;--bg:#f5f5f7;--card:#fff;--text:#1d1d1f;--muted:#6e6e73;--line:#d2d2d7;
--field:#fff;--accent:#0071e3;--accent-press:#0062c4;--danger:#d70015;--shadow:0 12px 40px rgba(0,0,0,.08),0 2px 6px rgba(0,0,0,.04)}
:root[data-theme=dark]{color-scheme:dark;--bg:#000;--card:#1c1c1e;--text:#f5f5f7;--muted:#98989d;--line:#38383a;
--field:#2c2c2e;--accent:#0a84ff;--accent-press:#409cff;--danger:#ff453a;--shadow:0 12px 40px rgba(0,0,0,.5)}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--text);
font:17px/1.47 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:380px;background:var(--card);border-radius:20px;box-shadow:var(--shadow);padding:40px 28px 32px;text-align:center;
animation:rise .45s cubic-bezier(.2,.8,.2,1)}
@keyframes rise{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){main{animation:none}}
.glyph{width:56px;height:56px;margin:0 auto 18px;border-radius:16px;display:grid;place-items:center;
background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent)}
h1{font-size:28px;line-height:1.14;font-weight:600;letter-spacing:-.015em;margin:0 0 8px;overflow-wrap:anywhere}
p{margin:0 0 24px;color:var(--muted);font-size:15px}
label{display:block;text-align:left;font-size:13px;font-weight:500;color:var(--muted);margin:0 0 6px 4px}
input[type=password]{width:100%;font:inherit;color:var(--text);background:var(--field);border:1px solid var(--line);
border-radius:12px;padding:12px 14px;outline:none;transition:border-color .15s,box-shadow .15s}
input[type=password]:focus{border-color:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 22%,transparent)}
input[aria-invalid=true]{border-color:var(--danger)}
.error{color:var(--danger);font-size:14px;text-align:left;margin:8px 0 0 4px}
button,.button{display:block;width:100%;margin-top:20px;font:inherit;font-weight:500;color:#fff;background:var(--accent);
border:0;border-radius:980px;padding:12px 20px;cursor:pointer;text-decoration:none;transition:background .15s,transform .1s}
button:hover,.button:hover{background:var(--accent-press)}
button:active,.button:active{transform:scale(.98)}
button:focus-visible,.button:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 40%,transparent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`

const LOCK = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="currentColor"/><path d="M8 10.5V7.75a4 4 0 0 1 8 0v2.75" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`

/** The theme the viewer picked on the site (`taac_theme` cookie). */
export type Theme = 'light' | 'dark'

function page(lang: string, title: string, body: string, theme: Theme = 'light'): string {
  return `<!doctype html><html lang="${escapeHtml(lang)}" data-theme="${theme}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main></body></html>`
}

export interface LoginPageOptions {
  lang: string
  title: string
  scope: string
  next: string
  error: boolean
  trip: boolean
  theme?: Theme
}

export function renderLoginPage(o: LoginPageOptions): string {
  const t = loginStrings(o.lang)
  const error = o.error ? `<div class="error" id="error" role="alert">${escapeHtml(t.error)}</div>` : ''
  return page(
    o.lang,
    o.title,
    `<div class="glyph">${LOCK}</div><h1>${escapeHtml(o.title)}</h1><p>${escapeHtml(o.trip ? t.tripLead : t.siteLead)}</p>
<form method="post" action="/api/login"><input type="hidden" name="scope" value="${escapeHtml(o.scope)}">
<input type="hidden" name="next" value="${escapeHtml(o.next)}"><label for="password">${escapeHtml(t.password)}</label>
<input id="password" name="password" type="password" autocomplete="current-password" autofocus required${o.error ? ' aria-invalid="true" aria-describedby="error"' : ''}>${error}
<button type="submit">${escapeHtml(t.submit)}</button></form>`,
    o.theme,
  )
}

export function renderTooManyAttempts(lang: string, back: string, theme?: Theme): string {
  const t = loginStrings(lang)
  return page(
    lang,
    t.tooManyTitle,
    `<div class="glyph">${LOCK}</div><h1>${escapeHtml(t.tooManyTitle)}</h1><p>${escapeHtml(t.tooManyBody)}</p>
<a class="button" href="${escapeHtml(back)}">${escapeHtml(t.back)}</a>`,
    theme,
  )
}
