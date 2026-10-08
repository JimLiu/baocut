const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-tool-save-dir.js');
require('./model-space-tools.js');
const ST = global.window.BC_SPACE_TOOLS;

const TOOLS = [
  {id: 'transcribe', name: '转录'}, {id: 'translate', name: '翻译字幕'}, {id: 'dub', name: '翻译配音'},
  {id: 'tts', name: '生成语音'}, {id: 'text', name: '文本生成'}, {id: 'image', name: '生成图片'},
  {id: 'compress', name: '压缩视频'}, {id: 'merge', name: '合并视频'}, {id: 'extract', name: '提取音频', planned: true},
];
global.window.BC_TOOLS = {TOOLS, toolById: (id) => TOOLS.find((t) => t.id === id) || null};

test('用工具处理…：没有工具页的输入模型时按种类映射，跳过即将推出的与目录里没有的', () => {
  delete global.window.BC_TOOL_SPACE_INPUT;
  assert.deepEqual(ST.toolsFor({id: 'a', kind: 'subtitle'}).map((t) => t.id), ['translate', 'tts', 'text']);
  assert.deepEqual(ST.toolsFor({id: 'b', kind: 'final'}).map((t) => t.id), ['transcribe', 'compress', 'merge']);
  assert.deepEqual(ST.toolsFor({id: 'c', kind: 'image'}), []);
  assert.deepEqual(ST.toolsFor({id: 'd', kind: 'doc', trashed: true}), [], '回收站里的不列');
});

test('用工具处理…：工具页的输入模型在时以它为准', () => {
  global.window.BC_TOOL_SPACE_INPUT = {toolsFor: (e) => (e.kind === 'image' ? [{id: 'x', name: 'X'}] : [])};
  assert.deepEqual(ST.toolsFor({id: 'c', kind: 'image'}).map((t) => t.id), ['x']);
  delete global.window.BC_TOOL_SPACE_INPUT;
});

test('选会话（§4.7）：属于项目 → 在那个项目新建', () => {
  const sessions = [{id: 's1'}];
  assert.deepEqual(ST.pickSession({id: 'o1', kind: 'doc', dir: 'd1', session: 's1'}, sessions), {kind: 'new', dir: 'd1', project: null});
  assert.deepEqual(ST.pickSession({id: 'p1', kind: 'movie', dir: 'd1'}, sessions), {kind: 'new', dir: 'd1', project: 'p1'});
});

test('选会话（§4.7）：不属于项目、产生它的会话还在 → 回那条', () => {
  assert.deepEqual(ST.pickSession({id: 'o2', kind: 'subtitle', dir: null, session: 's1'}, [{id: 's0'}, {id: 's1'}]), {kind: 'existing', id: 's1'});
});

test('选会话（§4.7）：不属于项目、会话不在了或没有 → 新建无项目会话', () => {
  assert.deepEqual(ST.pickSession({id: 'o3', kind: 'audio', session: 'gone'}, [{id: 's1'}]), {kind: 'new', dir: null, project: null});
  assert.deepEqual(ST.pickSession({id: 'o4', kind: 'image'}, []), {kind: 'new', dir: null, project: null});
});

test('选会话：回收站里的要先恢复', () => {
  assert.deepEqual(ST.pickSession({id: 'o5', kind: 'doc', trashed: true, dir: 'd1'}, []), {kind: 'blocked', reason: 'trashed'});
  assert.equal(ST.pickSession(null, []), null);
});

test('来源：工具生成的条目给出工具、任务与「再做一次」的预设', () => {
  const tasks = [{id: 'a1', tool: 'tts', params: {voice: 'v1'}}];
  const it = {id: 'tool-audio-1', kind: 'audio', tool: true, task: 'a1'};
  const o = ST.origin(it, tasks);
  assert.equal(o.toolId, 'tts');
  assert.equal(o.toolName, '生成语音');
  assert.equal(o.taskId, 'a1');
  assert.deepEqual(o.rerun, {entry: it, rerun: true, params: {voice: 'v1'}});
  const own = ST.origin({id: 'x', kind: 'doc', toolId: 'text', params: {prompt: 'p'}}, []);
  assert.deepEqual([own.toolId, own.taskId, own.rerun.params], ['text', null, {prompt: 'p'}]);
});

test('来源：只知道是工具做的、不知道哪一个时没有「再做一次」；不是工具做的返回 null', () => {
  const o = ST.origin({id: 'y', kind: 'audio', tool: true}, []);
  assert.deepEqual([o.toolId, o.rerun], [null, null]);
  assert.equal(ST.origin({id: 'o1', kind: 'final', task: 'j3'}, [{id: 'j3', kind: 'export'}]), null);
  assert.equal(ST.origin({id: 'z', kind: 'doc', toolId: 'text', trashed: true}, []).rerun, null, '回收站里的不再做');
});

test('位置：保存位置里的结果显示目录名，并认出是不是默认保存位置', () => {
  const at = ST.location({kind: 'audio', file: '~/Downloads/语音-001.wav'}, {});
  assert.deepEqual(at, {dir: '~/Downloads', label: '~/Downloads', isSaveDir: true});
  const custom = ST.location({kind: 'doc', file: '/Users/me/Movies/BaoCut 结果/a.txt'}, {saveDir: '~/Movies/BaoCut 结果'});
  assert.equal(custom.isSaveDir, true);
  assert.equal(custom.dir, '~/Movies/BaoCut 结果');
  assert.equal(ST.location({kind: 'doc', file: '/Volumes/盘/a.txt'}, {}).isSaveDir, false);
  assert.equal(ST.location({kind: 'doc', file: '导出/a.srt'}, {}), null, '项目里的相对路径不算');
});
