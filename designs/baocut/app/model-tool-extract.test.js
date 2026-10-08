const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-tool-extract.js');
const EX = window.BC_TOOL_EXTRACT;

test('能原样拷贝的音轨按编码选容器，其余转成 AAC', () => {
  const ext = (codec) => EX.formatOf({hasAudio: true, audioCodec: codec});
  assert.deepEqual([ext('aac').ext, ext('mp3').ext, ext('opus').ext, ext('flac').ext], ['.m4a', '.mp3', '.ogg', '.flac']);
  assert.equal(ext('aac').copy, true);
  assert.equal(ext('AAC (LC)').codec, 'aac');
  const pcm = ext('pcm_s16le');
  assert.equal(pcm.copy, false);
  assert.equal(pcm.ext, '.m4a');
  assert.equal(pcm.codec, 'aac');
});

test('计划去掉画面、只取第一条音轨；拷贝用 copy，转码用 aac', () => {
  const src = {name: 'a.mov', path: '/in/a.mov', seconds: 60, hasAudio: true, audioCodec: 'aac'};
  const p = EX.plan(src, src.path, '/out/a.m4a');
  assert.deepEqual(p.args, ['-hide_banner', '-y', '-i', '/in/a.mov', '-map', '0:a:0', '-vn', '-c:a', 'copy', '/out/a.m4a']);
  const q = EX.plan(Object.assign({}, src, {audioCodec: 'ac3'}), src.path, '/out/a.m4a');
  assert.deepEqual(q.args.slice(-5), ['-c:a', 'aac', '-b:a', '192k', '/out/a.m4a']);
  assert.ok(q.estimatedBytes > 0);
});

test('没有音轨时不出命令，错误码 TRANSCODE_NO_AUDIO，文案说清楚下一步', () => {
  const p = EX.plan({name: 'mute.mp4', hasAudio: false}, 'mute.mp4', 'mute.m4a');
  assert.equal(p.error.code, 'TRANSCODE_NO_AUDIO');
  assert.match(p.error.line, /mute\.mp4/);
  assert.match(p.error.line, /换一个带声音的视频/);
  const job = EX.makeJob(3, {name: 'mute.mp4', path: 'mute.mp4', hasAudio: false}, [], '~/Downloads');
  assert.equal(job.plan.error.code, 'TRANSCODE_NO_AUDIO');
  assert.equal(EX.jobMeta(job), '0:00 · 没有音轨');
});

test('任务记录：名字取源文件名换扩展名，重名加序号，带保存位置', () => {
  const src = {name: 'talk.mp4', path: '/m/talk.mp4', seconds: 75, hasAudio: true, audioCodec: 'mp3'};
  const a = EX.makeJob(1, src, [], '~/Downloads');
  assert.equal(a.name, 'talk.mp3');
  assert.equal(a.kind, 'extract');
  assert.equal(a.saveDir, '~/Downloads');
  assert.equal(a.plan.args[a.plan.args.length - 1], '~/Downloads/talk.mp3');
  assert.equal(EX.makeJob(2, src, ['talk.mp3'], '~/Downloads').name, 'talk-2.mp3');
  assert.equal(EX.jobMeta(a), '1:15 · MP3 · 原样拷贝');
});

test('Space 里的视频文件条目换成源描述', () => {
  const s = EX.fromEntry({id: 'tool-final-x', name: 'clip.mp4', file: '~/Downloads/clip.mp4', dur: 30, res: '1920×1080'});
  assert.equal(s.path, '~/Downloads/clip.mp4');
  assert.equal(s.seconds, 30);
  assert.equal(s.width, 1920);
  assert.equal(s.hasAudio, true);
  assert.equal(s.entry, 'tool-final-x');
  assert.equal(EX.fromEntry({name: 'mute.mp4', hasAudio: false}).hasAudio, false);
});
