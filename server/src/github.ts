/**
 * Signing in with GitHub (a GitHub App's user authorization, no permissions):
 * send the browser to GitHub, then trade the code it brings back for the
 * account's username. Nothing else is asked of GitHub or kept.
 */

export interface GithubApp {
  clientId: string
  clientSecret: string
}

export interface GithubUser {
  /** Lowercase username. */
  login: string
}

export function authorizeUrl(app: GithubApp, redirectUri: string, state: string): string {
  const params = new URLSearchParams({ client_id: app.clientId, redirect_uri: redirectUri, state })
  return `https://github.com/login/oauth/authorize?${params}`
}

/** The account behind an authorization `code`, or null when GitHub says no. */
export async function userFor(
  app: GithubApp,
  code: string,
  redirectUri: string,
  fetcher: typeof fetch = fetch,
): Promise<GithubUser | null> {
  const token = await fetcher('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })
  if (!token.ok) return null
  const { access_token: accessToken } = (await token.json()) as { access_token?: string }
  if (!accessToken) return null
  const user = await fetcher('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'taac',
    },
  })
  if (!user.ok) return null
  const { login } = (await user.json()) as { login?: string }
  return typeof login === 'string' && login ? { login: login.toLowerCase() } : null
}
