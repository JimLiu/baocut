const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-settings-nav.js');
require('./model-settings-link.js');
const L = window.BC_SETTINGS_LINK;

test('设置的节：落到那一节，位置写「设置 › 节名」', () => {
  assert.deepEqual(L.parse('/settings/agent'), {route: {r: 'settings', sec: 'agent'}, trail: '设置 › Agent 提供方'});
  assert.deepEqual(L.parse('/settings/shortcuts/'), {route: {r: 'settings', sec: 'shortcuts'}, trail: '设置 › 快捷键'});
});

test('模型的类与页：落到那一类的能力页或另一页；默认页的位置里不写页名', () => {
  assert.deepEqual(L.parse('/settings/models/asr'), {route: {r: 'settings', sec: 'asr'}, trail: '设置 › 模型 › 语音识别'});
  assert.deepEqual(L.parse('/settings/models/tts/voices'), {route: {r: 'settings', sec: 'voices'}, trail: '设置 › 模型 › 语音合成 › 我的声音'});
  assert.deepEqual(L.parse('/settings/models/tts'), {route: {r: 'settings', sec: 'tts'}, trail: '设置 › 模型 › 语音合成'});
  assert.deepEqual(L.parse('/settings/models/providers'), {route: {r: 'settings', sec: 'providers'}, trail: '设置 › 模型 › API 提供方'});
  assert.deepEqual(L.parse('/settings/models/sep'), {route: {r: 'settings', sec: 'sep'}, trail: '设置 › 模型 › 人声分离'});
});

test('旧的本地 / 云端页落到那种能力的能力页；那种能力以前没有这一页的认不出', () => {
  assert.deepEqual(L.parse('/settings/models/asr/local'), L.parse('/settings/models/asr'));
  assert.deepEqual(L.parse('/settings/models/asr/cloud'), L.parse('/settings/models/asr'));
  assert.deepEqual(L.parse('/settings/models/image/cloud'), L.parse('/settings/models/image'));
  assert.equal(L.parse('/settings/models/sep/cloud'), null);
});

test('认不出的链接返回 null，按普通文字显示', () => {
  ['/settings/model', '/settings/models/llm/local', '/settings/models/asr/voices', '/settings/models/agent', '/settings/agent/skills', '/settings',
    'https://example.com/settings/agent', 'settings/agent', '/space/all', '', null].forEach((href) => {
    assert.equal(L.parse(href), null, String(href));
  });
});

test('能力在设置里的位置：只到能力页，语音合成的我的声音另有一页', () => {
  assert.equal(L.capabilityHref('transcribe'), '/settings/models/asr');
  assert.equal(L.capabilityHref('transcribe', 'local'), '/settings/models/asr');
  assert.equal(L.capabilityHref('synthesizeSpeech', 'voices'), '/settings/models/tts/voices');
  assert.equal(L.capabilityHref('synthesizeSpeech', 'tts'), '/settings/models/tts');
  assert.equal(L.capabilityHref('separateAudio'), '/settings/models/sep');
  assert.equal(L.capabilityHref('unknown', 'local'), null);
  Object.keys(L.CAPABILITY_CATEGORY).forEach((cap) => assert.ok(L.parse(L.capabilityHref(cap)), cap));
});
