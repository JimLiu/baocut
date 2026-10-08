const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-task-outputs.js');
const TO = global.window.BC_TASK_OUTPUTS;

const TOOLS = [{id: 'tts', name: '生成语音'}, {id: 'image', name: '生成图片'}, {id: 'text', name: '文本生成'}, {id: 'transcribe', name: '转录'}];
global.window.BC_TOOLS = {TOOLS, toolById: (id) => TOOLS.find((t) => t.id === id) || null};

test('哪个工具：toolId 优先，其次字符串形的 tool，再按直接任务的 kind', () => {
  assert.equal(TO.toolIdOf({toolId: 'image', kind: 'tts'}), 'image');
  assert.equal(TO.toolIdOf({tool: 'transcribe', kind: 'transcribe'}), 'transcribe');
  assert.equal(TO.toolIdOf({kind: 'write'}), 'text');
  assert.equal(TO.toolIdOf({kind: 'export'}), null);
});

test('产物块：记了产物或保存位置才出', () => {
  assert.equal(TO.hasBlock({outputs: ['a']}), true);
  assert.equal(TO.hasBlock({saveDir: '~/Downloads'}), true);
  assert.equal(TO.hasBlock({outputs: []}), false);
  assert.equal(TO.hasBlock({}), false);
});

test('产物列表：id 对上 Space 条目，不在了的标出来', () => {
  const rows = TO.resolve({outputs: ['o1', 'gone']}, [{id: 'o1', name: 'a.srt'}]);
  assert.deepEqual(rows.map((r) => [r.id, !!r.entry, r.gone]), [['o1', true, false], ['gone', false, true]]);
  assert.deepEqual(TO.resolve({}, []), []);
});

test('产物操作：回收站里的不能交给 Agent，缺失的不能在文件夹中显示，生成中的只能查看', () => {
  assert.deepEqual(TO.entryActions({status: null}), {view: true, reveal: true, handover: true});
  assert.deepEqual(TO.entryActions({trashed: true}), {view: true, reveal: false, handover: false});
  assert.deepEqual(TO.entryActions({status: 'missing'}), {view: true, reveal: false, handover: true});
  assert.deepEqual(TO.entryActions({status: 'generating'}), {view: true, reveal: false, handover: false});
  assert.deepEqual(TO.entryActions(null), {view: false, reveal: false, handover: false});
});

test('重试：直接任务回到参数已填好的工具页；失败叫重试，完成叫再做一次', () => {
  const failed = TO.retry({kind: 'tts', status: 'error', params: {text: 'hi'}});
  assert.deepEqual(failed, {toolId: 'tts', label: '重试', preset: {entry: null, rerun: true, params: {text: 'hi'}}});
  assert.equal(TO.retry({kind: 'image', status: 'done'}).label, '再做一次');
  assert.equal(TO.retry({toolId: 'text', status: 'done'}).preset.params, null);
});

test('重试：固定流程（有 runId）、还在跑的、不是工具的、目录里没有的工具都不给', () => {
  assert.equal(TO.retry({tool: 'transcribe', runId: 'tr1', status: 'error'}), null);
  assert.equal(TO.retry({kind: 'tts', status: 'running'}), null);
  assert.equal(TO.retry({kind: 'tts', status: 'queued'}), null);
  assert.equal(TO.retry({kind: 'export', status: 'error'}), null);
  assert.equal(TO.retry({toolId: 'nope', status: 'error'}), null);
});

test('旧任务记的候选对象不算 Space 产物；Agent / 命令行 / 项目里发起的直接任务不回工具页', () => {
  const ag = {id: 'ag19s', kind: 'tts', source: 'agent', status: 'done', outputs: [{name: '旁白 A'}]};
  assert.equal(TO.hasBlock(ag), false);
  assert.deepEqual(TO.resolve(ag, [{id: 'x'}]), []);
  assert.equal(TO.toolIdOf(ag), null);
  assert.equal(TO.retry(ag), null);
  assert.equal(TO.retry({kind: 'image', source: 'cli', status: 'error'}), null);
  assert.equal(TO.toolIdOf({kind: 'tts', flow: 'tts', project: 'p10'}), null);
  assert.equal(TO.toolIdOf({kind: 'tts', flow: 'tts', project: null}), 'tts');
  assert.deepEqual(TO.resolve({outputs: [{name: 'a'}, 'o1']}, [{id: 'o1'}]).map((r) => r.id), ['o1']);
});
