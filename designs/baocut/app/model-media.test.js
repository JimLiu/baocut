/* model-media.js —— 建项媒体探测。这一层的价值全在**确定性**上：
   同一个文件名在首页 hero、向导卡片、我的项目列表里必须探出同一份事实。 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-media.js');
const M = window.BC_MEDIA;

test('素材放置每次创建独立实例，音频保留完整长度且不带画布几何', () => {
  const source = {id: 's1', name: 'long.m4a', dur: 420};
  const a = M.placement('audio-1', 'audio', source, 204.87);
  const b = M.placement('audio-2', 'audio', source, 0);
  assert.notStrictEqual(a.id, b.id);
  assert.strictEqual(a.start, 204.8);
  assert.strictEqual(a.end, 624.8);
  assert.strictEqual(a.place, undefined);
  assert.strictEqual(M.placement('bad', 'audio', {...source, dur: 0}, 0), null);
  const img = M.placement('image-1', 'image', {id: 'i', name: 'cover.png'}, 0);
  assert.strictEqual(img.end, 4);
  assert.strictEqual(img.sourceId, 'i');
  assert.strictEqual(img.asset, 'cover.png');
});

test('素材移除保护转录源及使用中的素材，替换素材后按当前引用判断', () => {
  const a = {id: 'a', name: 'a.mp4'}, b = {id: 'b', name: 'b.mp4'};
  assert.ok(M.sourceUsed(a, [], 'a.mp4'));
  assert.ok(M.sourceUsed(a, [{asset: 'a.mp4', hidden: true}], 'main.mp4'));
  assert.ok(!M.sourceUsed(a, [], 'main.mp4'));
  const replaced = [{sourceId: 'a', asset: 'b.mp4'}];
  assert.ok(!M.sourceUsed(a, replaced, 'main.mp4'));
  assert.ok(M.sourceUsed(b, replaced, 'main.mp4'));
});

const KNOWN = [
  {duration: 206, src: {name: 'kelang-ep42-master.mp4', path: '~/Movies/播客/kelang-ep42-master.mp4', res: '1920×1080'}},
];

test('本地建项与媒体卡使用同一份元数据，项目和任务接收所选配置', () => {
  const options = {entry: 'trans', lang: 'en', model: 'whisper-large-v3', speakers: false,
    target: 'ja', transModel: 'agent', bilingual: false};
  const {project, task} = M.localProject('new-1', KNOWN[0].src.name, options, KNOWN);
  assert.strictEqual(project.id, task.project);
  assert.strictEqual(project.duration, 206);
  assert.strictEqual(project.src.path, KNOWN[0].src.path);
  assert.strictEqual(project.ratio, '16:9');
  assert.strictEqual(project.model, options.model);
  assert.strictEqual(project.lang, 'en');
  assert.deepStrictEqual(task.options, project.config);
  options.target = 'fr';
  assert.strictEqual(task.options.target, 'ja');
  assert.match(task.sub, /whisper-large-v3/);
});

test('连续建项保持身份隔离，音频元数据和画幅不被视频示例替代', () => {
  const first = M.localProject('one', '我的播客.m4a', {entry: 'a2v', ratio: '9:16', wave: false});
  const second = M.localProject('two', '我的播客.m4a', {entry: 'a2v', ratio: '1:1'});
  assert.notStrictEqual(first.task.project, second.task.project);
  assert.strictEqual(first.project.ratio, '9:16');
  assert.strictEqual(second.project.ratio, '1:1');
  assert.strictEqual(first.project.src.res, '');
  assert.match(first.project.src.path, /^~\/Music\//);
  const seed = M.projectMedia(first.project);
  assert.deepStrictEqual(seed.clips, []);
  assert.deepStrictEqual(seed.sources.video, []);
  assert.strictEqual(seed.sources.audio[0].name, '我的播客.m4a');
  assert.strictEqual(seed.audio, true);
});

test('新视频项目只初始化所选媒体的一段，不带示例剪辑或素材', () => {
  const {project} = M.localProject('new', KNOWN[0].src.name, {}, KNOWN);
  const seed = M.projectMedia(project);
  assert.deepStrictEqual(seed.clips, [{id: 'source', start: 0, end: 206, src: 0}]);
  assert.strictEqual(seed.sources.video.length, 1);
  assert.strictEqual(seed.sources.video[0].id, 'source-video');
  assert.deepStrictEqual(seed.sources.image, []);
  assert.deepStrictEqual(seed.sources.audio, []);
  assert.strictEqual(seed.audio, false);
  assert.strictEqual(project.entry, 'sub');
});

/* ---------- 本地文件 ---------- */

