const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-screen-view.js');
const SV = window.BC_SV;

const view = () => ({zooms: [
  {id: 'z1', t0: 2, t1: 5, scale: 2, focus: {kind: 'pointer'}, origin: 'auto'},
  {id: 'z2', t0: 10, t1: 14, scale: 2.5, focus: {kind: 'point', x: 0.3, y: 0.4}, origin: 'manual'},
]});

test('缩放区间经屏幕实例投到序列上：拆开、挪开之后各段只画自己源区间里的部分', () => {
  const screens = [{id: 'a', start: 0, end: 8, srcStart: 0}, {id: 'b', start: 20, end: 30, srcStart: 8}];
  const placed = SV.placeZooms(view(), screens);
  assert.deepEqual(placed.map((p) => [p.key, p.start, p.end, p.clipStart, p.clipEnd]), [
    ['a:z1', 2, 5, false, false],
    ['b:z2', 22, 26, false, false],
  ]);
  const cut = SV.placeZooms(view(), [{id: 'a', start: 0, end: 3, srcStart: 0}]);
  assert.equal(cut[0].end, 3);
  assert.equal(cut[0].clipEnd, true);
});

test('改一段自动缩放会记上「改过」，时刻夹在前后两段之间', () => {
  const v = SV.patchZoom(view(), 'z1', {t1: 12});
  const z1 = v.zooms[0];
  assert.equal(z1.t1, 10);
  assert.equal(z1.edited, true);
  assert.equal(SV.originLabel(z1), '自动 · 改过');
  assert.equal(SV.originLabel(v.zooms[1]), '手动');
  assert.equal(SV.patchZoom(view(), 'z1', {t0: 2}).zooms[0].edited, undefined, '没变化不记');
});

test('整段平移撞到邻居就停，长度不变', () => {
  const v = SV.patchZoom(view(), 'z1', {t0: 9, t1: 12}, {move: true});
  assert.deepEqual([v.zooms[0].t0, v.zooms[0].t1], [7, 10]);
});

test('倍率与过渡夹在范围里', () => {
  const v = SV.patchZoom(view(), 'z2', {scale: 20, rampIn: 5});
  assert.equal(v.zooms[1].scale, SV.ZOOM_MAX);
  assert.equal(v.zooms[1].rampIn, SV.RAMP_MAX);
  assert.equal(SV.patchZoom(v, 'z2', {rampIn: null}).zooms[1].rampIn, undefined);
});

test('在空档里拖出一段手动缩放；起点压在已有区间上不加', () => {
  const r = SV.addZoom(view(), 6, 12, 'z3');
  assert.deepEqual(r.view.zooms.map((z) => z.id), ['z1', 'z3', 'z2']);
  assert.deepEqual([r.view.zooms[1].t0, r.view.zooms[1].t1, r.view.zooms[1].origin], [6, 10, 'manual']);
  assert.equal(SV.addZoom(view(), 3, 4, 'x'), null);
  assert.equal(SV.addZoom(view(), 9.9, 12, 'x'), null, '夹完不够长');
  assert.deepEqual(SV.removeZoom(view(), 'z1').zooms.map((z) => z.id), ['z2']);
});

test('重新生成只替换没改过的自动区间', () => {
  const clicks = [{t: 1}, {t: 2.5}, {t: 11}, {t: 20}];
  const v0 = view();
  const r = SV.regenerate(v0, clicks, {duration: 30});
  assert.equal(r.kept, 1);
  assert.deepEqual(r.view.zooms.map((z) => [z.origin, z.t0, z.t1]), [['auto', 0.4, 4.1], ['manual', 10, 14], ['auto', 19.4, 21.6]]);
  const edited = SV.patchZoom(v0, 'z1', {scale: 3});
  const r2 = SV.regenerate(edited, clicks, {duration: 30});
  assert.ok(r2.view.zooms.some((z) => z.id === 'z1' && z.scale === 3));
});

test('取景框跟着倍率变大变小，夹在画面里', () => {
  assert.deepEqual(SV.framingRect({kind: 'point', x: 0.5, y: 0.5}, 2), {x: 0.25, y: 0.25, w: 0.5, h: 0.5});
  assert.deepEqual(SV.framingRect({kind: 'point', x: 0.95, y: 0.05}, 2), {x: 0.5, y: 0, w: 0.5, h: 0.5});
  assert.deepEqual(SV.focusFromRect(0.1, 0.2, 2), {kind: 'point', x: 0.35, y: 0.45});
});

