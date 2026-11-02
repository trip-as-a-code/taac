/** Server-rendered pages: self-contained, no external assets, nothing from the build. */

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
strong{color:var(--text);font-weight:600}
.error{color:var(--danger);font-size:14px;margin:0 0 4px}
button,.button{display:flex;align-items:center;justify-content:center;gap:10px;box-sizing:border-box;width:100%;
margin-top:20px;font:inherit;font-weight:500;line-height:1.25;color:#fff;background:var(--accent);
border:0;border-radius:980px;padding:12px 20px;cursor:pointer;text-decoration:none;transition:background .15s,transform .1s}
.button svg{flex:none}
button:hover,.button:hover{background:var(--accent-press)}
.secondary{color:var(--accent);background:transparent;margin-top:8px}
.secondary:hover{background:color-mix(in srgb,var(--accent) 10%,transparent)}
button:active,.button:active{transform:scale(.98)}
button:focus-visible,.button:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 40%,transparent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`

const LOCK = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="currentColor"/><path d="M8 10.5V7.75a4 4 0 0 1 8 0v2.75" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`

/** The theme the viewer picked on the site (`taac_theme` cookie). */
export type Theme = 'light' | 'dark'

function page(lang: string, title: string, body: string, theme: Theme = 'dark'): string {
  return `<!doctype html><html lang="${escapeHtml(lang)}" data-theme="${theme}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main></body></html>`
}

const GITHUB = `<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`

export interface LoginPageOptions {
  lang: string
  title: string
  next: string
  /** Signing in went wrong last time. */
  error: boolean
  theme?: Theme
}

export function renderLoginPage(o: LoginPageOptions): string {
  const t = loginStrings(o.lang)
  const error = o.error ? `<p class="error" role="alert">${escapeHtml(t.error)}</p>` : ''
  const start = `/api/auth/github?next=${encodeURIComponent(o.next)}`
  return page(
    o.lang,
    o.title,
    `<div class="glyph">${LOCK}</div><h1>${escapeHtml(o.title)}</h1><p>${escapeHtml(t.lead)}</p>${error}
<a class="button" href="${escapeHtml(start)}">${GITHUB}<span>${escapeHtml(t.github)}</span></a>`,
    o.theme,
  )
}

export interface ForbiddenPageOptions {
  lang: string
  title: string
  login: string
  /** It's a trip page (else the whole site). */
  trip: boolean
  home: string
  theme?: Theme
}

export interface LinkGonePageOptions {
  lang: string
  title: string
  signIn: string
  theme?: Theme
}

/** A view-only link that expired or was revoked. */
export function renderLinkGonePage(o: LinkGonePageOptions): string {
  const t = loginStrings(o.lang)
  return page(
    o.lang,
    o.title,
    `<div class="glyph">${LOCK}</div><h1>${escapeHtml(t.linkGone)}</h1><p>${escapeHtml(t.linkGoneLead)}</p>
<a class="button" href="${escapeHtml(o.signIn)}">${GITHUB}<span>${escapeHtml(t.github)}</span></a>`,
    o.theme,
  )
}

/** Signed in, but this isn't theirs to see: say who they are, offer another account. */
export function renderForbiddenPage(o: ForbiddenPageOptions): string {
  const t = loginStrings(o.lang)
  const who = `<strong>@${escapeHtml(o.login)}</strong>`
  return page(
    o.lang,
    o.title,
    `<div class="glyph">${LOCK}</div><h1>${escapeHtml(o.title)}</h1><p>${(o.trip ? escapeHtml(t.notOnTrip) : escapeHtml(t.notOnSite)).replace('{login}', who)}</p>
${o.trip ? `<a class="button" href="${escapeHtml(o.home)}">${escapeHtml(t.home)}</a>` : ''}
<form method="post" action="/api/logout" data-astro-reload><button type="submit"${o.trip ? ' class="secondary"' : ''}>${escapeHtml(t.switch)}</button></form>`,
    o.theme,
  )
}
