const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./model-languages.js');
// v3 的显示目录仍在原型；识别能力对拍当前 Model Worker，而不是已移除的 bcut-lang。
const rust = fs.readFileSync(path.join(__dirname, '../../../crates/model-runtime/src/speech/language.rs'), 'utf8');
test('显示目录语言唯一，翻译目录是前 31 条且名字完整', () => {
  assert.equal(L.all.length, 103);
  assert.equal(new Set(L.all.map(row => row.code)).size, 103);
  assert.ok(L.all.every(row => row.name && row.native));
  assert.equal(L.TRANSLATE_LEN, 31);
  assert.deepEqual(L.translate, L.all.slice(0, 31));
  assert.equal(L.languages, L.translate);
});
test('语音识别能力与当前 Model Worker 一致，所有能力引用现有语言', () => {
  const section = name => rust.split(`pub const ${name}:`)[1].split('];')[0];
  const whisper = [...section('WHISPER_LANGUAGES').matchAll(/"([^"\n]+)"/g)].map(([,code]) => code);
  const qwen = [...section('QWEN_LANGUAGES').matchAll(/\("([^"\n]+)",/g)].map(([,code]) => code);
  assert.deepEqual(L.whisper, whisper);
  assert.deepEqual(L.qwen, qwen);
  for (const set of [L.whisper, L.qwen, L.dub, ...L.ttsEngines.map(e => e.langs)]) {
    assert.equal(new Set(set).size, set.length);
    for (const code of set) assert.ok(L.all.some(l => l.code === code), code);
  }
  assert.equal(L.ttsLangs('nope'), L.ttsEngines[0].langs);
});
test('speech-model canonicalization folds scripts and ISO-639-2/3 spellings', () => {
  assert.equal(L.asrCanon('zh-Hant'), 'zh');
  assert.equal(L.asrCanon('zh_CN'), 'zh');
  assert.equal(L.asrCanon('cmn'), 'zh');
  assert.equal(L.asrCanon('jv'), 'jw');
  assert.equal(L.asrCanon('ja'), 'ja');
});
test('display lookup reaches the speech-only rows the translation catalog does not carry', () => {
  assert.equal(L.native('yue'), '粵語');
  assert.equal(L.native('zh-TW'), '繁體中文');
  assert.equal(L.native('en-US'), 'English');
  assert.equal(L.native('xx'), 'xx', '认不出的 code 原样显示，不落到目录首项');
});
test('search supports native name, English, code and accents', () => {
  for (const query of ['日本', 'JAPANESE', 'ja']) assert.equal(L.groups(query, []).flatMap(g => g.items)[0].code, 'ja');
  assert.equal(L.groups('francais', [])[1].items[0].code, 'fr');
  assert.equal(L.groups('zh-Hant', [])[1].items[0].native, '繁體中文');
  assert.deepEqual(L.groups('unknown language', []).flatMap(g => g.items), []);
});
test('recent languages stay first, unique and bounded; empty history has no invented entries', () => {
  const recent = L.recent(['ja', 'ko', 'ja', 'bad', 'en', 'fr', 'de', 'es']);
  assert.deepEqual(recent, ['ja', 'ko', 'en', 'fr', 'de']);
  const groups = L.groups('', recent);
  assert.deepEqual(groups[0].items.map(l => l.code), recent);
  assert.equal(new Set(groups.flatMap(g => g.items.map(l => l.code))).size, 31);
  assert.deepEqual(L.recent({}), []);
  assert.deepEqual(L.groups('', [])[0].items, []);
});
test('only narrows the catalog (TTS dub languages) and still applies search and recents', () => {
  const only = ['zh', 'zh-Hant', 'ja'];
  const groups = L.groups('', ['ja', 'fr'], only);
  assert.deepEqual(groups[0].items.map(l => l.code), ['ja'], 'recent outside only is hidden');
  assert.deepEqual(groups[1].items.map(l => l.code).sort(), ['zh', 'zh-Hant']);
  assert.deepEqual(L.groups('french', [], only).flatMap(g => g.items), []);
  assert.equal(L.groups('', [], null)[1].items.length, 31);
});
