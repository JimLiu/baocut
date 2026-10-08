const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-services.js');
const S = global.window.BC_SERVICES;

test('服务目录：三项，顺序是 MCP / 远端算力 / Web', () => {
  assert.deepEqual(S.IDS, ['mcp', 'remote', 'web']);
  assert.equal(S.byId('web').name, 'Web 服务');
  assert.equal(S.byId('nope'), null);
});

test('四态加出错：phase 优先于 error，error 优先于 on', () => {
  assert.equal(S.stateOf(null), 'off');
  assert.equal(S.stateOf({on: true}), 'on');
  assert.equal(S.stateOf({on: false, error: '端口被占用'}), 'error');
  assert.equal(S.stateOf({on: true, phase: 'stopping'}), 'stopping');
  assert.equal(S.stateOf({error: 'x', phase: 'starting'}), 'starting');
  assert.equal(S.dotTone({on: true}), 'on');
  assert.equal(S.dotTone({error: 'x'}), 'error');
  assert.equal(S.dotTone({phase: 'starting'}), 'off');
});

test('状态词：远端算力说「共享」，另两项说「运行」', () => {
  assert.equal(S.stateLabel('remote', {on: true}), '正在共享');
  assert.equal(S.stateLabel('remote', {}), '未共享');
  assert.equal(S.stateLabel('mcp', {on: true}), '运行中');
  assert.equal(S.stateLabel('web', {error: 'x'}), '启动失败');
  assert.equal(S.stateLabel('web', {phase: 'starting'}), '正在启动…');
});

test('MCP 没选项目不能启动；其余两项没有前置条件', () => {
  assert.equal(S.startBlock('mcp', {}), null);
  assert.equal(S.startBlock('web', {}), null);
  assert.equal(S.startBlock('remote', null), null);
});

test('侧栏快捷按钮：开着给停、关着给起、起停中不给、MCP 没项目给「去设置」', () => {
  assert.equal(S.quickAction('web', {on: true}).kind, 'stop');
  assert.deepEqual(S.quickAction('remote', {}), {kind: 'start', icon: 'play', tip: '开始共享'});
  assert.equal(S.quickAction('web', {phase: 'starting'}), null);
  assert.equal(S.quickAction('mcp', {}, {}).kind, 'start');
  assert.equal(S.quickAction('web', {error: 'x'}).tip, '重新启动服务');
});

test('总览汇总：出错先说，其次在跑的数，全关不说话', () => {
  assert.equal(S.summary({}), null);
  assert.deepEqual(S.summary({mcp: {on: true}, web: {on: true}}), {text: '2 项运行中', tone: 'on'});
  assert.deepEqual(S.summary({mcp: {on: true}, web: {error: 'x'}}), {text: '1 项出错', tone: 'error'});
});

test('路由落点：没有 id 或未知 id 是总览，两种旧的远端算力链接都认', () => {
  assert.equal(S.resolve({r: 'services'}), 'index');
  assert.equal(S.resolve({r: 'services', id: 'web'}), 'web');
  assert.equal(S.resolve({r: 'services', id: 'nope'}), 'index');
  assert.equal(S.resolve({r: 'remote'}), 'remote');
  assert.equal(S.resolve({r: 'tools', id: 'remote'}), 'remote');
  assert.equal(S.resolve({r: 'tools', id: 'tts'}), null);
  assert.equal(S.resolve({r: 'home'}), null);
});

test('侧栏三颗信号灯：一项一颗、各亮各的颜色，起停中的那颗 busy', () => {
  const L = S.lights({mcp: {on: true}, remote: {phase: 'starting'}, web: {error: 'x'}});
  assert.deepEqual(L.map((l) => l.id), ['mcp', 'remote', 'web']);
  assert.deepEqual(L.map((l) => l.tone), ['on', 'off', 'error']);
  assert.deepEqual(L.map((l) => l.busy), [false, true, false]);
  assert.equal(L[2].label, 'Web 服务 · 启动失败');
  assert.deepEqual(S.lights(null).map((l) => l.tone), ['off', 'off', 'off']);
});

test('Web 端口：范围、非数字、与远端算力撞口', () => {
  assert.deepEqual(S.parsePort(' 24320 '), {port: 24320});
  assert.ok(S.parsePort('80').error);
  assert.ok(S.parsePort('70000').error);
  assert.ok(S.parsePort('abc').error);
  assert.match(S.parsePort('24350').error, /远端算力/);
  assert.equal(S.webUrl(8080), 'http://127.0.0.1:8080/app/');
  assert.equal(S.webUrl(), 'http://127.0.0.1:24320/app/');
});