test('演示项目的源文件先查表：格式、分辨率、时长、目录都来自 data.js', () => {
  const i = M.probeFile('kelang-ep42-master.mp4', KNOWN);
  assert.strictEqual(i.kind, 'video');
  assert.strictEqual(i.container, 'MP4');
  assert.strictEqual(i.codec, 'H.264');
  assert.strictEqual(i.res, '1920×1080');
  assert.strictEqual(i.duration, 206);
  assert.strictEqual(i.dir, '~/Movies/播客');
  assert.strictEqual(i.path, '~/Movies/播客/kelang-ep42-master.mp4');
});

test('未命中的名字按名字折算，且同名两次完全一致', () => {
  const a = M.probeFile('随手拖进来的.mov', []);
  const b = M.probeFile('随手拖进来的.mov', []);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.container, 'MOV');
  assert.strictEqual(a.codec, 'ProRes');
  // 不同名字要算出不同的一张卡
  assert.notStrictEqual(M.probeFile('另一个.mov', []).duration, a.duration);
});

test('音频没有分辨率与画幅比，卡片副行因此少一格', () => {
  const i = M.probeFile('播客第 42 期.m4a', []);
  assert.strictEqual(i.kind, 'audio');
  assert.strictEqual(i.res, null);
  assert.strictEqual(i.ratio, null);
  assert.strictEqual(M.fileMeta(i, () => '03:26').split(' · ').length, 4);
  assert.strictEqual(M.fileMeta(M.probeFile('x.mp4', []), () => '03:26').split(' · ').length, 5);
  // 未命中演示表时的目录按类型给
  assert.strictEqual(i.dir, '~/Music');
  assert.strictEqual(M.probeFile('x.mp4', []).dir, '~/Movies');
});

test('kindOf 只认白名单里的后缀', () => {
  assert.strictEqual(M.kindOf('a.MP4'), 'video');
  assert.strictEqual(M.kindOf('a.flac'), 'audio');
  assert.strictEqual(M.kindOf('a.pdf'), 'other');
  assert.strictEqual(M.kindOf('没有后缀'), 'other');
});

test('大小由码率 × 时长折算，1024 MB 起进位到 GB', () => {
  assert.strictEqual(M.fmtSize(612), '612 MB');
  assert.strictEqual(M.fmtSize(1536), '1.5 GB');
  // 4K ProRes 的量级必须是几十 GB，不能和 1080p 一样大
  const pro = M.probeFile('keynote-4k.mov', [{duration: 3120, src: {name: 'keynote-4k.mov', path: '~/M/keynote-4k.mov', res: '3840×2160'}}]);
  assert.ok(pro.sizeMB > 10000, '4K ProRes 52 分钟应在 10 GB 以上，实得 ' + pro.sizeMB);
});

/* ---------- URL ---------- */

test('urlValid 与 mediaReady 是同一条判据', () => {
  assert.ok(!M.urlValid('youtube'));
  assert.ok(!M.urlValid('https://'));
  assert.ok(M.urlValid('https://www.youtube.com/watch?v=abc'));
  assert.ok(!M.mediaReady({src: 'url', url: 'nope'}));
  assert.ok(M.mediaReady({src: 'url', url: 'https://youtu.be/abc'}));
  assert.ok(!M.mediaReady({src: 'file', file: null}));
  assert.ok(M.mediaReady({file: 'a.mp4'}));           // src 缺省即本地档
});

test('站点名按域名认，认不出就写「网页」', () => {
  assert.strictEqual(M.probeUrl('https://www.youtube.com/watch?v=abc').site, 'YouTube');
  assert.strictEqual(M.probeUrl('https://b23.tv/xyz').site, '哔哩哔哩');
  assert.strictEqual(M.probeUrl('https://example.org/talk').site, 'example.org');
});

