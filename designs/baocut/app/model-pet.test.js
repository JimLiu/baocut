const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-pet.js');
require('./model-pet-catalog.js');
const P = window.BC_PET;
const C = window.BC_PETCAT;

test('图集几何：8 列、192×208，v1 九行 v2 十一行，尺寸与版本对得上', () => {
  assert.equal(P.COLS, 8);
  assert.deepEqual(P.CELL, {w: 192, h: 208});
  assert.deepEqual(P.sheetSize(1), {w: 1536, h: 1872});
  assert.deepEqual(P.sheetSize(2), {w: 1536, h: 2288});
  assert.ok(P.checkSheet(2, 1536, 2288));
  assert.ok(!P.checkSheet(1, 1536, 2288));
});

test('状态表 11 行、行号即下标，v2 独有的两行在 v1 上回落待机', () => {
  assert.equal(P.STATES.length, 11);
  P.STATES.forEach((s, i) => assert.equal(s.row, i));
  assert.equal(P.stateOf('look-000-157', 2).row, 9);
  assert.equal(P.stateOf('look-000-157', 1).key, 'idle');
  assert.equal(P.stateOf('nope').key, 'idle');
  assert.equal(P.statesFor(1).length, 9);
  assert.equal(P.statesFor(2).length, 11);
});

test('frameAt 按逐帧时长表走：待机 1100ms 一轮，循环、负数当 0', () => {
  assert.equal(P.cycleMs('idle'), 1100);
  assert.deepEqual(P.frameAt('idle', 0), {col: 0, row: 0, index: 0, count: 6});
  assert.equal(P.frameAt('idle', 279).col, 0);
  assert.equal(P.frameAt('idle', 280).col, 1);
  assert.equal(P.frameAt('idle', 390).col, 2);
  assert.equal(P.frameAt('idle', 1099).col, 5);
  assert.equal(P.frameAt('idle', 1100).col, 0);
  assert.equal(P.frameAt('idle', -5).col, 0);
  assert.equal(P.frameAt('waving', 0).row, 3);
  assert.equal(P.cycleMs('running-right'), 120 * 7 + 220);
  assert.equal(P.frameAt('running-right', 120 * 7 + 219).col, 7);
});

test('bgStyle 用百分比定位，不依赖盒子像素；第 0 格是 0% 0%，最后一格是 100% 100%', () => {
  assert.deepEqual(P.bgStyle(0, 0, 1), {backgroundSize: '800% 900%', backgroundPosition: '0% 0%'});
  assert.deepEqual(P.bgStyle(7, 8, 1).backgroundPosition, '100% 100%');
  assert.deepEqual(P.bgStyle(7, 10, 2), {backgroundSize: '800% 1100%', backgroundPosition: '100% 100%'});
  assert.equal(P.bgStyle(1, 0, 2).backgroundPosition, '14.2857% 0%');
  assert.deepEqual(P.posterStyle(2), P.bgStyle(0, 0, 2));
});

test('validatePetJson：缺版本算 v1，只认 1/2，spritesheetPath 必须是 zip 里的 .webp', () => {
  const ok = P.validatePetJson({displayName: 'Codex', spritesheetPath: 'spritesheet.webp'});
  assert.deepEqual(ok, {ok: true, version: 1, name: 'Codex', description: '', sheetPath: 'spritesheet.webp'});
  assert.equal(P.validatePetJson({displayName: 'x', spritesheetPath: 'a.webp', spriteVersionNumber: 2}).version, 2);
  assert.equal(P.validatePetJson({displayName: 'x', spritesheetPath: 'a.webp', spriteVersionNumber: 3}).reason, P.REASONS.version);
  assert.equal(P.validatePetJson({displayName: 'x'}).reason, P.REASONS.shape);
  assert.equal(P.validatePetJson({displayName: 'x', spritesheetPath: '../a.webp'}).reason, P.REASONS.path);
  assert.equal(P.validatePetJson({displayName: 'x', spritesheetPath: 'a.png'}).reason, P.REASONS.path);
  assert.equal(P.parsePetJson('{nope').reason, P.REASONS.parse);
  assert.equal(P.parsePetJson('{"displayName":"A","spritesheetPath":"s.webp","spriteVersionNumber":2}').version, 2);
});

