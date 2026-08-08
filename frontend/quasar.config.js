// Configuration for your app
// https://quasar.dev/quasar-cli-webpack/quasar-config-js

module.exports = function (ctx) {
  return {
    // app boot file (/src/boot)
    // --> boot files are part of "main.js"
    // https://quasar.dev/quasar-cli-webpack/boot-files
    boot: [
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
      workboxMode: 'GenerateSW',
      extendGenerateSWOptions (opts) {
        opts.skipWaiting = true
        opts.clientsClaim = true
        opts.exclude = opts.exclude || []
        opts.exclude.push(/manifest\.json$/, /.*.js.map$/)
        opts.navigateFallbackDenylist = opts.navigateFallbackDenylist || []
        opts.navigateFallbackDenylist.push(
          /^\/api\/.*$/,
          /\/media\/.*$/
        )
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
