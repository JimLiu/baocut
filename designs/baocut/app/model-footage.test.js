const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
const F = require('./model-footage.js');

const clip = (over) => Object.assign({kind: 'video', name: 'a.mp4', seconds: 42, width: 1920, height: 1080, fps: 30, bytes: 88000000, hasAudio: true}, over);
const form = (id, over) => Object.assign(F.blank(id), over);
const allReady = {[F.REALESRGAN]: 'ready', [F.RIFE]: 'ready', [F.MATTE]: 'ready', [F.MATTE_ISNET]: 'ready'};

test('工具 id 是流程名，缺省值照协议（FootageParams、SeparateAudioParams）', () => {
  assert.deepEqual(F.OPS.map((o) => o.id), ['stabilize-video', 'upscale-video', 'interpolate-video', 'match-color', 'remove-background', 'separate-audio']);
  const f = F.blank('stabilize-video');
  assert.equal(f.strength, 'medium');
  assert.equal(f.scale, 2);
  assert.equal(f.model, 'video');
  assert.equal(f.factor, 2);
  assert.equal(f.mode, 'slowmo');
  assert.equal(f.method, 'hm-mkl-hm');
  assert.equal(f.amount, 1);
  assert.equal(f.matteModel, 'fast');
  assert.equal(f.temporal, 0.3);
  assert.equal(f.stems, 'vocals');
  assert.deepEqual(F.FACTORS, [2, 3, 4, 8]);
  assert.deepEqual(F.SCALES, [2, 3, 4]);
});

test('要下载的受管工具：去抖、统一色调、分轨不用；抠像按选的权重各下各的', () => {
  assert.deepEqual(F.toolsFor(form('stabilize-video')), []);
  assert.deepEqual(F.toolsFor(form('match-color')), []);
  assert.deepEqual(F.toolsFor(form('separate-audio')), []);
  assert.deepEqual(F.toolsFor(form('upscale-video')), [F.REALESRGAN]);
  assert.deepEqual(F.toolsFor(form('interpolate-video')), [F.RIFE]);
  assert.deepEqual(F.toolsFor(form('remove-background')), [F.MATTE]);
  assert.deepEqual(F.toolsFor(form('remove-background', {matteModel: 'general'})), [F.MATTE_ISNET]);
  assert.equal(F.MANAGED[F.RIFE].short, '430 MB');
  assert.equal(F.MANAGED[F.MATTE].short, '约 5 MB');
  assert.equal(F.MANAGED[F.REALESRGAN].short, '约 50 MB');
  assert.equal(F.MANAGED[F.MATTE_ISNET].nonCommercial, true);
});

test('插帧：整段输出 (帧数 − 1) × 倍数 + 1 张；慢动作帧率不变时长变长，提高帧率时长不变', () => {
  const slow = F.planOf(form('interpolate-video', {factor: 4, mode: 'slowmo'}), clip());
  assert.equal(slow.frames, 1260);
  assert.equal(slow.outFrames, 1259 * 4 + 1);
  assert.equal(slow.outFps, 30);
  assert.ok(Math.abs(slow.outSeconds - 42 * 4) < 1);
  const smooth = F.planOf(form('interpolate-video', {factor: 4, mode: 'smooth'}), clip());
  assert.equal(smooth.outFps, 120);
  assert.ok(Math.abs(smooth.outSeconds - 42) < 0.1);
});

test('只处理一段：帧数按这一段算，结束晚于文件时截到末尾', () => {
  const f = form('upscale-video', {ranged: true, start: 12, end: 20});
  assert.equal(F.planOf(f, clip()).frames, 240);
  assert.equal(F.rangeOf(form('upscale-video', {ranged: true, start: 40, end: 100}), clip()).seconds, 2);
  assert.match(F.sourceLine(f, clip()), /这一段 240 帧/);
});

