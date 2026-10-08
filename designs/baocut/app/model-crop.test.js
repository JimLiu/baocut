const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
const C = require('./model-crop.js');

test('画幅解析与尺寸：短边 1080，自定义比例找最短整数对', () => {
  assert.equal(C.parseRatio('9:16'), 9 / 16);
  assert.ok(Number.isNaN(C.parseRatio('Original')));
  assert.deepEqual(C.dimensions('9:16'), {w: 1080, h: 1920, ratio: 9 / 16, id: '9:16'});
  assert.deepEqual(C.dimensions('16:9'), {w: 1920, h: 1080, ratio: 16 / 9, id: '16:9'});
  assert.equal(C.dimensions('1:1').w, 1080);
  assert.equal(C.ratioId(5 / 4), '5:4');
  assert.equal(C.ratioId(2.35), '47:20');
  assert.equal(C.fileTag('9:16'), '9x16');
});

test('覆盖率：16:9 → 9:16 只留 32% 宽度；9:16 → 16:9 只留 32% 高度；同画幅不裁', () => {
  const a = C.coverage(16 / 9, 9 / 16);
  assert.equal(a.axis, 'width'); assert.equal(Math.round(a.keep * 100), 32);
  const b = C.coverage(9 / 16, 16 / 9);
  assert.equal(b.axis, 'height'); assert.equal(Math.round(b.keep * 100), 32);
  assert.equal(C.coverage(16 / 9, 16 / 9).axis, 'same');
  assert.match(C.coverageText(16 / 9, 1), /56% 的宽度/);
});

test('取景窗：目标更窄时高占满，宽按比例；zoom 收紧；中心夹在画内', () => {
  const s = C.windowSize(16 / 9, 9 / 16, 1);
  assert.equal(s.h, 1); assert.ok(Math.abs(s.w - 0.3164) < 0.001);
  const z = C.windowSize(16 / 9, 9 / 16, 1.25);
  assert.equal(z.h, 0.8);
  const wide = C.windowSize(9 / 16, 16 / 9, 1);
  assert.equal(wide.w, 1); assert.ok(wide.h < 0.32);
  assert.deepEqual(C.clampCenter(0.05, 0.5, s), {cx: s.w / 2, cy: 0.5});
  assert.equal(C.splitLayout(9 / 16).dir, 'v');
  assert.equal(C.splitLayout(16 / 9).dir, 'h');
});

test('演示计划：镜头首尾相接覆盖区间，自动关键帧跟着重点，同框镜头带 split', () => {
  const p = C.demoPlan({scene: 'auto', start: 0, end: 206});
  const shots = p.shots;
  assert.equal(shots[0].start, 0);
  assert.equal(shots[shots.length - 1].end, 206);
  for (let i = 1; i < shots.length; i++) assert.equal(shots[i].start, shots[i - 1].end);
  assert.equal(p.subjects.length, 3);
  const split = shots.find((s) => s.follow === 'split');
  const k = C.keyframesIn(p, split.id)[0];
  assert.equal(k.split.length, 2);
  assert.ok(p.keyframes.every((x) => x.auto));
  const sm = C.summary(p);
  assert.equal(sm.persons, 2); assert.equal(sm.boards, 1); assert.equal(sm.shots, shots.length);
  assert.match(C.summaryText(p, 206), /^3:26 里认出 2 位人物、1 块屏幕 · 规划了 \d+ 个镜头$/);
});

test('演示计划：单人一个镜头多关键帧；同框偏好把人物镜头改写并合并相邻', () => {
  const talk = C.demoPlan({scene: 'talk', start: 0, end: 120});
  assert.equal(talk.shots.length, 1);
  assert.ok(talk.keyframes.length >= 3);
  const pod = C.demoPlan({scene: 'podcast', multi: 'split', start: 10, end: 70});
  assert.ok(pod.shots.every((s) => s.follow === 'split'));
  assert.equal(pod.shots.length, 1);
  assert.equal(pod.shots[0].start, 10); assert.equal(pod.shots[0].end, 70);
});

test('取景插值：平滑镜头在两关键帧之间移动，定点切换保持首帧', () => {
  const geom = {srcRatio: 16 / 9, dstRatio: 9 / 16, zoom: 1};
  const p = C.demoPlan({scene: 'podcast', start: 0, end: 100});
  const sh = p.shots[0];
  const a = C.windowAt(p, sh.start, geom), m = C.windowAt(p, (sh.start + sh.end) / 2, geom), b = C.windowAt(p, sh.end - 0.01, geom);
  assert.ok(a.cx < m.cx && m.cx < b.cx);
  assert.equal(a.shot.id, sh.id);
  const cut = C.setShotMotion(p, sh.id, 'cut');
  const c1 = C.windowAt(cut, sh.start, geom), c2 = C.windowAt(cut, sh.end - 0.01, geom);
  assert.equal(c1.cx, c2.cx);
  const split = p.shots.find((s) => s.follow === 'split');
  const w = C.windowAt(p, split.start + 1, geom);
  assert.equal(w.split.length, 2); assert.equal(w.layout.dir, 'v');
});

