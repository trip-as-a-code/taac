/// <reference types="astro/client" />

declare module 'virtual:taac/site' {
  const site: import('@taac/core').SiteExport
  export default site
}

declare module 'virtual:taac/rates' {
  const rates: import('@taac/core').Rates | null
  export default rates
}
