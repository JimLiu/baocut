const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-skill-install.js');
const M = window.BC_SKILL_INSTALL;
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
test('空输入和 agent 配置目录不能冒充项目根目录', () => {
  for (const bad of ['', ' / ', '~/', '~/x/.agents', '~/x/.claude/skills/']) assert.ok(M.parseRoots(bad).error);
});
test('两个目录均在项目根下创建 baocut 链接，目标是 App 内置资源', () => {
  assert.deepEqual(M.folders.map((f) => M.destination('~/Project', f)), ['~/Project/.agents/skills/baocut', '~/Project/.claude/skills/baocut']);
  assert.equal(M.destination('~', M.folders[0]), '~/.agents/skills/baocut');
  assert.ok(M.source.endsWith('/BaoCut.app/Contents/Resources/skills/baocut'));
});
test('安装位置按读它的 Agent 标名；页顶状态数全局两处', () => {
  assert.equal(M.reader('.claude/skills'), 'Claude Code');
  assert.equal(M.reader('.agents/skills'), 'Codex 与其他 Agent');
  assert.equal(M.globalStatus([]).kind, 'none');
  const part = M.globalStatus(['~/.claude/skills/baocut', '~/Project/.agents/skills/baocut']);
  assert.deepEqual([part.n, part.kind, part.missing], [1, 'partial', ['~/.agents/skills/baocut']]);
  assert.equal(M.globalStatus(M.globalPaths()).kind, 'all');
});
test('位置状态：软链接 / 副本一致 / 副本过期 / 链接失效 / 位置被占用', () => {
  assert.equal(M.locationState(undefined, '1.4.2'), 'none');
  assert.equal(M.locationState({mode: 'link'}, '1.4.2'), 'linked');
  assert.equal(M.locationState({mode: 'copy', ver: '1.4.2'}, '1.4.2'), 'copied');
  assert.equal(M.locationState({mode: 'copy', ver: '1.3.0'}, '1.4.2'), 'stale');
  assert.equal(M.locationState({mode: 'link', issue: 'broken'}, '1.4.2'), 'broken');
  assert.equal(M.locationState({mode: 'copy', issue: 'foreign'}, '1.4.2'), 'foreign');
  assert.equal(M.stateCopy('stale', {ver: '1.3.0'}, '1.4.2').action, 'update');
  assert.equal(M.stateCopy('linked').cta, null);
});
test('状态卡：有问题优先于没装齐；被占用的位置不进「全部修复」', () => {
  const [agents, claude] = M.globalPaths();
  assert.equal(M.overview({}, '1.4.2').kind, 'none');
  assert.equal(M.overview({[claude]: {mode: 'link'}}, '1.4.2').kind, 'partial');
  assert.equal(M.overview(M.scenarioInstalls('all'), '1.4.2').kind, 'all');
  const mixed = M.overview({[claude]: {mode: 'link', issue: 'broken'}, [agents]: {mode: 'copy', issue: 'foreign'}}, '1.4.2');
  assert.deepEqual([mixed.kind, mixed.issues.length, mixed.fixable], ['attention', 2, [claude]]);
});
test('修复保持原来的方式；安装、换方式与移除都是纯函数', () => {
  const [agents, claude] = M.globalPaths();
  const before = {[agents]: {mode: 'copy', ver: '1.3.0'}, [claude]: {mode: 'link', issue: 'broken'}};
  const after = M.repairAll(before, [agents, claude], '1.4.2');
  assert.deepEqual(after, {[agents]: {mode: 'copy', ver: '1.4.2'}, [claude]: {mode: 'link', ver: '1.4.2'}});
  assert.equal(before[agents].ver, '1.3.0');
  assert.equal(M.put({}, claude, 'copy', '1.4.2')[claude].mode, 'copy');
  assert.equal(M.put({}, claude, undefined, '1.4.2')[claude].mode, 'link');
  assert.deepEqual(M.remove(after, [agents, claude]), {});
});
test('App 不在「应用程序」里才提醒软链接会失效', () => {
  assert.equal(M.sourceWarning(M.source), null);
  assert.ok(M.sourceWarning(M.scenarioAppPath('moved')).title);
});

test('被占用的位置没有任何会覆盖它的动作；只有移除副本才需要先确认', () => {
  const c = M.stateCopy('foreign', {mode: 'copy', issue: 'foreign'}, '1.4.2');
  assert.equal(c.action, null);
  assert.equal(c.cta, null);
  assert.equal(M.removalDeletesFiles('copied'), true);
  assert.equal(M.removalDeletesFiles('stale'), true);
  assert.equal(M.removalDeletesFiles('linked'), false);
  assert.equal(M.removalDeletesFiles('broken'), false);
});
