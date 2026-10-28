const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./model-llm-tools.js');
const O = require('./model-home-tools.js');

test('文本工具只列文本模型，并从共用服务商连接状态判定可用', () => {
  const list = L.models([{id:'p',name:'服务商',models:[{id:'text',kind:'llm'},{id:'tts',kind:'tts'}]}], ['p']);
  assert.deepEqual(list, [{id:'p/text',providerId:'p',name:'text',provider:'服务商',ready:true}]);
  assert.equal(L.models([{id:'p',models:[{id:'text',kind:'llm'}]}], [])[0].ready, false);
});
test('能用的在前：Codex 写文字排在已连接的提供方后面、没连接的前面；没装时不列，不能用时写原因，API key 登录时带提醒', () => {
  const cat = [{id:'p',name:'服务商',models:[{id:'text',kind:'llm'}]}];
  assert.equal(L.models(cat, ['p'], null).length, 1);
  const on = L.models(cat, ['p'], {ready:true, why:null, caution:null});
  assert.deepEqual(on.map(m => m.id), ['p/text', L.CODEX_TEXT_ID]);
  assert.equal(on[1].agent, true);
  const three = [{id:'a',name:'甲',models:[{id:'t',kind:'llm'}]}, {id:'b',name:'乙',models:[{id:'t',kind:'llm'}]}, {id:'c',name:'丙',models:[{id:'t',kind:'llm'}]}];
  assert.deepEqual(L.models(three, ['c'], {ready:true}).map(m => m.id), ['c/t', L.CODEX_TEXT_ID, 'a/t', 'b/t']);
  assert.deepEqual(L.models(three, ['c'], {ready:false, why:'Codex 需要登录'}).map(m => m.id), ['c/t', 'a/t', 'b/t', L.CODEX_TEXT_ID]);
  const off = L.models(cat, ['p'], {ready:false, why:'Codex 需要登录'})[1];
  assert.equal(off.ready, false);
  assert.equal(off.why, 'Codex 需要登录');
  const keyed = L.models(cat, [], {ready:true, why:null, caution:'用 API key 登录 · 可能画不了'});
  assert.deepEqual(keyed.map(m => m.id), [L.CODEX_TEXT_ID, 'p/text']);
  assert.equal(keyed[0].caution, L.CODEX_TEXT_CAUTION);
});
test('Codex 的模型表：「Agent 默认模型」打头（就是以前那只 Codex 写文字），再是它的模型，key 是 agent:codex/<模型>', () => {
  const cat = [{id:'p',name:'服务商',models:[{id:'text',kind:'llm'}]}];
  const list = L.models(cat, ['p'], {ready:true, models:[{id:'gpt-6.1-sol',name:'GPT-6.1 Sol',dflt:true},{id:'gpt-6-luna',name:'GPT-6 Luna'}]});
  assert.deepEqual(list.map(m => m.id), ['p/text', L.CODEX_TEXT_ID, 'agent:codex/gpt-6.1-sol', 'agent:codex/gpt-6-luna']);
  assert.deepEqual(list.slice(1).map(m => [m.providerId, m.model, m.name]),
    [['agent:codex', null, 'Agent 默认模型'], ['agent:codex', 'gpt-6.1-sol', 'GPT-6.1 Sol'], ['agent:codex', 'gpt-6-luna', 'GPT-6 Luna']]);
});
test('没选过时：记住的（不能用也留着）› 能用的默认模型 › 第一只能用、不用提醒的 › 第一只', () => {
  const three = [{id:'a',name:'甲',models:[{id:'t',kind:'llm'}]}, {id:'b',name:'乙',models:[{id:'t',kind:'llm'}]}];
  const list = L.models(three, ['b'], {ready:true, caution:'x', models:[]});
  assert.equal(L.initial(list, 'a/t', null).id, 'a/t');
  assert.equal(L.initial(list, 'gone/x', L.CODEX_TEXT_ID).id, L.CODEX_TEXT_ID);
  assert.equal(L.initial(list, null, 'a/t').id, 'b/t', '默认模型没连上不用它');
  assert.equal(L.initial(list, null, null).id, 'b/t', 'API key 登录的 Codex 不自动选');
  assert.equal(L.initial(L.models(three, [], {ready:true, caution:'x'}), null, null).id, L.CODEX_TEXT_ID, '只有它能用时落在第一只');
  assert.equal(L.initial([], null, null), null);
});
test('两级菜单：第一级每家一行，能用的在前，智能体与没连接的写明；第二级是这家的模型，智能体先列「Agent 默认模型」', () => {
  const three = [{id:'a',name:'甲',models:[{id:'t1',kind:'llm'},{id:'t2',kind:'llm'}]}, {id:'b',name:'乙',models:[{id:'t',kind:'llm'}]}];
  const list = L.models(three, ['b'], {ready:true, models:[{id:'sol',name:'Sol',dflt:true}]});
  const rows = L.providers(list, 'agent:codex/sol');
  assert.deepEqual(rows.map(r => [r.id, r.ready, r.on, r.models.length]), [['b', true, false, 1], ['agent:codex', true, true, 2], ['a', false, false, 2]]);
  assert.deepEqual(rows.map(r => r.sub), ['已连接 · 1 个模型', '智能体 · 用你的 Codex 订阅 · 比 API 慢', '未连接 · 去设置连接']);
  assert.equal(L.providers(L.models(three, [], {ready:false, why:'Codex 需要登录'}), null).at(-1).sub, '智能体 · Codex 需要登录');
  assert.deepEqual(L.modelRows(rows[1], 'agent:codex/sol').map(m => [m.name, m.sub, m.on]), [['Agent 默认模型', '按 Codex 配置选择', false], ['Sol', '默认', true]]);
  assert.deepEqual(L.modelRows(rows[2], 'agent:codex/sol').map(m => [m.id, m.on]), [['a/t1', false], ['a/t2', false]]);
  const gone = L.modelRows(rows[1], 'agent:codex/old');
  assert.deepEqual(gone.at(-1), {id:'agent:codex/old', name:'old', sub:'当前列表未提供此模型', on:true}, '记住的模型从 Codex 的表里没了照样列出');
});
test('收起时那一行：API 是「提供方 · 模型」，智能体再接推理强度（没选过是「中」）；固定请求只给智能体带推理强度', () => {
  const list = L.models([{id:'p',name:'服务商',models:[{id:'text',kind:'llm'}]}], ['p'], {ready:true, models:[{id:'sol',name:'Sol'}]});
  assert.equal(L.pickLabel(list[0], 'high'), '服务商 · text');
  assert.equal(L.pickLabel(list[2], 'high'), 'Codex · Sol · 高');
  assert.equal(L.pickLabel(list[1], null), 'Codex · Agent 默认模型 · 中');
  assert.deepEqual(Object.keys(L.request('text', {input:'x', effort:'high'}, list[2])), ['model', 'effort', 'messages']);
  assert.deepEqual(Object.keys(L.request('text', {input:'x', effort:'high'}, list[0])), ['model', 'messages']);
});
test('固定请求只包含模型与消息，不创建 Agent 或工具调用循环', () => {
  const model = {id:'p/text',ready:true};
  const r = L.request('text', {input:' 写一段开场白 '}, model);
  assert.deepEqual(r, {model:'p/text',messages:[{role:'user',content:'写一段开场白'}]});
  assert.throws(() => L.request('text',{input:''}, model));
  assert.throws(() => L.request('text',{input:'x'.repeat(16001)}, model));
  assert.throws(() => L.request('text',{input:'hello'}, {...model,ready:false}));
  const tr = L.request('translate',{input:L.SAMPLE,lang:'en'},model);
  assert.deepEqual(Object.keys(tr), ['model','messages']);
  assert.equal(JSON.parse(tr.messages[1].content).length, 2);
});
test('SRT、VTT 保留毫秒、多行正文和时间窗，可统一导出 SRT', () => {
  const srt = L.parseSubtitles('\uFEFF' + L.SAMPLE.replace(/\n/g,'\r\n'));
  assert.equal(srt.error, ''); assert.equal(srt.cues[1].end, 6.5);
  const vtt = L.parseSubtitles('WEBVTT\n\nNOTE source\ncomment\n\ncue-a\n00:00.250 --> 00:03.500 align:start\n第一行\n第二行');
  assert.equal(vtt.error, ''); assert.equal(vtt.cues[0].start, .25);
  assert.equal(vtt.cues[0].text, '第一行\n第二行');
  assert.equal(L.parseSubtitles(L.srt(vtt.cues)).cues[0].end, 3.5);
  for (const input of ['', 'plain text', '1\n00:00:03,000 --> 00:00:02,000\nx', '1\n00:99:00,000 --> 01:00:00,000\nx', 'WEBVTT']) assert.ok(L.parseSubtitles(input).error);
});
test('翻译结果拒绝漏句、重复、空译文，时间码只能取自原字幕', () => {
  const cues = L.parseSubtitles(L.SAMPLE).cues;
  const rows = cues.map((c,i) => ({id:c.id,text:'translation ' + i,start:99,end:100}));
  const translated = L.translatedCues(cues,rows);
  assert.equal(translated[0].start,0); assert.equal(translated[1].end,6.5);
  assert.equal(cues[0].text,'欢迎来到今天的分享。');
  assert.throws(() => L.translatedCues(cues,rows.slice(1)));
  assert.throws(() => L.translatedCues(cues,[rows[0],rows[0]]));
  assert.throws(() => L.translatedCues(cues,[{...rows[0],text:''},rows[1]]));
});
test('文档和翻译示例都能作为 Space 结果，示例内容清晰标识', () => {
  const result = L.demo('text',{input:'写旁白'});
  const doc = O.output('doc',{...result,id:'x',name:'旁白.md'});
  assert.equal(doc.kind,'doc'); assert.match(doc.text,/尚未调用模型/);
  const translated = L.demo('translate',{input:L.SAMPLE,lang:'en'});
  assert.match(translated.text,/Welcome/); assert.equal(translated.cues[1].end,6.5);
  const custom = L.demo('translate',{input:L.SAMPLE.replace('欢迎来到今天的分享。','另一句'),lang:'en'});
  assert.match(custom.cues[0].text,/示例占位/);
  assert.equal(O.output('subtitle',{...translated,id:'t',name:'译文.srt'}).kind,'subtitle');
});