test('开始前的检查：说法照流程的拒绝', () => {
  assert.match(F.problems(form('stabilize-video'), [], {})[0], /先选一个视频文件/);
  assert.match(F.problems(form('remove-background'), [], {})[0], /视频文件或图片/);
  assert.match(F.problems(form('stabilize-video'), [clip({hdr: true})], {})[0], /是 HDR/);
  assert.match(F.problems(form('upscale-video', {scale: 3}), [clip({width: 3840, height: 2160})], {tools: allReady})[0], /11520×6480，每边至多 7680/);
  assert.deepEqual(F.problems(form('upscale-video', {scale: 4}), [clip()], {tools: allReady}), [], '1080p 放大 4 倍正好 7680');
  assert.match(F.problems(form('remove-background'), [clip({seconds: 9000})], {tools: allReady})[0], /270,000 帧，一次至多处理 216,000 帧/);
  assert.deepEqual(F.problems(form('stabilize-video'), [clip({seconds: 9000})], {}), [], '只走滤镜链的没有帧数上限');
  assert.deepEqual(F.problems(form('upscale-video', {ranged: true, start: 0, end: 60}), [clip({seconds: 9000})], {tools: allReady}), [], '选一段就过了上限');
  assert.match(F.problems(form('match-color'), [clip()], {})[0], /先选一张参考/);
  assert.match(F.problems(form('match-color', {ranged: true, reference: clip()}), [clip(), {kind: 'image', name: 'p.png', width: 10, height: 10}], {})[0], /是图片，不能只处理一段/);
  assert.match(F.problems(form('stabilize-video', {ranged: true, start: 20, end: 10}), [clip()], {})[0], /结束要晚于开始/);
  assert.match(F.problems(form('stabilize-video', {ranged: true, start: 100, end: 110}), [clip()], {})[0], /这一段是空的/);
  assert.match(F.problems(form('upscale-video'), [clip()], {tools: {}})[0], /第一次用前要下载 Real-ESRGAN · 约 50 MB/);
  assert.match(F.problems(form('interpolate-video'), [clip()], {tools: {}})[0], /第一次用前要下载 RIFE · 430 MB/);
  assert.match(F.problems(form('remove-background', {matteModel: 'general'}), [clip()], {tools: {[F.MATTE]: 'ready'}})[0], /IS-Net/, '默认权重装好不等于 IS-Net 装好');
});

test('分轨：要有音轨和能用的模型，四轨只有 HTDemucs 系', () => {
  const htd = {id: 'htdemucs-ft', label: 'HTDemucs-FT', local: true, ok: true};
  const mel = {id: 'audiocpp:mel_band_roformer', label: 'Mel-Band RoFormer', local: true, ok: true};
  assert.match(F.problems(form('separate-audio', {sepModel: 'htdemucs-ft'}), [clip({hasAudio: false})], {sep: [htd]})[0], /没有音轨/);
  assert.match(F.problems(form('separate-audio'), [clip()], {sep: [Object.assign({}, htd, {ok: false})]})[0], /还没有可用的分离模型/);
  assert.deepEqual(F.problems(form('separate-audio', {sepModel: 'htdemucs-ft', stems: 'four'}), [clip()], {sep: [htd, mel]}), []);
  assert.match(F.problems(form('separate-audio', {sepModel: mel.id, stems: 'four'}), [clip()], {sep: [htd, mel]})[0], /只能把人声和其余部分分开/);
  assert.deepEqual(F.problems(form('separate-audio', {sepModel: mel.id}), [clip()], {sep: [htd, mel]}), []);
  const models = F.sepModels([{id: 'htdemucs-ft', name: 'HTDemucs-FT', cat: 'sep', size: 321}, {id: 'x', name: 'X', cat: 'tts'}], () => false);
  assert.deepEqual(models.map((m) => [m.id, m.ok]), [['htdemucs-ft', false]]);
});

test('工作量：抠像按实测每帧约 0.25 秒，IS-Net 慢约 4 倍；长素材提醒', () => {
  const fast = F.workload(form('remove-background'), [clip()], {});
  assert.equal(fast.frames, 1260);
  assert.ok(fast.seconds[0] <= 1260 * 0.25 && fast.seconds[1] > 1260 * 0.25);
  const clean = F.workload(form('remove-background', {matteModel: 'general'}), [clip()], {});
  assert.ok(clean.seconds[0] >= fast.seconds[0] * 4 - 1);
  assert.equal(F.workload(form('stabilize-video'), [clip()], {}).level, 'ok');
  assert.equal(F.workload(form('remove-background'), [clip()], {}).level, 'long');
  assert.equal(F.workload(form('upscale-video', {model: 'photo'}), [clip()], {}).level, 'veryLong');
  const long = clip({seconds: 3120, fps: 25});
  assert.equal(F.workload(form('remove-background'), [long], {}).level, 'veryLong');
  assert.equal(F.workload(form('remove-background', {ranged: true, start: 0, end: 10}), [long], {}).level, 'ok');
  // 退回 deshake 比 vid.stab 少一遍，估得也短
  assert.ok(F.workload(form('stabilize-video'), [clip()], {vidstab: false}).seconds[1] < F.workload(form('stabilize-video'), [clip()], {vidstab: true}).seconds[1]);
});

