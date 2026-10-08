const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.window = global.window || {};
require('./model-newproject.js');
const DATA = require('./model-home-templates-data.js');
const T = require('./model-home-templates.js');
const N = global.window.BC_NEW;
const P = require('./model-prompt-slots.js');
const TEMPLATES_DIR = path.resolve(__dirname, '../../../templates');

test('生成的数据与仓库顶层 templates/ 一一对应：每个目录一条，清单字段与 prompt.md 全文原样', () => {
  const dirs = fs.readdirSync(TEMPLATES_DIR, {withFileTypes: true})
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(TEMPLATES_DIR, d.name, 'template.json'))).map((d) => d.name).sort();
  assert.deepEqual(DATA.map((d) => d.id), dirs);
  for (const d of DATA) {
    const m = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, d.id, 'template.json'), 'utf8'));
    assert.deepEqual([d.kind, d.category, d.title, d.summary, d.description, d.ratio, d.durationSeconds, d.brief, d.skills, d.source, d.author],
      [m.kind, m.category, m.title, m.summary, m.description, m.ratio || null, m.durationSeconds || null, m.brief || null, m.skills || [], m.source, m.author], d.id);
    assert.deepEqual(d.fields, (m.fields || []).map((f) => ({label: f.label, hint: f.hint || null, example: f.example || null})), d.id);
    assert.equal('sample' in d, false, d.id);
    assert.deepEqual(d.beats, m.preview.beats, d.id);
    assert.equal(d.prompt, fs.readFileSync(path.join(TEMPLATES_DIR, d.id, 'prompt.md'), 'utf8').trim(), d.id);
  }
});

test('模板库的数据自洽：键唯一，分类、画幅、时长都认得；场景模板有默认画幅时长与 brief，作品示例可以都不写', () => {
  assert.equal(new Set(T.TEMPLATES.map((t) => t.k)).size, T.TEMPLATES.length);
  assert.ok(T.TEMPLATES.length > T.PER_PAGE * 2);
  T.TEMPLATES.forEach((t) => {
    assert.ok(T.CATEGORIES.some((c) => c.k === t.cat && c.k !== 'all'), t.k);
    assert.ok(t.kind === 'scene' || t.kind === 'example', t.k);
    assert.ok(!t.ratio || N.RATIOS.includes(t.ratio), t.k);
    assert.ok(!t.length || N.lengthLabel(t.length), t.k);
    if (t.kind === 'scene') assert.ok(t.ratio && t.length && t.brief && t.sample, t.k);
    if (t.kind === 'example') assert.equal(t.sample, '', t.k);
    /* 待填项（template-spec §5.5）：文本里出现的占位符都在 fields 里登记，label 唯一，≤ 8 项。 */
    const labels = t.fields.map((f) => f.label);
    assert.equal(new Set(labels).size, labels.length, t.k);
    assert.ok(labels.length <= 8, t.k);
    P.labels(t.kind === 'scene' ? t.brief : t.body).forEach((l) => assert.ok(labels.includes(l), `${t.k}: ${l}`));
    assert.ok(!P.labels(t.sample).length, t.k);
    assert.ok(Array.isArray(t.skills), t.k);
    assert.ok(t.beats.length >= 3 && T.prompt(t), t.k);
    assert.equal(!!T.assetCount(t), !!t.size, t.k);
    assert.ok(t.author, t.k);
  });
  assert.ok(T.CATEGORIES.slice(1).every((c) => T.find('', {category: c.k}).length), '七个分类都有模板');
  const official = T.find('', {source: 'official'});
  assert.equal(official.length, DATA.length);
  assert.ok(official.every((t) => !T.assetCount(t)), '内置模板现在都不带素材');
  assert.ok(T.find('', {source: 'community'}).every((t) => /^示例作者/.test(t.author)), '社区的是演示数据');
  assert.ok(T.SHELF_DEFAULT.every((k) => T.get(k).source === 'official'));
});

