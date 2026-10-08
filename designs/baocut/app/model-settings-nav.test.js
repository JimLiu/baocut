const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-settings-nav.js');
const N = window.BC_SETTINGS_NAV;

test('每一页只属左栏一项，且往返回到同一项', () => {
  const all = N.NAV.flatMap((n) => n.pages);
  assert.equal(new Set(all).size, all.length);
  N.NAV.forEach((n) => n.pages.forEach((p) => {
    const r = N.routeFor(n.k, p);
    assert.deepEqual(r, {r: 'settings', sec: p});
    assert.equal(N.navOf(r.sec), n.k);
  }));
});

test('模型组：API 提供方、用量在前，然后每种能力一页；语音合成另有我的声音', () => {
  const groups = N.searchGroups('');
  assert.deepEqual(groups.map((g) => g.id), ['preferences', 'agents', 'models', 'app']);
  assert.deepEqual(groups.find((g) => g.id === 'models').items.map((n) => n.k), ['providers', 'usage', 'asr', 'tts', 'llm', 'image', 'sep', 'vision']);
  assert.deepEqual(groups.find((g) => g.id === 'agents').items.map((n) => n.k), ['agent', 'skills']);
  assert.deepEqual(N.byKey('tts').pages, ['tts', 'voices']);
  assert.equal(N.navOf('voices'), 'tts');
  assert.deepEqual(N.NAV.filter((n) => n.capPage && !n.cap).map((n) => n.k), ['sep', 'vision'], '人声分离与视觉分析只有本机模型');
  assert.equal(N.byKey('llm').local, undefined, '文本生成没有本机模型');
});

test('旧深链照旧能落：本地 / 云端带 tab 去能力页，云端不带 tab 去 API 提供方页', () => {
  assert.deepEqual(N.normalize('cloud', 'tts'), {sec: 'tts', tab: null});
  assert.deepEqual(N.normalize('cloud', 'stt'), {sec: 'asr', tab: null});
  assert.deepEqual(N.normalize('cloud', 'llm'), {sec: 'llm', tab: null});
  assert.deepEqual(N.normalize('cloud'), {sec: 'providers', tab: null});
  assert.deepEqual(N.normalize('local'), {sec: 'asr', tab: null});
  assert.deepEqual(N.normalize('local', 'vision'), {sec: 'vision', tab: null});
  assert.deepEqual(N.normalize('local', 'bogus'), {sec: 'asr', tab: null});
  assert.equal(N.navOf('integrations'), 'skills');
  assert.equal(N.navOf('nope'), 'general');
});

test('点左栏回到这一类上次停的页；上次的页不属于这一类时用第一页', () => {
  assert.deepEqual(N.routeFor('tts', null, 'voices'), {r: 'settings', sec: 'voices'});
  assert.deepEqual(N.routeFor('tts', null, null), {r: 'settings', sec: 'tts'});
  assert.deepEqual(N.routeFor('llm', null, 'voices'), {r: 'settings', sec: 'llm'});
});

test('搜索设置分类保留分组、匹配子页，并且不改变导航表', () => {
  const before = JSON.stringify(N.NAV);
  assert.deepEqual(N.searchGroups('').flatMap((g) => g.items.map((n) => n.k)), N.NAV.map((n) => n.k));
  assert.deepEqual(N.searchGroups(' 密钥 ').flatMap((g) => g.items.map((n) => n.k)), ['providers']);
  assert.deepEqual(N.searchGroups('服务商').flatMap((g) => g.items.map((n) => n.k)), ['providers'], '旧称仍能搜到');
  assert.equal(N.byKey('providers').label, 'API 提供方');
  assert.deepEqual(N.searchGroups('我的声音').flatMap((g) => g.items.map((n) => n.k)), ['tts']);
  assert.deepEqual(N.searchGroups('SKILLS').flatMap((g) => g.items.map((n) => n.k)), ['skills']);
  assert.deepEqual(N.searchGroups('不存在的分类'), []);
  assert.equal(JSON.stringify(N.NAV), before);
});
