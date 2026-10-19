const test = require('node:test');
const assert = require('node:assert');
global.window = {};
['substyle', 'pose', 'shape-paths', 'elements', 'textpresets', 'wordanim', 'subanim', 'subpresets', 'motioncaption', 'template', 'cut', 'defaultsub']
  .forEach((m) => require(`./model-${m}.js`));
require('./data.js');
require('./model-video-versions.js');
require('./model-video-changes.js');
const V = global.window.BC_VIDEO_VERSIONS;
const C = global.window.BC_VIDEO_CHANGES;
const D = global.window.BC_DATA;
const names = {claude: 'Claude Code'};

test('撤销历史：版本的动作拆成一笔一笔，新的在前，至多 100 笔', () => {
  const list = C.fromVersions(V.normalize(D.videoVersions.p1), names);
  assert.ok(list.length > 50 && list.length <= C.LIMIT);
  const many = V.normalize({list: [{n: 1, at: [60, 0], revs: [1, 151], actions: [['user_local', '移动片段', 150]]}]});
  assert.equal(C.fromVersions(many, names).length, C.LIMIT);
  // 最新一版最后一笔是「修改文字」，修订号是这一版结束时的
  assert.deepEqual([list[0].label, list[0].rev, list[0].actor], ['修改文字', 327, '你']);
  assert.match(C.meta(list[0]), /^修订 327 · 你 · /);
  assert.ok(list.some((e) => e.actor === 'Claude Code' && e.label === '剪掉片段'));
  // 保存版本只建检查点，不给撤销
  const saved = list.find((e) => e.label === '保存版本');
  assert.equal(saved.undoAvailable, false);
  for (let i = 1; i < list.length; i += 1) assert.ok(list[i].min >= list[i - 1].min, '时间从新到旧');
});

test('撤销历史从重建开始；不在项目里的视频照样有', () => {
  // p14 最新一版是重建：之前的修改不在撤销历史里
  assert.deepEqual(C.fromVersions(V.normalize(D.videoVersions.p14), names), []);
  const outside = V.scenario(V.normalize(V.seed({id: 'x', mtime: 30})), 'outside');
  assert.equal(outside.versions.length, 0);
  assert.ok(C.fromVersions(V.normalize(V.seed({id: 'x', mtime: 30})), names).length > 0);
});

test('单独撤销一笔：它标已撤销，撤销本身是最上面的新一笔', () => {
  const list = C.fromVersions(V.normalize(D.videoVersions.p1), names);
  const target = list[3];
  const next = C.undo(list, target.id);
  assert.equal(next[0].label, `撤销：${target.label}`);
  assert.equal(next[0].rev, list[0].rev + 1);
  assert.equal(next[0].undoAvailable, false);
  assert.equal(next.find((e) => e.id === target.id).undone, true);
  assert.equal(next.length, list.length + 1);
  // 已撤销的、不给撤销的再点不变
  assert.equal(C.undo(next, target.id), next);
  const saved = list.find((e) => !e.undoAvailable);
  assert.equal(C.undo(list, saved.id), list);
});
