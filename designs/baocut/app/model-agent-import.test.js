const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-agent-import.js');
const I = global.window.BC_AGENT_IMPORT;

const DIRS = [
  {id: 'd1', name: '科浪访谈 第 42 期', path: '~/BaoCut/科浪访谈-42/'},
  {id: 'd9', name: '去年的素材', path: '~/Movies/去年的素材/', missing: true},
];
const LIST = [
  {agent: 'claude', nativeId: 'c1', cwd: '~/BaoCut/科浪访谈-42', title: '把访谈里的口癖都标出来', ago: 90, turns: 6},
  {agent: 'codex', nativeId: 'x1', cwd: '~/Code/blog', title: 'Write the release notes', ago: 30, turns: 3},
  {agent: 'claude', nativeId: 'c2', cwd: '~/Movies/vlog', title: '给 vlog 配字幕', ago: 10, turns: 2},
  {agent: 'claude', nativeId: 'c3', cwd: '~/Movies/去年的素材', title: '整理素材', ago: 2000, turns: 1},
];

test('sources：只列本机找到的那几家', () => {
  assert.deepEqual(I.sources([{id: 'claude', found: true}, {id: 'codex', found: false}, {id: 'gemini', found: true}]).map((s) => s.id), ['claude']);
  assert.deepEqual(I.sources([]), []);
});

test('landing：目录已是项目就落进去，不是就接成项目，不在了不能导入', () => {
  assert.deepEqual(I.landing(LIST[0], DIRS), {k: 'project', dir: DIRS[0]});
  assert.deepEqual(I.landing(LIST[2], DIRS), {k: 'adopt', path: '~/Movies/vlog', name: 'vlog'});
  assert.deepEqual(I.landing(LIST[3], DIRS), {k: 'missing'});
  assert.deepEqual(I.landing(Object.assign({}, LIST[2], {cwdMissing: true}), DIRS), {k: 'missing'});
});

test('importedAs：同一家、同一条原生会话只导入一次', () => {
  const sessions = [{id: 's9', importedFrom: {agent: 'claude', nativeId: 'c1'}}, {id: 's10', importedFrom: {agent: 'codex', nativeId: 'c2'}}];
  assert.equal(I.importedAs(LIST[0], sessions).id, 's9');
  assert.equal(I.importedAs(LIST[2], sessions), null);
});

test('filter：按 Agent 分段、搜第一句与目录、限定目录，最近的在前', () => {
  assert.deepEqual(I.filter(LIST, {agent: 'claude'}).map((x) => x.nativeId), ['c2', 'c1', 'c3']);
  assert.deepEqual(I.filter(LIST, {q: 'RELEASE'}).map((x) => x.nativeId), ['x1']);
  assert.deepEqual(I.filter(LIST, {q: 'vlog'}).map((x) => x.nativeId), ['c2']);
  assert.deepEqual(I.filter(LIST, {agent: 'claude', dir: '~/BaoCut/科浪访谈-42/'}).map((x) => x.nativeId), ['c1']);
});

test('meta 与 toRows：一行说明；原样复制、末尾一条分隔线', () => {
  assert.equal(I.meta(LIST[0], (m) => `${m} 分钟前`), '~/BaoCut/科浪访谈-42 · 90 分钟前 · 6 轮');
  const rows = I.toRows({history: [{role: 'user', text: 'a'}, {role: 'assistant', text: 'b'}]}, 'Claude Code', '10 月 28 日');
  assert.deepEqual(rows.map((r) => [r.id, r.role]), [['imp_0', 'user'], ['imp_1', 'assistant'], ['imp_end', 'marker']]);
  assert.equal(rows[2].text, '以上导入自 Claude Code · 10 月 28 日');
  assert.equal(I.baseName('/'), '/');
});
