/* model-font-library.js —— 字体库的合表、排序、分段、行尾、进度、镜像、打开视频与导出的提示。
   product-design §5.9「字体」；architecture-design §9.1。 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./font-library-data.js');
require('./model-font-library.js');
const L = window.BC_FONTLIB;
const DATA = window.BC_FONTLIB_DATA;
const MB = 1024 * 1024;

const meta = (family, source, extra) => Object.assign({family, source, category: 'sans-serif', scripts: ['latin'], weights: [400, 700],
  italics: [], licence: 'OFL-1.1', rank: null, faceBytes: MB}, extra || {});

test('状态与 Runtime 同一套词：内置、本机不看缓存；下载中压过已下载与失败', () => {
  assert.strictEqual(L.stateOf(meta('A', 'built-in'), {faces: [400]}), 'built-in');
  assert.strictEqual(L.stateOf(meta('A', 'local'), {progress: {done: 1, total: 2}}), 'installed');
  const g = meta('G', 'google-fonts');
  assert.strictEqual(L.stateOf(g, null), 'downloadable');
  assert.strictEqual(L.stateOf(g, {error: {code: 'FONT_DOWNLOAD_NETWORK'}}), 'failed');
  assert.strictEqual(L.stateOf(g, {faces: [400]}), 'downloaded');
  assert.strictEqual(L.stateOf(g, {faces: [400], progress: {done: 0, total: null}}), 'downloading');
});

test('合表：旧目录里有名字、元数据里没有的族当本机的；样张写法用旧目录那一份', () => {
  const list = L.statuses({families: [meta('Roboto', 'google-fonts', {rank: 1})],
    samples: [{n: 'Roboto', st: "font-family:'Roboto'"}, {n: 'Mystery', st: 'font-weight:700'}]});
  assert.deepStrictEqual(list.map((f) => [f.family, f.state, f.st]),
    [['Roboto', 'downloadable', "font-family:'Roboto'"], ['Mystery', 'installed', 'font-weight:700']]);
});

test('次序：内置在前，已下载其次，再按目录热门，目录外的本机字体最后（按名字）', () => {
  const list = L.statuses({
    families: [meta('Zed', 'local'), meta('Cold', 'google-fonts', {rank: 900}), meta('Hot', 'google-fonts', {rank: 3}),
      meta('Kept', 'google-fonts', {rank: 500}), meta('Core', 'built-in', {rank: 40}), meta('Alpha', 'local')],
    runtime: {Kept: {faces: [400]}},
  });
  assert.deepStrictEqual(L.order(list).map((f) => f.family), ['Core', 'Kept', 'Hot', 'Cold', 'Alpha', 'Zed']);
});

test('筛选：族名包含（不分大小写）、分类、文字可以叠加', () => {
  const list = L.statuses({families: DATA.families});
  const cjkHand = L.filter(list, {script: 'chinese', category: 'handwriting'}).map((f) => f.family);
  assert.deepStrictEqual(cjkHand.sort(), ['Long Cang', 'Ma Shan Zheng']);
  assert.deepStrictEqual(L.filter(list, {query: 'noto sans', script: 'korean'}).map((f) => f.family), ['Noto Sans KR']);
});

test('分段：视频里用到、最近用过、品牌字体、全部；有检索或筛选时合成一条搜索结果', () => {
  const list = L.statuses({families: DATA.families});
  const secs = L.sections(list, {inVideo: DATA.inVideo.p1, recent: ['Lobster', 'Nope'], brand: ['Source Sans 3']});
  assert.deepStrictEqual(secs.map((s) => s.key), ['video', 'recent', 'brand', 'all']);
  assert.deepStrictEqual(secs[1].rows.map((f) => f.family), ['Lobster'], '目录里没有的名字不画');
  assert.strictEqual(secs[3].rows.length, list.length);
  const found = L.sections(list, {query: 'zcool', inVideo: DATA.inVideo.p1});
  assert.deepStrictEqual(found.map((s) => s.key), ['search']);
  assert.deepStrictEqual(found[0].rows.map((f) => f.family), ['ZCOOL KuaiLe']);
});

test('行尾：内置与本机是标签，可下载给大小，下载中给进度，失败与取消分开说', () => {
  const g = meta('G', 'google-fonts', {faceBytes: 5 * MB});
  const at = (rt) => L.rowEnd(L.statuses({families: [g], runtime: {G: rt}})[0]);
  assert.deepStrictEqual(at(null), {kind: 'download', label: '下载', size: '10.0 MB'});
  assert.deepStrictEqual(at({progress: {done: 3 * MB, total: 10 * MB}}), {kind: 'progress', label: '30%', value: 30});
  assert.deepStrictEqual(at({progress: {done: 1.5 * MB, total: null}}), {kind: 'progress', label: '1.5 MB', value: null});
  assert.strictEqual(at({error: {code: 'FONT_DOWNLOAD_NETWORK', message: '连不上字体服务'}}).label, '失败');
  assert.strictEqual(at({error: {code: 'CANCELLED', message: '已取消'}}).label, '已取消');
  assert.strictEqual(L.rowEnd(L.statuses({families: [meta('B', 'built-in')]})[0]).label, '内置');
});

test('默认下载常规与粗体，按这个族实际有的字重对齐，同一个只算一次', () => {
  assert.deepStrictEqual(L.defaultFaces({weights: [300, 500, 900]}), [500, 900]);
  assert.deepStrictEqual(L.defaultFaces({weights: [400]}), [400]);
});

test('镜像地址只接受 https，不带账号、查询参数与片段；空是用默认', () => {
  assert.strictEqual(L.mirrorError(''), null);
  assert.strictEqual(L.mirrorError('https://fonts.example.cn/css'), null);
  assert.match(L.mirrorError('http://fonts.example.cn'), /https/);
  assert.match(L.mirrorError('https://u:p@fonts.example.cn'), /账号/);
  assert.match(L.mirrorError('https://fonts.example.cn/?k=1'), /查询/);
  assert.match(L.mirrorError('fonts'), /有效/);
});

test('已下载列表只列下载缓存里的族，导出在用的标出来；总大小是各族之和', () => {
  const list = L.statuses({families: DATA.families, runtime: {'Lobster': {faces: [400]}, 'Noto Sans JP': {faces: [700, 400]}}});
  const got = L.downloadedList(list, ['Lobster']);
  assert.deepStrictEqual(got.rows.map((r) => [r.family, r.faces, r.inUse]), [['Lobster', [400], true], ['Noto Sans JP', [400, 700], false]]);
  assert.strictEqual(got.totalBytes, 0.4 * MB + 2 * 5.3 * MB);
});

test('打开视频的字体条：进行中念第几个与进度，全到了说就绪，没取到的列出回退字体与原因', () => {
  const list = L.statuses({families: DATA.families, runtime: {'Ma Shan Zheng': {progress: {done: 2.8 * MB, total: 5.6 * MB}}}});
  const byName = Object.fromEntries(list.map((f) => [f.family, f]));
  const job = {families: ['Ma Shan Zheng', 'ZCOOL KuaiLe'], results: {}, mode: 'auto'};
  assert.deepStrictEqual(L.openStrip(job, byName), {kind: 'running', title: '正在下载这个视频用到的字体', count: '1/2',
    current: 'Ma Shan Zheng', progress: '50%', value: 50});
  assert.strictEqual(L.openStrip({...job, results: {'Ma Shan Zheng': 'ok', 'ZCOOL KuaiLe': 'ok'}}, byName).kind, 'ready');
  const missed = L.openStrip({...job, results: {'Ma Shan Zheng': 'ok', 'ZCOOL KuaiLe': 'skipped'}}, byName);
  assert.strictEqual(missed.title, '1 个字体没取到，正在用回退字体显示');
  assert.deepStrictEqual(missed.rows, [{family: 'ZCOOL KuaiLe', fallback: 'Noto Sans SC', reason: '已跳过'}]);
  assert.strictEqual(L.openStrip({...job, mode: 'off'}, byName).kind, 'off');
  assert.strictEqual(L.openStrip({...job, dismissed: true}, byName), null);
});

test('导出面板的字体提示：在下载的会等，没成功的说用什么代替，没下载的说明自动下载关着', () => {
  const list = L.statuses({families: DATA.families, runtime: {
    'Lobster': {faces: [400]}, 'Ma Shan Zheng': {progress: {done: 1, total: 2}}, 'ZCOOL KuaiLe': {error: {code: 'FONT_DOWNLOAD_NETWORK', message: 'x'}}}});
  const lines = L.exportNote(list, DATA.inVideo.p1, true);
  assert.deepStrictEqual(lines.map((l) => [l.tone, l.families, l.action]),
    [['info', ['Ma Shan Zheng'], undefined], ['notice', ['ZCOOL KuaiLe'], '重试']]);
  assert.match(lines[1].text, /Noto Sans SC/);
  const off = L.exportNote(L.statuses({families: DATA.families}), DATA.inVideo.p1, false);
  assert.match(off[0].text, /自动下载已关闭/);
  const on = L.exportNote(L.statuses({families: DATA.families}), ['Lobster'], true);
  assert.deepStrictEqual(on.map((l) => [l.tone, l.action]), [['info', '现在下载']]);
  assert.match(on[0].text, /导出开始时先下载/);
  assert.deepStrictEqual(L.exportNote(L.statuses({families: DATA.families}), ['Poppins'], true), []);
});

test('演示数据：用到的族都在表里；会失败的族是可下载的；已下载的字重是这个族有的', () => {
  const names = new Set(DATA.families.map((f) => f.family));
  DATA.inVideo.p1.forEach((n) => assert.ok(names.has(n), n));
  DATA.flaky.forEach((n) => assert.strictEqual(DATA.families.find((f) => f.family === n).source, 'google-fonts'));
  Object.entries(DATA.initial).forEach(([n, v]) => {
    const f = DATA.families.find((x) => x.family === n);
    assert.strictEqual(f.source, 'google-fonts', n);
    v.faces.forEach((w) => assert.ok(f.weights.includes(w), n + ' ' + w));
  });
});

test('导出钉住的族：只算还没结束的导出', () => {
  const tasks = [{kind: 'export', status: 'running', fontPins: ['A', 'B']}, {kind: 'export', status: 'done', fontPins: ['C']},
    {kind: 'export', status: 'queued', fontPins: ['B']}, {kind: 'translate', status: 'running', fontPins: ['D']}];
  assert.deepStrictEqual(L.exportPins(tasks), ['A', 'B']);
});

test('打开着的选字框行序不动：下载完成的族留在原位，关了再开才进「已下载」那一档', () => {
  const before = L.statuses({families: DATA.families});
  const key = L.orderKey(before);
  const after = L.statuses({families: DATA.families, runtime: {'Lacquer': {faces: [400]}}});
  const names = (secs) => secs.find((s) => s.key === 'all').rows.map((f) => f.family);
  assert.deepStrictEqual(names(L.sections(after, {frozen: key})), names(L.sections(before, {})));
  assert.notDeepStrictEqual(names(L.sections(after, {})), names(L.sections(before, {})));
});