test('光标录进画面或没有光标时整组置灰并说明', () => {
  assert.equal(SV.pointerNote('separate'), '');
  assert.match(SV.pointerNote('baked'), /录进了画面/);
  assert.match(SV.pointerNote('none'), /没有光标/);
  assert.equal(SV.pointerValue(SV.setPointer({}, 'size', 0.1), 'size'), SV.POINTER_SIZE_MIN);
  assert.equal(SV.followValue(SV.setFollow({}, 'safeArea', 2), 'safeArea'), 0.95);
});

test('联动组：拖一件带着整组，解组后各走各的；拆分时右边换新组', () => {
  const els = [
    {id: 's', start: 0, end: 10, link: 'g'}, {id: 'c', start: 0, end: 10, link: 'g'},
    {id: 'm', start: 6, end: 10, link: 'g'}, {id: 'x', start: 0, end: 10},
  ];
  assert.deepEqual(SV.withLinked(els, {}, ['s']).sort(), ['c', 'm', 's']);
  assert.deepEqual(SV.withLinked(els, {c: {link: null}}, ['s']).sort(), ['m', 's']);
  assert.deepEqual(SV.groupMembers(els, {}, 'g'), ['s', 'c', 'm']);
  assert.deepEqual(SV.splitPlan(els, {}, 'g', 4), {cut: ['s', 'c'], relink: ['m']});
  assert.equal(SV.splitPlan(els, {}, 'g', 12), null);
});

test('摄像头布局预设与识别；左右分屏把屏幕摆到左半边，换回角落时屏幕回全屏', () => {
  const cam = {id: 'c', pose: {x: 1, y: 1, w: 1, h: 1}, style: {}};
  const scr = {id: 's', pose: {x: 50, y: 50, w: 100, h: 100}, style: {}};
  const apply = (list, el) => Object.assign({}, el, ...(list.filter((p) => p.id === el.id).map((p) => p.patch)));
  SV.CAMERA_LAYOUTS.forEach(({k}) => {
    const ps = SV.cameraLayoutPatches(k, cam, [scr], 16 / 9);
    assert.equal(SV.cameraLayoutOf(apply(ps, cam)), k, k);
  });
  const circle = apply(SV.cameraLayoutPatches('corner-circle', cam, [scr], 16 / 9), cam);
  assert.equal(circle.pose.h, 35.56, '正圆：高度按画布比换算');
  const split = SV.cameraLayoutPatches('split', cam, [scr], 16 / 9);
  const left = apply(split, scr);
  assert.equal(left.pose.x, 25);
  assert.equal(apply(SV.cameraLayoutPatches('corner-circle', cam, [left], 16 / 9), left).pose.w, 100);
  assert.equal(SV.cameraLayoutOf(cam), null);
});

test('演示样式：全屏与缩小留边', () => {
  const scr = {pose: {x: 50, y: 50, w: 100, h: 100}, style: {radius: 0}};
  assert.equal(SV.presentationOf(scr), 'full');
  const inset = Object.assign({}, scr, SV.presentationPatch('inset', scr));
  assert.equal(SV.presentationOf(inset), 'inset');
  assert.equal(SV.presentationOf(Object.assign({}, inset, SV.presentationPatch('full', inset))), 'full');
});

test('一次录制落成同一联动组的四件元素，屏幕带取景文档', () => {
  const rec = {id: 'r', duration: 30, link: 'g', view: 'v', streams: {screen: {asset: 's.mp4'}, camera: {asset: 'c.mp4'}, microphone: {asset: 'm.m4a'}, system: {asset: 'y.m4a'}}};
  const els = SV.recordingElements(rec, {at: 5, prefix: 'n-'});
  assert.deepEqual(els.map((e) => [e.id, e.kind, e.role, e.start, e.end, e.link]), [
    ['n-screen', 'video', 'screen', 5, 35, 'g'], ['n-camera', 'video', 'camera', 5, 35, 'g'],
    ['n-mic', 'audio', 'microphone', 5, 35, 'g'], ['n-system', 'audio', 'system-audio', 5, 35, 'g'],
  ]);
  assert.equal(els[0].screenView, 'v');
  assert.equal(SV.cameraLayoutOf({pose: els[1].place, style: els[1].style}), 'corner-circle');
});
