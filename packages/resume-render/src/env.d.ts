/**
 * Font files are imported for their URL. Declared locally so the package does
 * not have to depend on vite just for `vite/client`.
 */
declare module "*.ttf?url" {
  const url: string
  export default url
}
