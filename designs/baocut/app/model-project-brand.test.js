const test = require('node:test');
const assert = require('node:assert');
global.window = {};
['substyle', 'pose', 'shape-paths', 'elements', 'textpresets', 'wordanim', 'subanim', 'subpresets', 'motioncaption', 'template', 'cut', 'defaultsub']
  .forEach((m) => require(`./model-${m}.js`));
require('./data.js');
require('./model-agent-skills.js');
require('./model-skill-package.js');
require('./model-project-brand.js');
const B = global.window.BC_PROJECT_BRAND;
const D = global.window.BC_DATA;

const dirs = [{id: 'd1', name: '科浪访谈', path: '~/BaoCut/科浪访谈/'}, {id: 'd2', name: '空项目', path: '~/BaoCut/空/'}];

test('一句话：front matter 的 description 优先，没有就取第一段正文（跳过标题、列表与表格）', () => {
  assert.equal(B.summaryOf('---\ndescription: 统一规范\n---\n\n# 标题\n\n正文'), '统一规范');
  assert.equal(B.summaryOf('# 标题\n\n- 列表\n\n第一段\n接着写\n\n第二段'), '第一段 接着写');
  assert.equal(B.summaryOf(''), '');
});

test('画成 skill：source 是 project，id 不会和 skill 撞，位置是项目里的 BRAND.md；没有 BRAND.md 的项目不出现', () => {
  const brands = [{dir: 'd1', updated: '2026-10-12', files: [{path: 'BRAND.md', body: '# x\n\n和做事的人聊做事'}]}];
  const rows = B.list(brands, dirs);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'project:d1');
  assert.equal(rows[0].source, 'project');
  assert.equal(rows[0].path, '~/BaoCut/科浪访谈/BRAND.md');
  assert.equal(rows[0].description, '和做事的人聊做事');
  assert.equal(rows[0].enabled, true);
  assert.ok(B.hasBrand(brands, 'd1') && !B.hasBrand(brands, 'd2'));
  assert.deepEqual(B.find(rows, '聊做事').length, 1);
  assert.deepEqual(B.find(rows, '字幕').length, 0);
});

test('从品牌 skill 生成：去掉 front matter，素材与参考文件进 brand/，正文路径跟着改，脚本不带', () => {
  const skill = {files: [
    {path: 'SKILL.md', body: '---\nname: a\ndescription: d\n---\n\n# 品牌\n\n- assets/seal.svg：印章；assets/seal.svg 浅色版\n- 按 references/publish.md 写文案；my-assets/x 不动'},
    {path: 'assets/seal.svg', body: '<svg/>'}, {path: 'references/publish.md', body: '#'}, {path: 'scripts/run.mjs', body: ''}, {path: 'brand.json', body: '{}'}]};
  const files = B.fromSkill(skill);
  assert.deepEqual(files.map((f) => f.path), ['BRAND.md', 'brand/seal.svg', 'brand/publish.md', 'brand/brand.json']);
  assert.match(files[0].body, /^# 品牌/);
  assert.match(files[0].body, /brand\/seal\.svg/);
  assert.match(files[0].body, /brand\/publish\.md/);
  assert.doesNotMatch(files[0].body, /(^|[^-])(assets|references)\//m);
  assert.match(files[0].body, /my-assets\/x/);
});

test('模板、保存与移除；差量只存动过的', () => {
  const demo = [{dir: 'd1', files: [{path: 'BRAND.md', body: 'a'}]}, {dir: 'd5', files: [{path: 'BRAND.md', body: 'b'}]}];
  assert.match(B.template(dirs[1])[0].body, /^# 空项目 · 品牌/);
  let cur = B.save(demo, 'd2', B.template(dirs[1]), '2026-10-16');
  cur = B.remove(cur, 'd5');
  const snap = B.snapshot(demo, cur);
  assert.deepEqual(snap.changed.map((b) => b.dir), ['d2']);
  assert.deepEqual(snap.removed, ['d5']);
  const back = B.apply(demo, JSON.parse(JSON.stringify(snap)));
  assert.deepEqual(back.map((b) => b.dir).sort(), ['d1', 'd2']);
  assert.deepEqual(B.apply(demo, null).map((b) => b.dir), ['d1', 'd5']);
});

test('演示数据：项目品牌挂在真实项目上，每份都有 BRAND.md，素材路径在 brand/ 下', () => {
  assert.ok(D.projectBrands.length >= 2);
  D.projectBrands.forEach((b) => {
    assert.ok(D.agentProjects.some((d) => d.id === b.dir), b.dir);
    assert.ok(B.brandFile(b), b.dir);
    b.files.filter((f) => f.path !== 'BRAND.md').forEach((f) => assert.match(f.path, /^brand\//));
    assert.ok(B.summaryOf(B.brandFile(b).body));
  });
});

test('只这条消息不用：提示词末尾带一行，空提示词也带', () => {
  assert.equal(B.withoutBrand('做一期'), '做一期\n' + B.SKIP_LINE);
  assert.equal(B.withoutBrand(''), B.SKIP_LINE);
});
