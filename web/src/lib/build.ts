import rates from 'virtual:taac/rates'
import changes from 'virtual:taac/changes'
import site from 'virtual:taac/site'

/** Changes on every build; the page compares it with `/build.json` to offer a reload. */
export const buildId = process.env.TAAC_BUILD_ID ?? `${Date.now().toString(36)}`

export { changes, rates, site }
