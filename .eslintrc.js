module.exports = {
  globals: {
    cheerio: true,
    kintoneUIComponent: true
  },
  extends: '@cybozu/eslint-config/presets/kintone-customize-es5',
  rules: {
    'vars-on-top': 'off',
    'no-console': ['error', { allow: ['warn', 'error'] }]
  }
};