test('状态行：先说缺什么，齐了说帧数和耗时', () => {
  assert.match(F.statusLine(form('stabilize-video'), [], {}, false).text, /先选一个/);
  assert.equal(F.statusLine(form('match-color'), [clip()], {}, false).bad, false);
  assert.equal(F.statusLine(form('match-color'), [clip()], {}, true).bad, true);
  assert.equal(F.statusLine(form('stabilize-video'), [clip({hdr: true})], {}, false).bad, true, 'HDR 这种过不去的，一选中就标出来');
  assert.equal(F.statusLine(form('upscale-video', {scale: 3}), [clip({width: 3840, height: 2160})], {tools: allReady}, false).bad, true);
  assert.match(F.statusLine(form('stabilize-video'), [clip()], {}, false).text, /^1,260 帧 · /);
  assert.match(F.statusLine(form('remove-background'), [{kind: 'image', name: 'p.png', width: 100, height: 100}], {tools: allReady}, false).text, /^1 张图片/);
});

test('输出文件名照流程：视频、图片与每一轨，重名加序号', () => {
  const name = (id, over, src, taken) => F.outputsOf(form(id, over), [src || clip()], taken).map((o) => o.name);
  assert.deepEqual(name('stabilize-video'), ['a-stabilized.mp4']);
  assert.deepEqual(name('upscale-video', {scale: 3}), ['a-upscaled-3x.mp4']);
  assert.deepEqual(name('interpolate-video', {factor: 8}), ['a-slowmo-8x.mp4']);
  assert.deepEqual(name('interpolate-video', {factor: 2, mode: 'smooth'}), ['a-smooth-2x.mp4']);
  assert.deepEqual(name('match-color'), ['a-color-matched.mp4']);
  assert.deepEqual(name('match-color', null, {kind: 'image', name: 'p.png', width: 1, height: 1}), ['p-color-matched.png']);
  assert.deepEqual(name('remove-background'), ['a-cutout.mov']);
  assert.deepEqual(name('remove-background', null, {kind: 'image', name: 'p.png', width: 1, height: 1}), ['p-cutout.png']);
  assert.deepEqual(name('separate-audio'), ['a-vocals.wav', 'a-background.wav']);
  assert.deepEqual(name('separate-audio', {stems: 'four'}), ['a-vocals.wav', 'a-background.wav', 'a-drums.wav', 'a-bass.wav', 'a-other.wav']);
  assert.deepEqual(name('stabilize-video', null, null, ['a-stabilized.mp4']), ['a-stabilized-2.mp4']);
});

test('结果里的提醒：退回 deshake、插帧重影、慢动作没声音、IS-Net 不可商用、没认出主体', () => {
  assert.deepEqual(F.warningsOf(form('stabilize-video'), {vidstab: true}), []);
  assert.match(F.warningsOf(form('stabilize-video'), {vidstab: false})[0], /用的是自带的 deshake.*BAOCUT_FFMPEG/);
  assert.equal(F.warningsOf(form('interpolate-video'), {}).length, 2);
  assert.equal(F.warningsOf(form('interpolate-video', {mode: 'smooth'}), {}).length, 1);
  assert.match(F.warningsOf(form('remove-background', {matteModel: 'general'}), {})[0], /非商业/);
  assert.deepEqual(F.warningsOf(form('remove-background'), {}), []);
  assert.match(F.warningsOf(form('remove-background'), {}, ['a.mp4'])[0], /a\.mp4 里几乎没有认出主体/);
  assert.equal(F.executorOf(form('stabilize-video'), {vidstab: false}), 'deshake · ffmpeg');
  assert.equal(F.executorOf(form('interpolate-video')), 'RIFE 20221029 · rife-v4.6');
});

test('文字：耗时区间与帧数', () => {
  assert.equal(F.etaText([1, 5]), '几秒');
  assert.equal(F.etaText([20, 50]), '不到 1 分钟');
  assert.equal(F.etaText([300, 720]), '约 5–12 分钟');
  assert.equal(F.etaText([12, 75]), '不到 2 分钟');
  assert.equal(F.etaText([30, 75]), '约 1–2 分钟');
  assert.equal(F.etaText([5400, 14400]), '约 1.5–4 小时');
  assert.equal(F.count(216000), '216,000');
  assert.equal(F.timecode(3725), '1:02:05');
  assert.equal(F.timecode(42), '00:42');
  assert.equal(F.bytesText(52428800), '50 MB');
  assert.equal(F.bytesText(1610612736), '1.5 GB');
});

test('演示素材只列这个工具收的', () => {
  assert.ok(!F.samplesFor('stabilize-video').some((s) => s.src.kind === 'image' || s.src.kind === 'audio'));
  assert.ok(F.samplesFor('remove-background').some((s) => s.src.kind === 'image'));
  assert.ok(F.samplesFor('separate-audio').some((s) => s.k === 'song'));
  assert.ok(!F.samplesFor('separate-audio').some((s) => s.k === 'hdr'));
  assert.equal(F.fromEntry({kind: 'audio', name: 'x.wav', dur: 10}).kind, 'audio');
  assert.equal(F.fromEntry({kind: 'final', name: 'x.mp4', dur: 10, res: '1280×720'}).width, 1280);
});
