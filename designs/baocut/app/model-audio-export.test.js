const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-export.js');
require('./model-audio-export.js');
const X = global.window.BC_EXPORT;
const A = global.window.BC_AEXPORT;

/* 生效清单的形状与 BC_EXPORT.apply 的返回一致：字幕 / 元素 / 声音混在一起，音频页只挑会发声的。
   2026-09-16 起没有主视频：原声跟着视频元素走，所以元素组里的 `el:v1` 才是「原声」那一条。 */
const ELS = [
  {id: 'v1', kind: 'video', name: '访谈 · 第一段'},
  {id: 'v2', kind: 'video', name: '访谈 · 第二段'},
  {id: 's1', kind: 'sticker', name: '贴纸'},
];
const lanes = () => [
  {key: 'subs:zh', kind: 'subs', label: '中文', on: true},
  {key: 'els', kind: 'els', label: '元素', on: true, items: [
    {key: 'el:v1', id: 'v1', label: '访谈 · 第一段', on: true},
    {key: 'el:v2', id: 'v2', label: '访谈 · 第二段', on: true},
    {key: 'el:s1', id: 's1', label: '贴纸', on: true},
  ]},
  {key: 'music', kind: 'music', label: '音乐', sub: '背景音乐', on: true},
  {key: 'dub:en', kind: 'dub', id: 'en', label: '配音 · English', on: true},
  {key: 'bed:en', kind: 'bed', id: 'en', label: '背景声 · English', on: true},
];
/* 拨一条的开关（元素在组里，别的在顶层） */
const on = (ls, key, v) => ls.map((l) => {
  if (l.key === key) return Object.assign({}, l, {on: v});
  if (l.kind !== 'els') return l;
  return Object.assign({}, l, {items: l.items.map((i) => (i.key === key ? Object.assign({}, i, {on: v}) : i))});
});

test('soundLanes：视频元素的声音折成「原声」一组，贴纸这类不发声的不进清单', () => {
  const ls = A.soundLanes(lanes(), ELS);
  assert.deepEqual(ls.map((l) => l.key), ['orig', 'music', 'dub:en', 'bed:en']);
  assert.deepEqual(ls[0].items.map((i) => i.key), ['el:v1', 'el:v2']);
  assert.equal(ls[0].on, true);
  // 组的开关是「还有一件开着没有」：关掉一件仍算开着，两件都关才灭
  assert.equal(A.soundLanes(on(lanes(), 'el:v1', false), ELS)[0].on, true);
  assert.equal(A.soundLanes(on(on(lanes(), 'el:v1', false), 'el:v2', false), ELS)[0].on, false);
  assert.deepEqual(A.soundKeys(ls), ['el:v1', 'el:v2', 'music', 'dub:en', 'bed:en']);
  assert.equal(A.anyOn(lanes(), ELS), true);
  assert.equal(A.anyOn([{key: 'els', kind: 'els', items: [{key: 'el:s1', id: 's1', on: true}]}], ELS), false);
});

test('soundLanes：纯音频项目走原声轨那一条（没有视频元素）', () => {
  const ls = A.soundLanes([{key: 'audio', kind: 'audio', label: '原声', on: true},
    {key: 'music', kind: 'music', label: '音乐', on: false}], []);
  assert.deepEqual(ls.map((l) => l.key), ['audio', 'music']);
  assert.equal(A.isOrig(ls[0]), true);
});

test('presets：按项目真有的那几种声音出档；只有一条声音时不出快速选择', () => {
  assert.deepEqual(A.presets(lanes(), ELS).map((p) => p.k), ['mix', 'orig', 'dub', 'music']);
  const noDub = lanes().filter((l) => l.kind !== 'dub' && l.kind !== 'bed');
  assert.deepEqual(A.presets(noDub, ELS).map((p) => p.k), ['mix', 'orig', 'music']);
  assert.deepEqual(A.presets([{key: 'music', kind: 'music', on: true}], []), []);
});

test('presetTarget / applyPreset：只动会发声的那几条，贴纸一个不碰', () => {
  const ls = lanes();
  assert.deepEqual(A.presetTarget(ls, ELS, 'orig'),
    {'el:v1': true, 'el:v2': true, music: false, 'dub:en': false, 'bed:en': false});
  const ov = A.applyPreset(ls, ELS, {'el:s1': false}, 'dub');
  assert.deepEqual(ov, {'el:s1': false, 'el:v1': false, 'el:v2': false, music: false, 'dub:en': true, 'bed:en': true});
  // mix 回到时间轴上的启停位：时间轴里关着的那条，点「成片混音」之后仍是关着
  assert.equal(A.presetTarget(on(ls, 'music', false), ELS, 'mix').music, false);
});

test('presetOf：当前取舍等于哪一档就亮哪一颗，都不等于就一颗不亮', () => {
  const ls = lanes();
  assert.equal(A.presetOf(ls, ELS, ls), 'mix');
  const dubOnly = on(on(on(ls, 'el:v1', false), 'el:v2', false), 'music', false);
  assert.equal(A.presetOf(ls, ELS, dubOnly), 'dub');
  assert.equal(A.presetOf(ls, ELS, on(dubOnly, 'bed:en', false)), null);
});

test('voiceLanes：几件视频元素的声音合起来算一条原声，配音另算', () => {
  const ls = lanes();
  assert.deepEqual(A.voiceLanes(ls, ELS).map((v) => [v.id, v.tag]), [['audio', '原声'], ['en', 'EN']]);
  assert.equal(A.voiceModeDefault(ls, ELS), 'each');
  const noOrig = on(on(ls, 'el:v1', false), 'el:v2', false);
  assert.deepEqual(A.voiceLanes(noOrig, ELS).map((v) => v.id), ['en']);
  assert.equal(A.voiceModeDefault(noOrig, ELS), 'one');
});

