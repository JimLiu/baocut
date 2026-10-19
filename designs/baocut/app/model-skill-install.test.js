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
  for (const bad of ['relative/path', '/Projects/../private', '/Projects/./a', '/Projects/\u0000a', '/', '~/', '~/x/.agents/skills/baocut']) {
    const result = M.parseRoots('/Projects/good\n' + bad);
    assert.equal(result.roots.length, 0);
    assert.ok(result.error);
  }
});
test('空输入和 Agent 配置目录不能冒充项目根目录', () => {
  for (const bad of ['', ' / ', '~/', '~/x/.claude', '~/x/.claude/skills/', '~/x/.agents/skills']) assert.ok(M.parseRoots(bad).error);
});
test('只装两个目录：.agents/skills 与 .claude/skills，全局在主目录，按项目在项目根下', () => {
  assert.deepEqual(M.folders, ['.agents/skills', '.claude/skills']);
  assert.deepEqual(M.globalPaths(), ['~/.agents/skills/baocut', '~/.claude/skills/baocut']);
  assert.equal(M.destination('~/Project/', '.agents/skills'), '~/Project/.agents/skills/baocut');
  assert.deepEqual(M.parsePath('~/Project/.claude/skills/baocut'), {root: '~/Project', folder: '.claude/skills'});
  assert.equal(M.parsePath('~/Project/.codex/skills/baocut'), null);
  assert.equal(M.reader('.claude/skills'), 'Claude Code');
});
test('默认链接到 App 里随 App 发布的那份；链接永远是 App 的版本，副本比 App 旧才可更新', () => {
  assert.equal(M.MODES[0].k, 'link');
  assert.ok(M.source.startsWith('/Applications/BaoCut.app/'));
  assert.deepEqual(M.put({}, '~/.claude/skills/baocut', undefined, V)['~/.claude/skills/baocut'], {mode: 'link'});
  assert.equal(M.cmpVer('1.10.0', '1.9.9'), 1);
  assert.equal(M.cmpVer('1.4', '1.4.0'), 0);
  assert.equal(M.locationState(undefined, V), 'none');
  assert.equal(M.locationState({mode: 'link'}, V), 'current');
  assert.equal(M.locationState({mode: 'copy', ver: V}, V), 'current');
  assert.equal(M.locationState({mode: 'copy', ver: '1.3.0'}, V), 'stale');
  assert.equal(M.locationState({mode: 'link', issue: 'broken'}, V), 'broken');
  assert.equal(M.locationState({mode: 'copy', issue: 'foreign'}, V), 'foreign');
  assert.equal(M.stateCopy('stale', {mode: 'copy', ver: '1.3.0'}, V).text, 'v1.3.0 · 副本 · 可更新到 v1.4.2');
  assert.equal(M.stateCopy('current', {mode: 'link'}, V).text, 'v1.4.2 · 链接到 App，随 App 更新');
  assert.equal(M.stateCopy('current', {mode: 'link'}, V).cta, null);
});
test('App 不在「应用程序」里运行时先提醒链接会失效', () => {
  assert.equal(M.sourceWarning(M.source), null);
  assert.ok(M.sourceWarning(M.scenarioAppPath('moved')).title);
});
test('命令行：指向 App 的是同版本；别处装的只提示，不替换', () => {
  assert.equal(M.cliState(null, V).kind, 'none');
  assert.deepEqual([M.cliState(M.scenarioCli('default'), V).kind, M.cliState(M.scenarioCli('default'), V).text], ['app', 'v1.4.2 · 链接到 App，随 App 更新']);
  const other = M.cliState({path: '/opt/homebrew/bin/baocut', target: '/x/baocut', ver: '1.2.0'}, V);
  assert.deepEqual([other.kind, other.cta], ['other', null]);
  assert.match(other.text, /比 App 的 v1.4.2 旧/);
});
test('折叠行：装在哪、几处可更新；占用的位置不进「全部更新」', () => {
  assert.equal(M.overview({}, V).kind, 'none');
  const def = M.overview(M.scenarioInstalls('default'), V);
  assert.deepEqual([def.kind, def.stale.length, def.oldest, def.globalHosts, def.projects], ['update', 2, '1.3.0', ['Codex 与其他 Agent', 'Claude Code'], ['~/BaoCut/科浪访谈-42']]);
  assert.equal(M.whereLine(def), '全局：Codex 与其他 Agent、Claude Code · 1 个项目');
  assert.equal(M.overview(M.scenarioInstalls('all'), V).kind, 'ok');
  const occ = M.overview(M.scenarioInstalls('foreign'), V);
  assert.deepEqual([occ.kind, occ.fixable, occ.foreign.length], ['attention', [], 1]);
  assert.equal(M.overview(M.scenarioInstalls('broken'), V).kind, 'update');
});
test('更新与修复保持原来的方式', () => {
  const [agents, claude] = M.globalPaths();
  const before = {[agents]: {mode: 'copy', ver: '1.3.0'}, [claude]: {mode: 'link', issue: 'broken'}};
  const after = M.repairAll(before, [agents, claude], V);
  assert.deepEqual(after[agents], {mode: 'copy', ver: V});
  assert.deepEqual(after[claude], {mode: 'link'});
  assert.equal(before[agents].ver, '1.3.0');
  assert.equal(M.repair({[claude]: {issue: 'foreign'}}, claude, V)[claude].issue, 'foreign');
});
test('按项目安装：已经装着的不动；移除一个项目只删它的位置', () => {
  const p = M.destination('~/A', '.claude/skills');
  const start = {[p]: {mode: 'copy', ver: '1.3.0'}};
  const next = M.installProjects(start, ['~/A', '~/B'], M.folders, 'link', V);
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
