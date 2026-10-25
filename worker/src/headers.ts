/** Security, indexing and caching headers, applied to every response in one place. */

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://tiles.openfreemap.org",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export interface HeaderOptions {
  https: boolean
  noindex: boolean
  path: string
  /** The whole site is behind a password. */
  siteProtected: boolean
  /** This response was served under some password. */
  underProtection: boolean
}

export function secureResponse(response: Response, options: HeaderOptions): Response {
  const secured = new Response(response.body, response)
  const headers = secured.headers
  headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)')
  if (options.https) headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  if (options.noindex) headers.set('X-Robots-Tag', 'noindex, nofollow')

  // Hashed build assets never change under the same name.
  if (options.path.startsWith('/_astro/') && response.ok) {
    headers.set('Cache-Control', `${options.siteProtected ? 'private' : 'public'}, max-age=31536000, immutable`)
  } else if (options.underProtection && headers.get('Content-Type')?.includes('text/html')) {
    headers.set('Cache-Control', 'private, no-cache')
  }
  return secured
}

export function robotsTxt(noindex: boolean): string {
  return noindex ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n'
}
