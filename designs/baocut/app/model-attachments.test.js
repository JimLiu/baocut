const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-attachments.js');
const A = window.BC_ATTACHMENTS;
test('附件按 MIME 与扩展名选择预览，不把有 URL 的文件全部当图片', () => {
  assert.equal(A.kind({name:'voice.wav', url:'blob:local'}), 'audio');
  assert.equal(A.kind({name:'movie.webm', url:'blob:local'}), 'video');
  assert.equal(A.kind({name:'report.PDF', url:'blob:local'}), 'pdf');
  assert.equal(A.kind({name:'unknown', mimeType:'image/webp'}), 'image');
  assert.equal(A.kind({name:'archive.zip', contentKind:'binary'}), 'binary');
  assert.equal(A.kind({name:'items.csv', url:'blob:local'}), 'text');
});
test('无扩展名文本可读取，空文件保留，二进制和无效 UTF-8 不按代码展示', () => {
  assert.equal(A.textContent(new TextEncoder().encode('你好\nhello')), '你好\nhello');
  assert.equal(A.textContent(new Uint8Array()), '');
  assert.equal(A.textContent(Uint8Array.of(80,75,0,4)), null);
  assert.equal(A.textContent(Uint8Array.of(255,254)), null);
});
test('附件预览记录保留来源 ID 与内容，独立于 Space 产物', () => {
  const record = A.record({id:'upload:a',name:'notes.csv',url:'blob:local',text:'a,b',bytes:3});
  assert.equal(record.id,'upload:a'); assert.equal(record.previewSrc,'blob:local');
  assert.equal(record.text,'a,b'); assert.equal(record.attachment,true); assert.equal(record.previewGroup,undefined);
});