test('时长从清单的秒数换成 Home 时长滑杆的写法', () => {
  assert.equal(T.get('knowledge-explainer').length, '90s');
  assert.equal(N.lengthLabel(T.get('knowledge-explainer').length), '约 1 分钟 30 秒');
  assert.equal(T.get('vlog-edit').length, '180s');
  assert.equal(T.get('ai-news-take').length, null);
  assert.equal(T.get('ai-news-take').ratio, null);
});

test('起始页网格摆最近用过的八个，两类混排、分类分散；从模板库挑的排到最前，已在网格里的不挪位置', () => {
  const def = T.shelf(null);
  const rest = T.SHELF_DEFAULT.slice(0, T.SHELF_MAX - 1);
  assert.equal(T.SHELF_MAX, 8);
  assert.deepEqual(def.map((t) => t.k), T.SHELF_DEFAULT);
  assert.deepEqual(def.map((t) => t.kind), ['scene', 'scene', 'scene', 'example', 'scene', 'scene', 'scene', 'example']);
  assert.equal(new Set(def.map((t) => t.cat)).size, T.CATEGORIES.length - 1, '七个分类都有');
  assert.equal(new Set(def.map((t) => t.tone)).size, T.SHELF_MAX, '封面颜色不重复');
  assert.deepEqual(T.shelf(['event-recap', 'nope', 'event-recap']).map((t) => t.k), ['event-recap'].concat(rest));
  assert.deepEqual(T.shelf(['vlog-edit']).map((t) => t.k), ['vlog-edit'].concat(T.SHELF_DEFAULT.filter((k) => k !== 'vlog-edit')), '默认里已有的不重复');
  assert.deepEqual(T.shelfAfterPick(null, 'data-story'), T.SHELF_DEFAULT);
  assert.deepEqual(T.shelfAfterPick(null, 'game-trailer'), ['game-trailer'].concat(rest));
  assert.deepEqual(T.shelfAfterPick(['game-trailer'], 'nope'), ['game-trailer'].concat(rest));
});

test('筛选与分页：类型、分类、来源、搜索词可以叠加，页码越界收回有效范围', () => {
  assert.equal(T.find('', {kind: 'scene', source: 'official'}).length, 12);
  assert.equal(T.find('', {kind: 'example', source: 'official'}).length, 12);
  assert.ok(T.find('', {kind: 'example'}).every(T.isExample));
  assert.ok(T.find('', {source: 'community'}).every((t) => t.source === 'community'));
  assert.deepEqual(T.find('', {category: 'explainer', source: 'community'}).map((t) => t.k), ['demo-recipe-steps']);
  assert.deepEqual(T.find('示例作者 b').map((t) => t.k), ['demo-travel-journal']);
  assert.deepEqual(T.find('vlog', {kind: 'scene'}).map((t) => t.k), ['vlog-edit', 'demo-travel-journal'], '标签也算');
  assert.deepEqual(T.find('', {kind: 'example', category: 'marketing'}), []);
  const all = T.find('');
  const first = T.pageOf(all, 1);
  assert.deepEqual([first.items.length, first.page, first.pages, first.total], [T.PER_PAGE, 1, Math.ceil(all.length / T.PER_PAGE), all.length]);
  assert.equal(T.pageOf(all, 99).page, first.pages);
  assert.equal(T.pageOf(all, 99).items.length, all.length - T.PER_PAGE * (first.pages - 1));
  assert.deepEqual(T.pageOf([], 3), {items: [], page: 1, pages: 1, total: 0});
});

test('画幅与时长的说法：场景模板写默认值，作品示例没写的说自动', () => {
  assert.equal(T.meta(T.get('promo-ad')), '9:16 · 约 30 秒 · 官方');
  assert.equal(T.meta(T.get('ai-news-take')), '画幅与时长自动 · 官方');
  assert.equal(T.spec(T.get('chaos-to-harmony')), '16:9 · 时长自动');
  assert.equal(T.spec(T.get('motion-design-showreel')), '画幅自动 · 约 15 秒');
  assert.match(T.specLine(T.get('promo-ad')), /^默认 9:16 · 约 30 秒/);
  assert.equal(T.specLine(T.get('ai-news-take')), '画幅与时长自动，由 Agent 按内容决定');
  assert.equal(T.specLine(T.get('typography-motion')), '16:9 · 约 30 秒');
  assert.equal(T.byline(T.get('promo-ad')), '官方 · 场景模板 · 营销推广');
  assert.equal(T.byline(T.get('demo-quote-cards')), '社区 · 示例作者 E · 作品示例 · 动效设计');
});

