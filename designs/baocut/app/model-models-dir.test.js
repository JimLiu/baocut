/* BC_MODELSDIR：模型目录的生效来源、路径省略、更改确认的分支、空间与任务判断（architecture-design §6.3） */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
const X = require('./model-models-dir.js');
const LM = require('./model-local-models.js');
const models = [
  {id: 'a', size: 680, uses: ['c1']}, {id: 'b', size: 1732, uses: []}, {id: 'vision-person', size: 6.4, uses: []},
  {id: 'x', size: 100, uses: []}, {id: 'y', size: 2355, uses: []},
];
const comps = [{id: 'c1', size: 938}];
const F = (over) => Object.assign({path: '/p', exists: true, writable: true, freeMB: 100000, models: []}, over);

test('生效目录：环境变量 > 设置 > 默认；只有环境变量会锁住', () => {
  assert.deepStrictEqual(X.effective('/env', '/pref'), {path: '/env', source: 'env', locked: true});
  assert.deepStrictEqual(X.effective(null, '/pref'), {path: '/pref', source: 'custom', locked: false});
  assert.deepStrictEqual(X.effective(null, null), {path: X.DEFAULT_DIR, source: 'default', locked: false});
  assert.strictEqual(X.effective(null, X.DEFAULT_DIR).source, 'default', '选回默认路径等于默认');
  assert.ok(X.isDefault(X.DEFAULT_DIR) && X.isDefault(null) && !X.isDefault('/x'));
});

test('长路径中间省略：短的原样，长的保留开头与末尾两段，不超限', () => {
  assert.strictEqual(X.shorten('/Volumes/ExtremeSSD/BaoCut/models', 44), '/Volumes/ExtremeSSD/BaoCut/models');
  const s = X.shorten('/Volumes/ExtremeSSD/Projects/Archive/BaoCut/2026/models', 40);
  assert.ok(s.length <= 40, s);
  assert.ok(s.startsWith('/Volumes/') && s.endsWith('/2026/models') && s.includes('…'), s);
  assert.strictEqual(X.shorten('~/' + 'a'.repeat(80), 30).length <= 30, true, '单段超长也不超限');
  assert.strictEqual(X.shorten('', 30), '');
});

test('选定文件夹的问题：不存在、不可写如实说，可用的返回 null', () => {
  assert.strictEqual(X.problem(F()), null);
  assert.strictEqual(X.problem(F({exists: false})).code, 'missing');
  assert.strictEqual(X.problem(F({writable: false})).code, 'readonly');
  assert.strictEqual(X.problem(null).code, 'missing');
});

test('演示文件夹覆盖：已有模型 / 空间小 / 共用 / 只读 / 不存在', () => {
  const by = (p) => X.findFolder(p);
  assert.ok(by('/Volumes/ExtremeSSD/BaoCut/models').models.length > 0);
  assert.ok(by('/Volumes/Backup/BaoCut/models').freeMB < 5 * 1024);
  assert.strictEqual(X.problem(by('/Volumes/Archive/models')).code, 'readonly');
  assert.strictEqual(X.problem(by('/Volumes/OldDisk/models')).code, 'missing');
  assert.strictEqual(X.findFolder('/nope'), null);
});

test('已识别的模型只数清单里认得的 id', () => {
  const f = X.found(F({models: ['a', 'zzz', 'y']}), models);
  assert.strictEqual(f.count, 2);
  assert.strictEqual(f.sizeMB, 680 + 2355);
});

test('移动放不放得下：目标已有的同名模型不重复计', () => {
  assert.deepStrictEqual(X.moveCheck(5000, F({freeMB: 6000})), {need: 5000, free: 6000, ok: true, short: 0});
  const c = X.moveCheck(5000, F({freeMB: 3000}));
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.short, 2000);
  assert.strictEqual(X.moveCheck(5000, F({freeMB: 3000}), 2000).ok, true, '目标里已有 2000，只需搬 3000');
  assert.strictEqual(X.moveCheck(5000, F({freeMB: 5000})).ok, true, '刚好够也算够');
});

