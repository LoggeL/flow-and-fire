// @ts-check
import determinism from './rules/determinism.js';

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: { name: '@faf/eslint-plugin-sim', version: '0.0.0' },
  rules: {
    determinism,
  },
};

export default plugin;