test('选用作品示例：提示词全文进输入框', () => {
  const t = T.get('white-ui-launch');
  assert.equal(T.prompt(t), DATA.find((d) => d.id === 'white-ui-launch').prompt);
  assert.equal(T.prompt(null), '');
});

test('素材与下载：带素材的社区模板用之前要下载，只有提示词的不用', () => {
  assert.equal(T.assetSummary(T.get('demo-recipe-steps')), '图片 6 · SVG 4 · 8 MB');
  assert.equal(T.assetSummary(T.get('promo-ad')), '');
  assert.equal(T.needsDownload(T.get('demo-recipe-steps'), []), true);
  assert.equal(T.needsDownload(T.get('demo-recipe-steps'), ['demo-recipe-steps']), false);
  assert.equal(T.needsDownload(T.get('promo-ad'), []), false);
  assert.equal(T.needsDownload(T.get('demo-quote-cards'), []), false);
  assert.equal(T.needsDownload(null, []), false);
  assert.match(T.stateLabel(T.get('demo-recipe-steps'), []), /先下载到本机（8 MB）/);
  assert.equal(T.stateLabel(T.get('demo-recipe-steps'), ['demo-recipe-steps']), '素材已下载到本机');
  assert.equal(T.stateLabel(T.get('promo-ad'), []), '只有提示词，不用下载');
  let m = T.remember(null, {pick: 'demo-recipe-steps'});
  assert.deepEqual(m, {recent: ['demo-recipe-steps'].concat(T.SHELF_DEFAULT.slice(0, T.SHELF_MAX - 1)), downloaded: []});
  m = T.remember(m, {downloaded: 'demo-recipe-steps'});
  m = T.remember(m, {downloaded: 'demo-recipe-steps'});
  assert.deepEqual(T.downloaded(m), ['demo-recipe-steps']);
  assert.deepEqual(T.downloaded({downloaded: ['nope', 'demo-recipe-steps']}), ['demo-recipe-steps']);
});

test('场景模板：brief 填进输入框，「可以这样说」是 brief 的占位符换成 example；详情列出待填项', () => {
  const t = T.get('demo-recipe-steps');
  assert.equal(t.brief, '教大家做{{菜名}}，适合{{谁来做}}。手头的材料：{{手头的材料}}。');
  assert.equal(t.sample, '教大家做一道十分钟就能上桌的番茄炒蛋，适合刚学做饭的新手。手头的材料：没有。');
  assert.deepEqual(T.slotFields(t).map((f) => [f.label, f.hint]), [['菜名', '做哪道菜'], ['谁来做', '新手还是有经验的人'], ['手头的材料', '附上的照片或视频；没有可以写「没有」']]);
  const ex = T.get('demo-quote-cards');
  assert.equal(ex.sample, '');
  assert.deepEqual(P.labels(T.prompt(ex)), ['几句话', '出处', '语言'], '作品示例的正文直接带占位符');
  assert.deepEqual(T.slotFields(ex).map((f) => f.label), ['几句话', '出处', '语言']);
  assert.equal(T.skillLine({skills: ['baocut', 'web-research']}), '做法：baocut、web-research');
  assert.equal(T.skillLine(t), '');
  assert.deepEqual(T.slotFields(null), []);
});

test('场景模板发送时只标注模板，正文与简报前言由 Runtime 拼', () => {
  const t = T.get('promo-ad');
  const request = N.homePrompt('瑜伽课推广', {title: t.title}, {});
  assert.equal(request, '瑜伽课推广\n模板：推广短片');
  assert.ok(!request.includes(T.prompt(t).slice(0, 10)));
});