test('更改的分支：出错 / 直接切换 / 要选择', () => {
  assert.strictEqual(X.plan(F({exists: false}), models, 3000, ['a']).kind, 'error');
  const direct = X.plan(F({models: ['y']}), models, 0, []);
  assert.strictEqual(direct.kind, 'direct');
  assert.strictEqual(direct.found.count, 1);
  const choose = X.plan(F({freeMB: 100000, models: ['y']}), models, 2412, ['a', 'b']);
  assert.strictEqual(choose.kind, 'choose');
  assert.strictEqual(choose.move.disabled, false);
  assert.strictEqual(choose.found.count, 1);
  assert.strictEqual(choose.moveMB, 2412);
});

test('空间不足：移动被禁用并写明还差多少', () => {
  const p = X.plan(F({freeMB: 1024}), models, 2412, ['a', 'b']);
  assert.strictEqual(p.kind, 'choose');
  assert.strictEqual(p.move.disabled, true);
  assert.match(p.move.why, /要移动 2\.4 GB，目标盘只有 1\.0 GB 可用，还差 1\.4 GB/);
  const small = X.plan(F({freeMB: 100}), models, 300, ['x']);
  assert.match(small.move.why, /还差 200 MB/);
});

test('更改后的已装集合：移动是合并，切换只认目标里的', () => {
  const dst = F({models: ['y', 'a']});
  assert.deepStrictEqual(X.installedAfter('move', ['a', 'b'], dst).sort(), ['a', 'b', 'y']);
  assert.deepStrictEqual(X.installedAfter('switch', ['a', 'b'], dst), ['y', 'a']);
  assert.deepStrictEqual(X.installedAfter('direct', [], dst), ['y', 'a']);
  assert.deepStrictEqual(X.installedAfter('switch', ['a'], F()), [], '空文件夹：什么都没有，原位置的文件没人删');
});

test('什么时候不能更改：本地任务、正在下载、正在检查', () => {
  const T = (o) => Object.assign({id: 't', kind: 'transcribe', status: 'running', sub: 'moss-transcribe · 本机'}, o);
  assert.strictEqual(X.blocker([], null), null);
  assert.strictEqual(X.blocker([T({status: 'done'}), T({sub: 'OpenAI · 云端'}), T({kind: 'export'})], {}), null, '已完成 / 云端 / 导出都不挡');
  const b = X.blocker([T({id: 'j1'}), T({id: 'j2', status: 'queued', kind: 'tts'})], {});
  assert.deepStrictEqual(b.taskIds, ['j1', 'j2']);
  assert.match(b.text, /2 个任务在用本地模型/);
  assert.match(X.blocker([], {downloading: ['Qwen3-ASR 1.7B']}).text, /正在下载 Qwen3-ASR 1\.7B/);
  assert.match(X.blocker([], {testing: ['HTDemucs-FT']}).text, /正在检查 HTDemucs-FT/);
  assert.strictEqual(X.blocker([], {downloading: ['A']}).hasTasks, false);
});

test('随包附带的模型不计入目录里的数量与空间', () => {
  const on = {a: true, b: false, 'vision-person': true, c1: true};
  assert.deepStrictEqual(X.installedIn(models, on).map((m) => m.id), ['a']);
  assert.strictEqual(X.withoutBundled({'vision-person': true, a: true})['vision-person'], false);
  const m2 = models.map((m) => (m.id === 'a' ? Object.assign({}, m, {uses: ['c1']}) : m));
  assert.strictEqual(LM.disk(m2, comps, X.withoutBundled(on)), 680 + 938);
});

test('环境变量锁定的说明点名变量', () => {
  assert.match(X.sourceNote('env'), /BAOCUT_MODELS_DIR/);
  assert.strictEqual(X.sourceNote('default'), '');
});
