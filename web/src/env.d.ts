/// <reference types="astro/client" />

declare module 'virtual:taac/site' {
  const site: import('@taac/core').SiteExport
  export default site
}