test('直链与页面地址是两种抓取：直链留原文件名，页面地址落 slug.mp4', () => {
  const d = M.probeUrl('https://cdn.example.org/media/ep42-master.mp4');
  assert.strictEqual(d.direct, 'mp4');
  assert.strictEqual(d.site, '直链');
  assert.strictEqual(d.saveName, 'ep42-master.mp4');
  const p = M.probeUrl('https://www.youtube.com/watch?v=abc');
  assert.strictEqual(p.direct, '');
  assert.ok(/\.mp4$/.test(p.saveName));
  assert.ok(p.saveName.length <= 32);
});

test('标题与频道成对取，不会出现「A 节目的标题挂在 B 频道名下」', () => {
  for (const u of ['https://a.example.com/x', 'https://b.example.com/y', 'https://c.example.com/z',
                   'https://www.youtube.com/watch?v=abc', 'https://b23.tv/xyz']) {
    const i = M.probeUrl(u);
    assert.ok(i.title.includes(i.channel), `${i.title} 与 ${i.channel} 对不上`);
  }
});

test('URL 探测同样确定性，且日期格式固定为 YYYY-MM-DD', () => {
  const a = M.probeUrl('https://www.youtube.com/watch?v=abc');
  const b = M.probeUrl('https://www.youtube.com/watch?v=abc');
  assert.deepStrictEqual(a, b);
  assert.match(a.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('文件决定默认意图与提示：音频推「音频转视频」，视频配 a2v 退回「加字幕」（第 225 轮）', () => {
  assert.strictEqual(M.wizardIntent('播客第 42 期.m4a'), 'a2v');
  assert.strictEqual(M.wizardIntent('kelang-ep42-master.mp4'), 'sub');
  assert.strictEqual(M.intentAdvice('a.mp3', 'sub').suggest, 'a2v');
  assert.strictEqual(M.intentAdvice('a.mp3', 'a2v').suggest, null);
  assert.match(M.intentAdvice('a.mp3', 'a2v').note, /声波/);
  assert.strictEqual(M.intentAdvice('a.mp3', 'trans').suggest, null, '音频配翻译是合理组合，不推翻');
  assert.match(M.intentAdvice('a.mp3', 'trans').note, /音频波形/);
  assert.strictEqual(M.intentAdvice('a.mp4', 'a2v').suggest, 'sub');
  assert.deepStrictEqual(M.intentAdvice('a.mp4', 'sub'), {kind: 'video', suggest: null, note: null});
  assert.strictEqual(M.bgToken('magenta'), 'var(--magenta-400)');
  assert.strictEqual(M.bgToken('gray'), 'var(--gray-300)');
  assert.strictEqual(M.bgToken('nope'), 'var(--gray-300)');
});

test('音频项目默认带声波、字幕与灰底，打开时预埋一条真的声波元素；视频项目不带（第 225 轮）', () => {
  const {project} = M.localProject('aud', '我的播客.m4a', {entry: 'sub', duration: 0});
  assert.strictEqual(project.config.wave, true);
  assert.strictEqual(project.config.subs, true);
  assert.strictEqual(project.config.bg, 'gray');
  const seed = M.projectMedia(project);
  assert.strictEqual(seed.elements.length, 1);
  assert.strictEqual(seed.elements[0].kind, 'wave');
  assert.strictEqual(seed.elements[0].end, project.duration, '声波铺到音频末端，不取演示时长');
  assert.strictEqual(seed.bg, 'var(--gray-300)');
  const off = M.localProject('aud2', '我的播客.m4a', {entry: 'a2v', wave: false, subs: false, bg: 'magenta'});
  assert.strictEqual(off.project.config.wave, false);
  assert.strictEqual(off.project.config.subs, false);
  const seedOff = M.projectMedia(off.project);
  assert.deepStrictEqual(seedOff.elements, []);
  assert.strictEqual(seedOff.subs, false);
  assert.strictEqual(seedOff.bg, 'var(--magenta-400)');
  const vid = M.localProject('vid', KNOWN[0].src.name, {wave: true, bg: 'blue'}, KNOWN);
  assert.strictEqual(vid.project.config.wave, false, '视频有画面，不预埋声波');
  assert.strictEqual(vid.project.config.bg, null);
  assert.deepStrictEqual(M.projectMedia(vid.project).elements, []);
  assert.strictEqual(M.projectMedia(vid.project).bg, null);
});
