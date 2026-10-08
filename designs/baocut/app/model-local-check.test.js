/* BC_LOCALCHECK：本地模型「检查」与「试听 / 试画」分开；健康只在行上一条状态里说 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-app-update.js');
const C = require('./model-local-check.js');

const m = {id: 'qwen3-tts-0.6b-base', repo: 'aufklarer/Qwen3-TTS-12Hz-0.6B-Base-MLX-8bit', size: 1249};
const NOW = 1_800_000_000_000;

test('检查放哪：有试用的能力只在 ⋯ 里，没有试用的能力在行上另露一个按钮', () => {
  assert.equal(C.tryOf('tts').label, '试听');
  assert.equal(C.tryOf('image').label, '试画');
  ['asr', 'sep', 'vision'].forEach((cat) => assert.equal(C.tryOf(cat), null, cat));
  assert.equal(C.checkOnRow('tts'), false);
  assert.equal(C.checkOnRow('image'), false);
  ['asr', 'sep', 'vision'].forEach((cat) => assert.equal(C.checkOnRow(cat), true, cat));
  assert.equal(C.LABEL.check, '检查');
  assert.equal(C.LABEL.checkFull, '检查模型');
  assert.notEqual(C.CHECK_ICON, 'play', '检查不用播放三角');
});

test('说明一句话讲清检查和修复，不再说「自测」与实现细节', () => {
  assert.match(C.CAPTION, /检查/);
  assert.match(C.CAPTION, /修复/);
  assert.doesNotMatch(C.CAPTION, /自测|走一遍|逐个文件|校验/);
});

test('状态行：没检查过不写；检查中有阶段与取消；通过是安静的一句', () => {
  assert.equal(C.lineView(null, 'tts', NOW), null);
  assert.equal(C.lineView({phase: 'idle'}, 'tts', NOW), null);
  const run = C.lineView({phase: 'checking', pct: 50}, 'asr', NOW);
  assert.equal(run.tone, 'running');
  assert.equal(run.head, '检查中…');
  assert.equal(run.text, '试跑一小段样本');
  assert.deepEqual(run.actions.map((a) => a.k), ['cancel']);
  assert.equal(C.lineView({phase: 'checking', pct: 10}, 'asr', NOW).text, '加载模型');
  assert.equal(C.lineView({phase: 'repairing', pct: 30}, 'asr', NOW).head, '修复中…');
  assert.equal(C.lineView({phase: 'passed', at: NOW - 3 * 60 * 1000}, 'tts', NOW).text, '3 分钟前检查通过');
  assert.equal(C.lineView({phase: 'passed', at: NOW}, 'tts', NOW).text, '刚刚检查通过');
});

test('没通过：一句人话 + 怎么办；修复帮得上才给「修复…」，总有重新检查与技术详情', () => {
  const line = (k, cat) => C.lineView(C.finish(k, m, cat || 'tts', NOW), cat || 'tts', NOW);
  C.PROBLEM_KEYS.forEach((k) => {
    const v = line(k);
    assert.equal(v.tone, 'failed', k);
    assert.ok(v.text && v.todo, k);
    assert.doesNotMatch(v.text + v.todo, /自测|任务执行出错|内部错误|[A-Z_]{6,}/, `${k} 正文不放代码`);
    const keys = v.actions.map((a) => a.k);
    assert.deepEqual(keys.slice(-2), ['recheck', 'details'], k);
    assert.equal(keys.includes('repair'), C.problem(k, m, 'tts').fix === 'repair', k);
  });
  assert.match(line('appFileMissing').todo, /重新安装 BaoCut/);
  assert.ok(!line('appFileMissing').actions.some((a) => a.k === 'repair'), '应用自带文件缺失，修复帮不上');
  assert.equal(line('modelDamaged').actions[0].k, 'repair');
  assert.match(line('wrongOutput', 'asr').text, /识别不出/);
  assert.match(line('wrongOutput', 'tts').text, /静音/);
  assert.match(line('noMemory').text, /内存不够/);
  assert.equal(line('notStarted').head, '检查没能开始', '没能开始也走状态行');
  assert.equal(C.finish('pass', m, 'tts', NOW).phase, 'passed');
  assert.equal(C.finish('nonsense', m, 'tts', NOW).phase, 'passed');
});

test('技术详情：代码与细节只在这里；不与行首的「详情」同名', () => {
  assert.notEqual(C.LABEL.details, '详情');
  const st = C.finish('modelDamaged', m, 'tts', NOW);
  const lines = C.detailLines(st, m, NOW);
  assert.equal(lines[0], '代码 MODEL_FILE_CORRUPT');
  assert.ok(lines.some((l) => l.indexOf('model.safetensors') >= 0));
  assert.deepEqual(C.detailLines({phase: 'passed', at: NOW}, m, NOW), []);
});

test('试用面板：上次检查没通过先说，并给修复 / 重新检查', () => {
  assert.equal(C.tryNotice({phase: 'passed', at: NOW}, 'tts'), null);
  assert.equal(C.tryNotice(C.finish('modelDamaged', m, 'asr', NOW), 'asr'), null, '没有试用的能力没有面板');
  const n = C.tryNotice(C.finish('modelDamaged', m, 'tts', NOW), 'tts');
  assert.match(n.text, /上次检查没通过：模型文件损坏了/);
  assert.match(n.todo, /试听多半也会失败/);
  assert.deepEqual(n.actions.map((a) => a.k), ['repair', 'recheck']);
  const app = C.tryNotice(C.finish('appFileMissing', m, 'image', NOW), 'image');
  assert.deepEqual(app.actions.map((a) => a.k), ['recheck']);
  assert.match(app.todo, /试画/);
});

test('试用面板：那次检查之后试用做成了就撤掉提醒，之前做成的不算', () => {
  const st = C.finish('modelDamaged', m, 'tts', NOW);
  assert.ok(C.tryNotice(st, 'tts', NOW - 1000));
  assert.equal(C.tryNotice(st, 'tts', NOW + 1000), null);
});

test('试用自己的失败：同一套说法，录音读不出时点名文件', () => {
  const ref = C.tryFailure('refUnreadable', 'tts', {file: '采访-张老师.m4a'});
  assert.match(ref.text, /「采访-张老师\.m4a」/);
  assert.deepEqual(ref.actions.map((a) => a.k), ['pickRef', 'useSample']);
  assert.match(C.tryFailure('noMemory', 'tts').text, /没合成完/);
  assert.match(C.tryFailure('noMemory', 'image').todo, /步数/);
  const err = C.tryFailure('modelError', 'image');
  assert.match(err.text, /没画出来/);
  assert.equal(err.actions[0].k, 'check');
  assert.equal(err.actions[0].label, '检查模型');
  assert.equal(C.tryFailure('invalid', 'tts', {msg: '先写一句要念的话'}).text, '先写一句要念的话');
});

test('原型开关：录音读不出只在用了自己的录音时成立', () => {
  assert.equal(C.tryOutcome('refUnreadable', false), 'ok');
  assert.equal(C.tryOutcome('refUnreadable', true), 'refUnreadable');
  assert.equal(C.tryOutcome('noMemory', false), 'noMemory');
  assert.equal(C.tryOutcome(undefined, true), 'ok');
  assert.deepEqual(C.CHECK_DEMOS.map((d) => d.k), ['pass'].concat(C.PROBLEM_KEYS));
});
