const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('./model-asr-languages');
test('ASR reuses the shared catalog and uses actual parameter counts',()=>{
  const L=require('./model-languages.js');
  assert.equal(A.data.languages,L.all,'转录不自带语言表');
  assert.equal(A.data.whisper,L.whisper);
  assert.equal(A.data.qwen,L.qwen);
  assert.equal(A.codes('whisper-large-v3').length,100);
  assert.equal(A.codes('whisper-turbo').length,100);
  assert.equal(A.codes('qwen3-asr-0.6b').length,30);
  assert.equal(A.codes('qwen3-asr-1.7b').length,30);
  const L2=require('./model-languages.js');
  assert.equal(A.codes('moss-transcribe').length,L2.all.length-2,'MOSS 可选整份目录的主语种');
  assert.ok(!A.codes('moss-transcribe').includes('zh-Hant')&&!A.codes('moss-transcribe').includes('pt-PT'));
  for(const code of [...L2.whisper,...L2.qwen])assert.ok(A.codes('moss-transcribe').includes(code),code);
});
test('model changes preserve compatible values and reset incompatible values to Auto',()=>{
  assert.equal(A.resolve('qwen3-asr-1.7b','ja'),'ja');
  assert.equal(A.resolve('qwen3-asr-1.7b','uk'),'auto');
  assert.equal(A.resolve('qwen3-asr-1.7b','yue'),'yue');
  assert.equal(A.resolve('qwen3-asr-1.7b','zh-Hant'),'zh');
  assert.equal(A.resolve('moss-transcribe','ja'),'ja','用户指定的语言优先');
  assert.equal(A.resolve('moss-transcribe','zh-Hant'),'zh');
  assert.equal(A.resolve('moss-transcribe','auto'),'auto');
  assert.equal(A.resolve('cloud:unknown','ja'),'ja','unknown is not proof of incompatibility');
});
test('recent languages remain first, deduplicated, bounded and model-filtered',()=>{
  assert.deepEqual(A.recent(['uk','ja','uk','en','de','fr','es','auto']),['uk','ja','en','de','fr']);
  const groups=A.groups('qwen3-asr-1.7b','',['uk','ja','en']);
  assert.deepEqual(groups[0].items.map(l=>l.code),['ja','en']);
  assert.equal(groups[1].items[0].code,'auto');
  assert.equal(groups.flatMap(g=>g.items).length,31);
  assert.equal(A.groups('whisper-large-v3','українська',[])[1].items[0].code,'uk');
  const moss=A.groups('moss-transcribe','',[]);
  assert.equal(moss[1].items[0].code,'auto','MOSS 默认仍是 Auto，排在最前');
  assert.equal(moss.flatMap(g=>g.items).length,A.codes('moss-transcribe').length+1);
});
test('the note under the field explains MOSS verbatim transcription',()=>{
  assert.match(A.note('moss-transcribe'),/默认 Auto 自动检测；指定后 MOSS 按该语言逐字转写/);
  assert.match(A.note('qwen3-asr-1.7b'),/^可指定 30 种语言/);
  assert.match(A.note('cloud:unknown'),/尚未声明语言范围/);
});
