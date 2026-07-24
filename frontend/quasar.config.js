// Configuration for your app
// https://quasar.dev/quasar-cli-webpack/quasar-config-js

module.exports = function (ctx) {
  return {
    // app boot file (/src/boot)
    // --> boot files are part of "main.js"
    // https://quasar.dev/quasar-cli-webpack/boot-files
    boot: [
      'axios',
      'store',
      'slider',
      'plyr',
      'socket.io'
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

      // rtl: false,
      // showProgress: false,
      // gzip: true,
      // analyze: true,

      // preloadChunks: false,
      // extractCSS: false,

      modern: true,
      sourceMap: true,
      devtool: 'source-map',
      minify: true
    },



    // Full list of options: https://quasar.dev/quasar-cli-webpack/quasar-config-js#devServer
    devServer: {
      https: false,
      port: 8080,
      open: true,
      proxy: {
        '/api': 'http://localhost:8888',
        '/socket.io': {
          target: 'http://localhost:8888',
          ws: true
        },
        '/workbox': 'http://localhost:8888',
      },
    },

    animations: [],

    // https://quasar.dev/quasar-cli-webpack/developing-ssr/configuring-ssr
    ssr: {
      pwa: false
    },

    // https://quasar.dev/quasar-cli-webpack/developing-pwa/configuring-pwa
    pwa: {
      workboxMode: 'GenerateSW',
      workboxOptions: {
        skipWaiting: true,
        clientsClaim: true,
        exclude: [
          /manifest\.json$/,
          /.*.js.map$/
        ],
        navigateFallbackBlacklist: [
          /^\/api\/.*$/,
          /\/media\/.*$/
        ],
        importWorkboxFrom: 'local'
      },
      manifest: {
        name: 'Kikoeru',
        short_name: 'Kikoeru',
        description: 'A self-hosted web media player for listening to your DLsite voice works.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#027be3',
        icons: [
          {
            src: 'statics/icons/icon-128x128.png',
            sizes: '128x128',
            type: 'image/png'
          },
          {
            src: 'statics/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'statics/icons/icon-256x256.png',
            sizes: '256x256',
            type: 'image/png'
          },
          {
            src: 'statics/icons/icon-384x384.png',
            sizes: '384x384',
            type: 'image/png'
          },
          {
            src: 'statics/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
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
