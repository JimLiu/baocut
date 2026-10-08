const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./model-llm-tools.js');
const O = require('./model-home-tools.js');

test('文本工具只列文本模型，并从共用服务商连接状态判定可用', () => {
  const list = L.models([{id:'p',name:'服务商',models:[{id:'text',kind:'llm'},{id:'tts',kind:'tts'}]}], ['p']);
  assert.deepEqual(list, [{id:'p/text',name:'text',provider:'服务商',ready:true}]);
  assert.equal(L.models([{id:'p',models:[{id:'text',kind:'llm'}]}], [])[0].ready, false);
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
