const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-skill-install.js');
const M = window.BC_SKILL_INSTALL;
const V = '1.4.2';

test('项目批量输入去空行、尾斜线和重复项，保留路径中的空格', () => {
  assert.deepEqual(M.parseRoots(' ~/Projects/Video One/\r\n\n/Users/me/第二个项目\n~/Projects/Video One'), {
    roots: ['~/Projects/Video One', '/Users/me/第二个项目'], error: '',
  });
});
test('一项路径无效时不进行部分安装', () => {
  for (const bad of ['relative/path', '/Projects/../private', '/Projects/./a', '/Projects/\u0000a', '/', '~/', '~/x/.codex/skills/baocut']) {
    const result = M.parseRoots('/Projects/good\n' + bad);
    assert.equal(result.roots.length, 0);
    assert.ok(result.error);
  }
});
test('空输入和 Agent 配置目录不能冒充项目根目录', () => {
  for (const bad of ['', ' / ', '~/', '~/x/.claude', '~/x/.claude/skills/', '~/x/.gemini/skills']) assert.ok(M.parseRoots(bad).error);
});
test('宿主与 baocut skill install 一致：四个宿主，全局装在主目录，按项目装在项目根下', () => {
  assert.deepEqual(M.HOSTS.map((h) => h.k), ['claude-code', 'codex', 'cursor', 'gemini']);
  assert.deepEqual(M.globalPaths(), ['~/.claude/skills/baocut', '~/.codex/skills/baocut', '~/.cursor/skills/baocut', '~/.gemini/skills/baocut']);
  assert.equal(M.destination('~/Project/', '.cursor/skills'), '~/Project/.cursor/skills/baocut');
  assert.deepEqual(M.parsePath('~/Project/.codex/skills/baocut'), {root: '~/Project', folder: '.codex/skills'});
  assert.equal(M.parsePath('~/Project/baocut'), null);
  assert.equal(M.reader('.gemini/skills'), 'Gemini CLI');
  assert.equal(M.MODES[0].k, 'copy');
});
test('版本按数字比较；比 App 旧的是可更新，复制和链接都一样', () => {
  assert.equal(M.cmpVer('1.10.0', '1.9.9'), 1);
  assert.equal(M.cmpVer('1.4', '1.4.0'), 0);
  assert.equal(M.locationState(undefined, V), 'none');
  assert.equal(M.locationState({mode: 'copy', ver: V}, V), 'current');
  assert.equal(M.locationState({mode: 'copy', ver: '1.3.0'}, V), 'stale');
  assert.equal(M.locationState({mode: 'link', ver: '1.3.0'}, V), 'stale');
  assert.equal(M.locationState({mode: 'link', ver: V, issue: 'broken'}, V), 'broken');
  assert.equal(M.locationState({mode: 'copy', issue: 'foreign'}, V), 'foreign');
  assert.equal(M.stateCopy('stale', {ver: '1.3.0'}, V).text, 'v1.3.0 · 可更新到 v1.4.2');
  assert.equal(M.stateCopy('current', {mode: 'link', ver: V}, V).cta, null);
});
test('折叠行：装在哪、几处可更新；占用的位置不进「全部更新」', () => {
  assert.equal(M.overview({}, V).kind, 'none');
  const def = M.overview(M.scenarioInstalls('default', V), V);
  assert.deepEqual([def.kind, def.stale.length, def.oldest, def.globalHosts, def.projects], ['update', 2, '1.3.0', ['Claude Code', 'Codex'], ['~/BaoCut/科浪访谈-42']]);
  assert.equal(M.whereLine(def), '全局：Claude Code、Codex · 1 个项目');
  assert.equal(M.overview(M.scenarioInstalls('all', V), V).kind, 'ok');
  const occ = M.overview(M.scenarioInstalls('foreign', V), V);
  assert.deepEqual([occ.kind, occ.fixable, occ.foreign.length], ['attention', [], 1]);
  assert.equal(M.overview(M.scenarioInstalls('broken', V), V).kind, 'update');
});
test('更新保持原来的方式；链接共用一份，装一处所有链接一起跟上', () => {
  const [claude, codex, cursor] = M.globalPaths();
  const before = {[claude]: {mode: 'copy', ver: '1.3.0'}, [codex]: {mode: 'link', ver: '1.3.0'}};
  const after = M.repairAll(before, [claude], V);
  assert.deepEqual(after[claude], {mode: 'copy', ver: V});
  assert.equal(after[codex].ver, '1.3.0');
  assert.equal(before[claude].ver, '1.3.0');
  const linked = M.put(before, cursor, 'link', V);
  assert.deepEqual([linked[codex].ver, linked[cursor].mode, linked[claude].ver], [V, 'link', '1.3.0']);
  assert.equal(M.put({}, claude, undefined, V)[claude].mode, 'copy');
  assert.equal(M.repair({[claude]: {issue: 'foreign'}}, claude, V)[claude].issue, 'foreign');
});
test('按项目安装：已经装着的不动；移除一个项目只删它的位置', () => {
  const p = M.destination('~/A', '.claude/skills');
  const start = {[p]: {mode: 'copy', ver: '1.3.0'}};
  const next = M.installProjects(start, ['~/A', '~/B'], ['.claude/skills', '.codex/skills'], 'copy', V);
  assert.equal(next[p].ver, '1.3.0');
  assert.equal(Object.keys(next).length, 4);
  assert.deepEqual(M.projectRoots(next), ['~/A', '~/B']);
  assert.deepEqual(M.projectRoots(M.removeRoot(next, '~/A')), ['~/B']);
});
test('被占用的位置没有任何会覆盖它的动作；只有移除副本才需要先确认', () => {
  const c = M.stateCopy('foreign', {mode: 'copy', issue: 'foreign'}, V);
  assert.equal(c.action, null);
  assert.equal(c.cta, null);
  assert.equal(M.removalDeletesFiles('current', {mode: 'copy'}), true);
  assert.equal(M.removalDeletesFiles('stale', {mode: 'copy'}), true);
  assert.equal(M.removalDeletesFiles('current', {mode: 'link'}), false);
  assert.equal(M.removalDeletesFiles('broken', {mode: 'link'}), false);
});
