import { boot } from 'quasar/wrappers'
import { basePath } from '../base-path'


// Webpack bakes build.publicPath into its chunk loader, and in production that
// is the placeholder the backend only ever rewrites in index.html, sw.js and
// manifest.json -- never inside the JS bundles. Left alone, the first dynamic
// import (a Quasar language pack, the 404 page) would be requested from
// /__KIKO_BASE__/js/... and 404.
//
// This runs at module scope, and this boot file is listed first in
// quasar.config.js, so the loader is pointed at the real prefix before any
// other boot file's code can trigger a chunk load.
// eslint-disable-next-line no-undef
__webpack_public_path__ = `${basePath}/`

export default boot(() => {})
