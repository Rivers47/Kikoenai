// Configuration for your app
// https://quasar.dev/quasar-cli-webpack/quasar-config-js

// The server owns the deploy-time URL prefix (config.basePath), so the token it
// swaps in has to come from there rather than being spelled twice.
const { PUBLIC_PATH_TOKEN } = require('../backend/base-path')

module.exports = function (ctx) {
  return {
    // app boot file (/src/boot)
    // --> boot files are part of "main.js"
    // https://quasar.dev/quasar-cli-webpack/boot-files
    boot: [
      // Must stay first: it fixes webpack's chunk loader for the deploy path
      // prefix, before anything else can trigger a dynamic import.
      'base-path',
      'axios',
      'i18n',
      'store',
      'plyr',
      'socket.io',
      'contrast'
    ],

    // https://quasar.dev/quasar-cli-webpack/quasar-config-js#css
    css: [
      'app.scss'
    ],

    // https://github.com/quasarframework/quasar/tree/dev/extras
    extras: [
      'roboto-font',
      'material-icons'
    ],

    // https://quasar.dev/quasar-cli-webpack/quasar-config-js#framework
    framework: {
      iconSet: 'material-icons',
      lang: 'en-US',

      // 'auto' - Auto-import needed Quasar components & directives
      all: 'auto',

      components: [],
      directives: [],

      plugins: [
        'LocalStorage',
        'SessionStorage',
        'Notify',
        'Dialog',
      ],
      config: {
        dark: 'auto',
      },
    },

    // https://quasar.dev/quasar-cli-webpack/quasar-config-js#supportIE
    supportIE: false,

    // Full list of options: https://quasar.dev/quasar-cli-webpack/quasar-config-js#build
    build: {
      vueRouterMode: 'history',

      // One build, deployable at the root or under any sub-path.
      //
      // Every URL webpack and Quasar bake into index.html, sw.js and
      // manifest.json gets this placeholder instead of a real prefix; the
      // backend replaces it with config.basePath as it serves those three
      // files (backend/base-path.js). Anything the app builds at runtime reads
      // the prefix from window.__KIKO_BASE__ instead -- see src/base-path.js.
      //
      // Dev keeps '/': `quasar dev` serves from the root and does not go
      // through the backend, so there would be nothing to do the swap.
      publicPath: ctx.dev ? '/' : PUBLIC_PATH_TOKEN,

      // Output directly to the backend's dist/ so it's served as static content
      distDir: '../backend/dist',

      // rtl: false,
      // showProgress: false,
      // gzip: true,
      // analyze: true,

      // preloadChunks: false,
      // extractCSS: false,

      modern: true,
      sourceMap: true,
      devtool: 'source-map',
      minify: true,

      // Force the pure-JS `sass` compiler for .scss/.sass. sass-loader v16
      // otherwise auto-prefers `sass-embedded`, whose native binary ships as a
      // platform-specific optionalDependency that npm 11 mishandles on Windows
      // (npm/cli#8777, sass/embedded-host-node#404): `npm ci` silently skips
      // sass-embedded-win32-x64, sass-embedded falls back to pure-JS `sass`
      // with `--embedded`, and the build dies with "sass --embedded is
      // unavailable in pure JS mode". Passing the implementation as a string
      // makes sass-loader require('sass') in its own CJS context -- the
      // compiler runs in-process, with no native binary or platform package.
      scssLoaderOptions: { implementation: 'sass' },
      sassLoaderOptions: { implementation: 'sass' }
    },



    // Full list of options: https://quasar.dev/quasar-cli-webpack/quasar-config-js#devServer
    devServer: {
      https: false,
      port: 8080,
      open: true,
      proxy: [
        { context: '/api', target: 'http://localhost:8888' },
        { context: '/socket.io', target: 'http://localhost:8888', ws: true },
        { context: '/workbox', target: 'http://localhost:8888' },
      ],
    },

    animations: [],

    // https://quasar.dev/quasar-cli-webpack/developing-ssr/configuring-ssr
    ssr: {
      pwa: false
    },

    // https://quasar.dev/quasar-cli-webpack/developing-pwa/configuring-pwa
    pwa: {
      // InjectManifest, not GenerateSW: the offline-download feature needs
      // service-worker event handlers (Background Fetch), which a generated
      // worker cannot express. The worker is hand-written in
      // src-pwa/custom-service-worker.js -- caching routes, navigation
      // fallback, skipWaiting/clientsClaim all live there now.
      workboxMode: 'InjectManifest',
      extendManifestJson (json) {
        // Relative to the manifest's own URL, so an installed app scopes itself
        // to wherever it was installed from. Quasar's default start_url is
        // build.publicPath, which here is the unresolved placeholder.
        json.start_url = '.'
        json.scope = '.'
      },
      // Build-time only: what workbox-build puts into the injected precache
      // manifest. Runtime behaviour does NOT belong here anymore.
      extendInjectManifestOptions (opts) {
        opts.exclude = opts.exclude || []
        opts.exclude.push(/manifest\.json$/, /.*.js.map$/)
        if (ctx.dev) {
          // Webpack's HMR payloads are one-shot and hash-named: precaching them
          // serves stale hot updates, and their changing names rewrite the
          // manifest (and so sw.js) on every recompile, firing the "new
          // version" notification each time.
          opts.exclude.push(/\.hot-update\./)
        }
      },
      // The custom service worker is bundled by esbuild, not webpack/babel --
      // it is the only part of the app that is. Quasar's default browser
      // target includes `safari14`, and esbuild refuses to emit destructuring
      // for Safari 14.0 (a known engine bug it cannot lower), which the
      // workbox-* packages use throughout. Safari 14.1 fixed that bug, so
      // raising the floor for this bundle alone is enough. The app's own
      // target is untouched.
      extendPWACustomSWConf (esbuildConf) {
        esbuildConf.target = ['es2022', 'firefox115', 'chrome115', 'safari14.1']
      }
    },

    // Full list of options: https://quasar.dev/quasar-cli-webpack/developing-cordova-apps/configuring-cordova
    cordova: {
      id: 'org.cordova.quasar.kikoeru'
    },

    // Full list of options: https://quasar.dev/quasar-cli-webpack/developing-capacitor-apps/configuring-capacitor
    capacitor: {
      hideSplashscreen: true
    },

    // Full list of options: https://quasar.dev/quasar-cli-webpack/developing-electron-apps/configuring-electron
    electron: {
      bundler: 'packager',

      packager: {
        // https://github.com/electron-userland/electron-packager/blob/master/docs/api.md#options
      },

      builder: {
        appId: 'kikoeru-quasar'
      },

      nodeIntegration: true,

      extendWebpack (cfg) {
        // do something with Electron main process Webpack cfg
        // chainWebpack also available besides this extendWebpack
      }
    }
  }
}