test('voiceParts：每种一份时各带自己的背景声，音乐进每一份', () => {
  const ls = lanes();
  const each = A.voiceParts(ls, ELS, 'each');
  assert.deepEqual(each.map((p) => p.sub), ['原声 + 音乐', '配音 · English + 背景声 + 音乐']);
  const one = A.voiceParts(ls, ELS, 'one', 'en');
  assert.equal(one.length, 1);
  assert.equal(one[0].sub, '配音 · English + 背景声 + 音乐 · 其余 1 条人声不进文件');
  // 关掉背景声后那一份就不带它了
  assert.equal(A.voiceParts(on(ls, 'bed:en', false), ELS, 'one', 'en')[0].sub.indexOf('背景声'), -1);
});

test('voiceParts：一条人声都没开也还有一份纯音乐，一条声音不剩才是空', () => {
  const ls = on(on(on(lanes(), 'el:v1', false), 'el:v2', false), 'dub:en', false);
  const parts = A.voiceParts(ls, ELS, 'each');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].tag, '');
  assert.equal(parts[0].sub, '音乐 + 背景声 · English');
  const silent = on(on(ls, 'music', false), 'bed:en', false);
  assert.deepEqual(A.voiceParts(silent, ELS, 'each'), []);
});

test('audioFiles：单份不带人声标签，多份带；范围标签沿用 spanOf', () => {
  const ls = lanes();
  const whole = X.spanOf('all', {dur: 206});
  assert.deepEqual(A.audioFiles('访谈', {eff: ls, els: ELS, span: whole, fmt: 'mp3', mode: 'each'}).map((f) => f.name),
    ['访谈 原声.mp3', '访谈 EN.mp3']);
  assert.deepEqual(A.audioFiles('访谈', {eff: ls, els: ELS, span: whole, fmt: 'wav', mode: 'one', pick: 'audio'}).map((f) => f.name),
    ['访谈 原声.wav']);
  const solo = on(ls, 'dub:en', false);
  assert.deepEqual(A.audioFiles('访谈', {eff: solo, els: ELS, span: whole, fmt: 'mp3', mode: 'one'}).map((f) => f.name),
    ['访谈.mp3']);
  const chapters = X.spanOf('chapters', {chapters: [
    {id: 'c1', start: 0, end: 60, title: '开场'}, {id: 'c2', start: 120, end: 180, title: '结尾'}], ids: ['c1', 'c2'], dur: 206});
  assert.deepEqual(A.audioFiles('访谈', {eff: solo, els: ELS, span: chapters, fmt: 'mp3', mode: 'one'}).map((f) => f.name),
    ['访谈 第1+2章.mp3']);
  // 「每种一份」× 范围「各出一份」= 两者的乘积
  assert.deepEqual(A.audioFiles('访谈', {eff: ls, els: ELS, span: chapters, each: true, fmt: 'mp3', mode: 'each'}).map((f) => f.name),
    ['访谈 原声 第1章.mp3', '访谈 EN 第1章.mp3', '访谈 原声 第2章.mp3', '访谈 EN 第2章.mp3']);
});

test('bitrate / estimate：WAV 按采样率算、单声道减半；有损照选中的档，体积按份数乘', () => {
  assert.equal(A.bitrate('wav', 192, 'stereo'), 1536);
  assert.equal(A.bitrate('wav', 192, 'mono'), 768);
  assert.equal(A.bitrate('mp3', 320, 'mono'), 320);
  assert.equal(A.bitrate('mp3', 999, 'stereo'), A.DEFAULT_BITRATE);
  const e = A.estimate(600, {fmt: 'mp3', kbps: 192, ch: 'stereo', files: 2});
  assert.equal(e.kbps, 192);
  assert.equal(Math.round(e.bytes / 1e6), 14);
  assert.equal(Math.round(e.total / 1e6), 29);
  // 耗时按实时的 40 倍估，再短也写 1 秒
  assert.equal(A.estimate(600, {fmt: 'mp3', files: 1}).ms, 15000);
  assert.equal(A.estimate(2, {fmt: 'wav', files: 1}).ms, 1000);
});

test('qualityLine / summary / taskSub：三处念同一套读法', () => {
  const ls = lanes();
  const span = X.spanOf('all', {dur: 206});
  assert.equal(A.qualityLine('wav', 192, 'stereo'), 'WAV · 48 kHz · 16-bit');
  assert.equal(A.qualityLine('mp3', 320, 'stereo'), 'MP3 · 320 kbps');
  assert.deepEqual(A.summary(ls, {els: ELS, span, fmt: 'mp3', kbps: 192, ch: 'stereo', mode: 'each'}),
    ['整片 3:26', 'MP3 · 192 kbps', '立体声', '2 份 · 原声 / 配音 · English']);
  const solo = on(ls, 'dub:en', false);
  assert.deepEqual(A.summary(solo, {els: ELS, span, fmt: 'wav', ch: 'mono', mode: 'one'}),
    ['整片 3:26', 'WAV · 48 kHz · 16-bit', '单声道', '原声 + 音乐']);
  assert.equal(A.taskSub(solo, {els: ELS, span, fmt: 'mp3', kbps: 128, ch: 'mono'}), 'mp3 · 128 kbps · 单声道 · 原声');
});
