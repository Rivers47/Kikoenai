const nodePlugin = require('eslint-plugin-n');

module.exports = [
  // Ignore dist directory
  {
    ignores: ['dist/'],
  },
  // Main configuration
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: {
        __dirname: 'readonly',
        __filename: 'readonly',
        exports: 'writable',
        module: 'readonly',
        require: 'readonly',
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
    plugins: {
      n: nodePlugin,
    },
    rules: {
      // eslint:recommended base rules
      'no-prototype-builtins': 'off',
      'no-process-exit': 'off',
      'semi': 'error',
      // eslint-plugin-n recommended rules
      ...nodePlugin.configs['flat/recommended'].rules,
      // Overrides after spread
      'n/no-process-exit': 'off',
      'n/no-unsupported-features/node-builtins': 'off',
      'n/no-unsupported-features/es-syntax': 'off',
    },
  },
  // Allow unpublished require in eslint config
  {
    files: ['eslint.config.js'],
    rules: {
      'n/no-unpublished-require': 'off',
    },
  },
];