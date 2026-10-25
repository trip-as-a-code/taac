import { describe, expect, it } from 'vitest'

import { renderLoginPage } from './login-page'

describe('login page', () => {
  it('escapes everything it echoes and localises', () => {
    const page = renderLoginPage({
      lang: 'ru',
      title: '<Trip>',
      scope: 'trip:japan',
      next: '/"><script>',
      error: true,
      trip: true,
    })
    expect(page).toContain('&lt;Trip&gt;')
    expect(page).not.toContain('<script>')
    expect(page).toContain('Эта поездка закрыта')
    expect(page).toContain('autocomplete="current-password"')
    expect(page).toContain('role="alert"')
    expect(page).not.toMatch(/<(link|script)\b/)
  })
})
