/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */

'use strict';

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
    browser: true,
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
    'one-var-declaration-per-line': 'error',
  },
};
