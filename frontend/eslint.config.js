const pluginVue = require('eslint-plugin-vue');
const globals = require('globals');

module.exports = [
  // Ignore generated directories and config files
  {
    ignores: ['dist/', '.quasar/', '.postcssrc.js', 'babel.config.js', 'quasar.config.js'],
  },
  // eslint:recommended base rules
  {
    rules: {
      ...require('@eslint/js').configs.recommended.rules,
    },
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.node,
      },
    },
  },
  // Vue 3 essential rules
  ...pluginVue.configs['flat/essential'],
  // Project-specific rules and overrides
  {
    rules: {
      'no-unused-vars': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/no-deprecated-v-bind-sync': 'off',
      'vue/no-reserved-keys': 'off',
    },
  },
];