test('pickEntries 认 awesome-codex-pet 的 pets/<slug>/ 布局与根目录布局，跳过 __MACOSX', () => {
  const nested = P.pickEntries([
    '__MACOSX/pets/a--b/._pet.json', 'pets/a--b/', 'pets/a--b/submission.json',
    'pets/a--b/pet.json', 'pets/a--b/spritesheet.webp',
  ]);
  assert.deepEqual(nested, {ok: true, json: 'pets/a--b/pet.json', sheet: 'pets/a--b/spritesheet.webp', dir: 'pets/a--b/'});
  const flat = P.pickEntries(['pet.json', 'sheet.webp'], 'sheet.webp');
  assert.deepEqual(flat, {ok: true, json: 'pet.json', sheet: 'sheet.webp', dir: ''});
  assert.equal(P.pickEntries(['readme.txt']).reason, P.REASONS.json);
  assert.equal(P.pickEntries(['pet.json']).reason, P.REASONS.sheet);
});

test('目录：官方 9 只全是 v2 且有随包路径；社区 239 只、11 类计数相加相等', () => {
  assert.equal(C.OFFICIAL.length, 9);
  C.OFFICIAL.forEach((o) => {
    assert.equal(o.version, 2);
    assert.equal(o.src, 'assets/pets/official/' + o.id + '/spritesheet.webp');
  });
  assert.equal(C.PETS.length, 239);
  assert.equal(C.CATS.length, 11);
  assert.equal(C.CATS.reduce((a, c) => a + c.count, 0), 239);
  C.CATS.forEach((c) => assert.equal(P.byCategory(C.PETS, c.slug).length, c.count));
  assert.equal(P.byCategory(C.PETS, 'all').length, 239);
  C.PETS.forEach((p) => assert.ok(p.version === 1 || p.version === 2, p.slug));
  assert.ok(C.PETS.every((p) => p.slug && p.name && p.cat));
});

test('搜索按中英文名 / 作者 / slug，署名串是「作者 · 许可」，NC 判得出', () => {
  const hits = P.search(C.PETS, '流萤');
  assert.ok(hits.length >= 1 && hits.every((p) => p.zh.indexOf('流萤') >= 0));
  assert.equal(P.search(C.PETS, '').length, 239);
  assert.equal(P.attribution({author: 'A', license: 'MIT'}), 'A · MIT');
  assert.equal(P.attribution({author: 'A'}), 'A');
  assert.ok(P.nonCommercial('CC BY-NC 4.0'));
  assert.ok(P.nonCommercial('Free for non-commercial use'));
  assert.ok(!P.nonCommercial('MIT'));
  assert.ok(!P.nonCommercial('CC BY 4.0'));
});

test('远端 URL 拼法与 meta 的默认袋', () => {
  assert.equal(P.thumbUrl('a--b'), 'https://codexpet.top/assets/previews/a--b/thumbnail.webp');
  assert.equal(P.previewUrl('a--b'), 'https://codexpet.top/assets/previews/a--b/webp/idle.webp');
  assert.equal(P.previewUrl('a--b', 'waving'), 'https://codexpet.top/assets/previews/a--b/webp/waving.webp');
  assert.equal(P.sheetUrl('a--b'), 'https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets/a--b/spritesheet.webp');
  assert.deepEqual(P.meta({version: 2, name: 'X', author: 'Y', license: 'MIT'}),
    {version: 2, state: 'idle', name: 'X', author: 'Y', license: 'MIT'});
  assert.equal(P.meta(null).version, 1);
});