test('MCP 服务卡副标题：没项目 / 选好未启动 / 运行中', () => {
  const title = (id) => ({p1: '产品发布会'}[id]);
  assert.equal(S.mcpScope([], 11, title), '所有视频（11）');
  assert.equal(S.mcpScope(['p1'], 11, title), '「产品发布会」');
  assert.equal(S.mcpScope(['p1', 'p2', 'p3'], 11, title), '其中 3 部视频');
  assert.deepEqual(S.mcpToggleProject([], 'p1', 3), ['p1']);
  assert.deepEqual(S.mcpToggleProject(['p1'], 'p1', 3), []);
  assert.deepEqual(S.mcpToggleProject(['p1', 'p2'], 'p3', 3), []);
  assert.equal(S.mcpSub({}, '所有视频（11）', 'read'), '启动后开放所有视频（11） · 只读');
  assert.equal(S.mcpSub({}, '「产品发布会」', 'ask'), '启动后开放「产品发布会」 · 修改前询问');
  assert.equal(S.mcpSub({on: true}, '其中 3 部视频', 'read'), '其中 3 部视频 · 只读');
  assert.equal(S.mcpSub({on: true}, '所有视频（11）', 'auto'), '所有视频（11） · 直接放行');
  assert.equal(S.mcpSub({}, '所有视频（11）', 'ask', true), '启动后开放所有视频（11） · 修改前询问 · 需要令牌');
});

test('MCP 连接：固定端口地址与客户端配置，不要令牌时没有 headers', () => {

  assert.equal(S.mcpUrl(), 'http://127.0.0.1:24351/mcp');
  assert.deepEqual(JSON.parse(S.mcpClientConfig(S.mcpUrl())), {mcpServers: {baocut: {type: 'http', url: 'http://127.0.0.1:24351/mcp'}}});
  assert.equal(JSON.parse(S.mcpClientConfig('u', 't')).mcpServers.baocut.headers.Authorization, 'Bearer t');
  assert.deepEqual(S.MCP_ACCESS.map((a) => a.k), ['read', 'ask', 'auto']);
});

test('远端算力任务行：有模型才可开，下载 / 导出不靠模型，关掉的任务显示关', () => {
  const rows = S.remoteTaskRows({asr: ['moss'], tts: ['index-tts2.5'], image: [], separate: ['htdemucs-ft']}, ['export']);
  assert.deepEqual(rows.map((r) => r.k), ['asr', 'tts', 'image', 'separate', 'download', 'export']);
  const by = Object.fromEntries(rows.map((r) => [r.k, r]));
  assert.equal(by.asr.on, true);
  assert.equal(by.image.disabled, true);
  assert.equal(by.image.on, false, '没装模型的任务不许开');
  assert.equal(by.image.desc, '这台 Mac 还没装图像模型');
  assert.equal(by.download.disabled, false);
  assert.equal(by.download.desc, '用这台 Mac 的网络和 yt-dlp');
  assert.equal(by.export.on, false, '节点主人关掉的任务');
  assert.equal(S.remoteTaskSummary(rows), '提供 4 / 6 类任务');
});

test('节点卡任务 meta：按目录顺序、有模型带个数；没报 tasks 的旧节点返回 null', () => {
  assert.equal(S.nodeTaskMeta({tasks: ['tts', 'asr', 'separate', 'export'],
    taskModels: {asr: ['a', 'b', 'c'], tts: ['x', 'y'], separate: ['h']}}), '转录 3 · 配音 2 · 分离 1 · 导出');
  assert.equal(S.nodeTaskMeta({ttsModels: ['x']}), null);
  assert.equal(S.nodeTaskMeta(null), null);
});

test('在哪儿跑候选：在线 + 开放该任务 + 报得出该模型；旧节点与掉线的不算', () => {
  const nodes = [
    {id: 'a', state: 'online', tasks: ['asr', 'image'], taskModels: {image: ['qwen-image-2.1']}},
    {id: 'b', state: 'online', tasks: ['asr'], taskModels: {image: ['qwen-image-2.1']}},
    {id: 'c', state: 'offline', tasks: ['image'], taskModels: {image: ['qwen-image-2.1']}},
    {id: 'd', state: 'online', ttsModels: ['x']},
  ];
  assert.deepEqual(S.nodesFor(nodes, 'image', 'qwen-image-2.1').map((n) => n.id), ['a']);
  assert.equal(S.nodeOn(nodes, 'a', 'image', 'qwen-image-2.1').id, 'a');
  assert.equal(S.nodeOn(nodes, 'b', 'image', 'qwen-image-2.1'), null, '关了这类任务就回落本机');
  assert.equal(S.nodeOn(nodes, null, 'image', 'qwen-image-2.1'), null);
});

test('下载 / 导出不靠模型：候选只看在线 + 开放该任务', () => {
  const nodes = [
    {id: 'a', state: 'online', tasks: ['asr', 'download']},
    {id: 'b', state: 'online', tasks: ['asr']},
    {id: 'c', state: 'offline', tasks: ['download']},
    {id: 'd', state: 'online', ttsModels: ['x']},
  ];
  assert.deepEqual(S.nodesOffering(nodes, 'download').map((n) => n.id), ['a']);
  assert.equal(S.nodeOffering(nodes, 'a', 'download').id, 'a');
  assert.equal(S.nodeOffering(nodes, 'b', 'download'), null);
  assert.equal(S.nodeOffering(nodes, null, 'download'), null);
});
