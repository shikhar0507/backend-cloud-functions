module.exports = {
  parserOptions: {
    ecmaVersion: 2017,
    ecmaFeatures: {
      arrowFunctions: true,
      forOf: true,
      templateStrings: true,
      spread: true,
    },
  },
  extends: ['eslint:recommended', 'prettier'],
  env: {
    // Node.js global variables and Node.js scoping
    node: true,
    // defines `require()` and `define()` as global variables as per the amd spec
    amd: true,
    // enable all ECMAScript 6 features except for modules.
    es6: true,
    // adds all of the Mocha testing global variables
    mocha: true,
  },
  rules: {
    'no-console': 'off', // It's node. How else do you even print?
    semi: 'warn',
    'no-undef': 'error',
    'no-use-before-define': 'error',
    'no-prototype-builtins': 'off',
    'require-atomic-updates': 'off',
    'prefer-const': 'error',
  },
};
