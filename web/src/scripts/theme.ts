// Light or dark, as the viewer chose: remembered on this device and in a
// cookie, so the worker's login page matches.

const KEY = 'taac:theme'
export type Theme = 'light' | 'dark'

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

export function onTheme(listener: (theme: Theme) => void): () => void {
  const handler = () => listener(currentTheme())
  document.addEventListener('taac:theme', handler)
  return () => document.removeEventListener('taac:theme', handler)
}

export function toggleTheme() {
  const theme: Theme = currentTheme() === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#000000' : '#f5f5f7')
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Not remembered; this page still switches.
  }
  document.cookie = `taac_theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`
  document.dispatchEvent(new CustomEvent('taac:theme'))
}
