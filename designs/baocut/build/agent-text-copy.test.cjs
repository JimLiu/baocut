const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {buildSync} = require('esbuild');

const result = buildSync({
  stdin: {
    contents: "export * from '../app/i18n/agent-text-copy.ts'; export {LOCALES} from '../../../packages/protocol/src/i18n.ts';",
    resolveDir: __dirname,
  },
  bundle: true, write: false, format: 'cjs', platform: 'browser', target: 'es2022',
});
const moduleValue = {exports: {}};
vm.runInNewContext(result.outputFiles[0].text, {module: moduleValue, exports: moduleValue.exports, Intl});
const {messagesFor, translations, LOCALES} = moduleValue.exports;

test('Agent text copy covers every shipping locale with the English catalogue shape', () => {
  const english = messagesFor('en');
  const keys = Object.keys(english).sort();
  assert.equal(Object.keys(translations).length + 1, LOCALES.length);
  for (const locale of LOCALES) {
    if (locale !== 'en') assert.deepEqual(Object.keys(translations[locale]).sort(), keys);
    const messages = messagesFor(locale);
    for (const key of keys) {
      assert.equal(typeof messages[key], typeof english[key], `${locale}.${key}`);
      if (typeof messages[key] === 'string') assert.ok(messages[key].trim(), `${locale}.${key}`);
    }
    assert.ok(messages.agentModel('CLI').includes('CLI'));
    assert.ok(messages.unavailable('CLI', messages.disabled).includes(messages.disabled));
    assert.ok(messages.attached('file.md').includes('file.md'));
    assert.ok(messages.tooLong(17000, 16000).trim());
  }
});

test('Agent text copy follows prototype language preferences and falls back to English', () => {
  const live = messagesFor('English');
  assert.equal(live.method, 'Generation method');
  messagesFor('简体中文');
  assert.equal(live.method, '生成方式');
  assert.equal(messagesFor('繁體中文').method, '生成方式');
  assert.equal(messagesFor('system', ['zh-HK']).agent, '已登入 Agent');
  assert.equal(messagesFor('system', ['zz-Unknown']).method, 'Generation method');
  assert.equal(messagesFor('system', ['pt-PT']).method, messagesFor('pt-BR').method);
});