test('编辑：改跟随重算自动帧；手动关键帧保留；切一刀 / 合并 / 重置', () => {
  const p0 = C.demoPlan({scene: 'podcast', start: 0, end: 100});
  const sh = p0.shots[1];
  const p1 = C.setShotFollow(p0, sh.id, 'p1');
  assert.equal(C.shotAt(p1, sh.start + 1).follow, 'p1');
  assert.ok(C.keyframesIn(p1, sh.id).every((k) => k.auto));
  const t = sh.start + 2;
  const p2 = C.setKeyframe(p1, t, {cx: 0.2, cy: 0.5});
  assert.equal(C.manualCount(p2, sh.id), 1);
  assert.equal(C.keyframeAt(p2, t + 0.1).cx, 0.2);
  const p3 = C.setShotFollow(p2, sh.id, 'p2');
  assert.equal(C.manualCount(p3, sh.id), 1, '重算镜头后手动帧还在');
  const n = p3.shots.length;
  const p4 = C.splitShot(p3, sh.start + 4);
  assert.equal(p4.shots.length, n + 1);
  assert.equal(C.splitShot(p4, sh.start + 0.1).shots.length, n + 1, '离镜头边缘太近不切');
  const p5 = C.mergeWithNext(p4, sh.id);
  assert.equal(p5.shots.length, n);
  const p6 = C.resetShot(p5, sh.id);
  assert.equal(C.manualCount(p6, sh.id), 0);
  assert.equal(C.removeKeyframe(p2, t).keyframes.filter((k) => !k.auto).length, 0);
});

test('检查提示：短镜头、低置信、白板宽过取景框', () => {
  const p = C.demoPlan({scene: 'board', start: 0, end: 100});
  const f = C.flags(p, {srcRatio: 16 / 9, dstRatio: 9 / 16, zoom: 1});
  assert.ok(f.some((x) => /白板比取景框宽/.test(x.text)));
  const pod = C.demoPlan({scene: 'podcast', start: 0, end: 110});
  const pf = C.flags(pod, {srcRatio: 16 / 9, dstRatio: 9 / 16, zoom: 1});
  assert.ok(pf.some((x) => /太短/.test(x.text)));
  assert.ok(pf.some((x) => /不太确定/.test(x.text)));
  const none = C.flags(p, {srcRatio: 16 / 9, dstRatio: 16 / 9, zoom: 1});
  assert.ok(!none.some((x) => /白板/.test(x.text)));
});

test('场景 → 模型需求与就绪判断', () => {
  assert.deepEqual(C.needs('talk').map((m) => m.id), ['vision-person']);
  assert.deepEqual(C.needs('podcast', 'switch').map((m) => m.id), ['vision-person', 'vision-speaker']);
  assert.deepEqual(C.needs('podcast', 'split').map((m) => m.id), ['vision-person']);
  assert.equal(C.needs('auto').length, 3);
  const r = C.readiness('board', 'switch', (id) => id === 'vision-person');
  assert.equal(r.ok, false); assert.deepEqual(r.missing.map((m) => m.id), ['vision-content']);
  assert.equal(C.sizeText(0.23), '230 KB'); assert.equal(C.sizeText(3.4), '3.4 MB'); assert.equal(C.sizeText(88.1), '88 MB');
});

test('任务文案与输出记录：与原片时间对齐，名字带画幅与版本', () => {
  assert.equal(C.taskTitle('lecture.mp4', '9:16'), '智能裁剪 · lecture.mp4 → 9:16');
  assert.equal(C.outputName('lecture.mp4', '9:16', 1), 'lecture · 9x16.mp4');
  assert.equal(C.outputName('lecture.mp4', '9:16', 2), 'lecture · 9x16 v2.mp4');
  assert.equal(C.stageAt(C.ANALYSIS_STAGES, 50).name, '找重点');
  assert.match(C.analysisActivity(10, {dur: 206}), /^读取画面 · 1:01 \/ 3:26$/);
  assert.equal(C.tookText(102), '1 分 42 秒');
  const src = {id: 'v1', name: 'lecture.mp4', grad: 'g', meta: '1080p · 30 fps'};
  assert.equal(C.sourceRatio(src), 16 / 9);
  assert.equal(C.sourceRatio({naturalW: 1080, naturalH: 1920}), 9 / 16);
  const plan = C.demoPlan({scene: 'talk', start: 20, end: 80});
  const out = C.outputRecord({id: 'crop-1', source: src, ratio: '9:16', range: {start: 20, end: 80}, plan, scene: 'talk', version: 1});
  assert.equal(out.dur, 60); assert.equal(out.naturalH, 1920);
  assert.equal(out.crop.sourceId, 'v1'); assert.equal(out.crop.ratio, 9 / 16); assert.equal(out.crop.ratioId, '9:16');
  assert.deepEqual(C.rangeFromInstance({start: 10, end: 20, srcStart: 5, rate: 2}), {start: 5, end: 25});
});
