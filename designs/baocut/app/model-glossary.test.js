const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-glossary.js');
const G = global.window.BC_GLOSSARY;

/* 两种表：转录表（规范写法 / 常听错成），翻译表（原文 → 译文，带方向）。 */
const asrTrading = {id: 'a1', kind: 'asr', name: '交易', lang: null, dflt: true, terms: [
  {id: 'wyc', source: 'Wyckoff', variants: ['维科夫', 'why cough']},
  {id: 'com', source: 'commit', variants: ['康米特']},
]};
const asrZh = {id: 'a2', kind: 'asr', name: '节目', lang: 'zh', terms: [
  {id: 'lin', source: '林澈', variants: ['林彻']},
  {id: 'wyc2', source: 'Wyckoff', variants: ['威科夫斯基']},
]};
const enZh = {id: 't1', kind: 'trans', name: '交易', from: 'en', to: 'zh-Hans', dflt: true, terms: [
  {id: 'twyc', source: 'Wyckoff', target: '威科夫'},
  {id: 'tcom', source: 'commit', target: '突破确认', note: '不是「提交」'},
  {id: 'tacc', source: 'accumulation', target: '吸筹', lock: false},
]};
const enZhDev = {id: 't2', kind: 'trans', name: '开发', from: 'en', to: 'zh', terms: [
  {id: 'dcom', source: 'commit', target: '提交'},
  {id: 'dkv', source: 'KV cache', target: 'KV 缓存'},
]};
const zhEn = {id: 't3', kind: 'trans', name: '节目', from: 'zh', to: 'en', terms: [
  {id: 'zlin', source: '林澈', target: 'Lin Che'},
]};
const PACKS = [asrTrading, asrZh, enZh, enZhDev, zhEn];
const ALL = PACKS.map((p) => p.id);

test('归并键与 core 的 term_merge_key 同口径：大小写、空白、连字符不产生第二条', () => {
  assert.equal(G.normKey('KV cache'), G.normKey('kv-Cache'));
  assert.equal(G.normKey(' KV　Cache '), 'kvcache');
  assert.ok(G.sameTerm('Wyckoff', 'wyckoff'));
  assert.ok(!G.sameTerm('', ''), '空源词不算同一条，否则空行会互相合并');
});

test('条目校验：每种表只有一格必填，翻译表的译文也必填', () => {
  assert.deepEqual(G.validate({source: 'KV cache', variants: []}, 'asr'), [], '转录表只填规范写法就能存');
  assert.ok(G.validate({source: ''}, 'asr').includes('规范写法不能为空'));
  assert.ok(G.validate({source: 'KV cache', variants: ['kv-cache']}, 'asr').some((s) => s.includes('相同')));
  assert.ok(G.validate({source: 'x', variants: ['a', 'A']}, 'asr').some((s) => s.includes('重复')));
  assert.deepEqual(G.validate({source: 'commit', target: '突破确认'}, 'trans'), []);
  assert.ok(G.validate({source: 'commit', target: ' '}, 'trans').includes('译文不能为空'));
});

test('方向：翻译表只在原文语言与目标语言都对得上时参与，转录表按口播语言', () => {
  assert.ok(G.packApplies(enZh, {kind: 'trans', from: 'en', to: 'zh-Hans'}));
  assert.ok(G.packApplies(enZhDev, {kind: 'trans', from: 'en-US', to: 'zh-Hans'}), '原文只比主语种；zh 与 zh-Hans 是目录里的同一条');
  assert.ok(!G.packApplies(enZhDev, {kind: 'trans', from: 'en', to: 'zh-Hant'}), '简体的表不进繁体译文：译文是要逐字照用的');
  assert.ok(!G.packApplies(enZh, {kind: 'trans', from: 'zh', to: 'en'}), '反方向的表不能用');
  assert.ok(!G.packApplies(enZh, {kind: 'trans', from: 'en', to: 'ja'}));
  assert.ok(!G.packApplies(enZh, {kind: 'asr', from: 'en'}), '翻译表不进转录');
  assert.ok(G.packApplies(asrTrading, {kind: 'asr', from: 'ja'}), '不限语言的转录表到处可用');
  assert.ok(!G.packApplies(asrZh, {kind: 'asr', from: 'en'}));
  assert.ok(G.packApplies(asrZh, {kind: 'asr', from: 'auto'}), '自动检测语言时不拦');
  assert.equal(G.pairLabel(enZh), 'English → 简体中文', '名字取自全 App 共用的语言目录');
  assert.equal(G.pairLabel(asrTrading), '任意语言');
  assert.equal(G.pairLabel(asrZh), '简体中文 口播');
  assert.equal(G.LANGS, undefined, '术语库不自带语言表');
});

test('多表合并：方向对不上的表勾着也不参与；启用顺序决定谁赢，只有译文不同才算冲突', () => {
  const a = G.mergePacks(PACKS, ALL, {kind: 'trans', from: 'en', to: 'zh'});
  assert.deepEqual(a.packs.map((p) => p.id), ['t1', 't2']);
  assert.deepEqual(a.terms.map((t) => t.source), ['Wyckoff', 'commit', 'accumulation', 'KV cache']);
  assert.equal(a.terms.find((t) => t.source === 'commit').target, '突破确认');
  assert.equal(a.conflicts.length, 1);
  assert.deepEqual(a.conflicts[0].rows.map((r) => r.target), ['突破确认', '提交']);
  const b = G.mergePacks(PACKS, ['t2', 't1'], {kind: 'trans', from: 'en', to: 'zh'});
  assert.equal(b.terms.find((t) => t.source === 'commit').target, '提交', '换个启用顺序就换个赢家');
  const asr = G.mergePacks(PACKS, ALL, {kind: 'asr', from: 'zh'});
  assert.deepEqual(asr.terms.find((t) => t.source === 'Wyckoff').variants, ['维科夫', 'why cough', '威科夫斯基'],
    '转录表的误识取并集');
  assert.equal(asr.conflicts.length, 0);
});

test('一次粘一批：= → Tab 都认，转录表可以只写规范写法，解析不了的行退回来并说明', () => {
  const t = G.parseLines('commit = 突破确认\nWyckoff → 威科夫\nspring\t弹簧效应\t不要译成泉水\nbare\n\ncommit = 提交', 'trans');
  assert.deepEqual(t.terms.map((x) => [x.source, x.target]),
    [['commit', '突破确认'], ['Wyckoff', '威科夫'], ['spring', '弹簧效应']]);
  assert.equal(t.terms[2].note, '不要译成泉水');
  assert.equal(t.terms[0].lock, true, '翻译条目默认必须照用');
  assert.deepEqual(t.skipped.map((s) => s.why), ['没有译文', '和前面的行是同一个词，已合并']);
  const a = G.parseLines('KV cache = 开维缓存、KV 换成\n推理框架\nkv-cache = KV 缓成', 'asr');
  assert.deepEqual(a.terms.map((x) => x.source), ['KV cache', '推理框架']);
  assert.deepEqual(a.terms[0].variants, ['开维缓存', 'KV 换成', 'KV 缓成'], '同一个词的误识并进去');
  const csv = G.parseLines('attention head, 注意力头', 'trans');
  assert.deepEqual([csv.terms[0].source, csv.terms[0].target], ['attention head', '注意力头']);
});

test('粘进来的 Markdown 表按表头找列，Lock=no 读成可变通', () => {
  const md = ['| Source | Target | Note | Lock | Origin |', '|---|---|---|---|---|',
    '| commit | 突破确认 | 不是提交 | yes | user |', '| accumulation | 吸筹 |  | no | user |'].join('\n');
  const {terms} = G.parseLines(md, 'trans');
  assert.deepEqual(terms.map((t) => [t.source, t.target, t.lock]), [['commit', '突破确认', true], ['accumulation', '吸筹', false]]);
  const canon = ['| Source | Category | Variants | Note | Lock | Origin |', '|---|---|---|---|---|---|',
    '| Wyckoff | person | 维科夫, why cough | 人名 | yes | user |'].join('\n');
  assert.deepEqual(G.parseLines(canon, 'asr').terms[0].variants, ['维科夫', 'why cough']);
});

test('并进一张表：已有的词不重复加，转录表并入新的误识', () => {
  const r = G.addTerms(asrTrading, [{source: 'wyckoff', variants: ['外科夫']}, {source: 'spring', variants: []}]);
  assert.deepEqual([r.added, r.merged], [1, 1]);
  assert.deepEqual(r.pack.terms[0].variants, ['维科夫', 'why cough', '外科夫']);
  const t = G.addTerms(enZh, [{source: 'commit', target: '提交'}]);
  assert.equal(t.pack.terms.find((x) => x.source === 'commit').target, '突破确认', '翻译表保留原译文');
});

test('命中：拉丁词看词边界、CJK 直接子串，规范写法与误识分开计', () => {
  const terms = G.mergePacks(PACKS, ['a1'], {kind: 'asr', from: 'zh'}).terms;
  const h = G.hits('他说维科夫的量价关系，Wyckoff 本人没这么讲。', terms);
  assert.deepEqual(h.map((x) => x.kind), ['variant', 'exact']);
  assert.equal(G.hits('commitment 不是 commit', terms).filter((x) => x.source === 'commit').length, 1,
    'commitment 里的 commit 不算命中');
  assert.equal(G.hits('COMMIT 一下', terms).length, 1, '大小写不敏感');
});

test('翻译只带命中的：程序先过滤，没出现在本篇的条目不交给模型；误识借转录表的', () => {
  const trans = G.mergePacks(PACKS, ALL, {kind: 'trans', from: 'en', to: 'zh'}).terms;
  const asr = G.mergePacks(PACKS, ALL, {kind: 'asr', from: 'en'}).terms;
  const paras = [{id: 'p1', text: 'Commit to the move. 维科夫 said commit twice.'}, {id: 'p2', text: 'No terms here.'}];
  const r = G.hitTerms(paras, trans, asr);
  assert.equal(r.total, 4);
  assert.deepEqual(r.hit.map((t) => [t.source, t.count]), [['commit', 2], ['Wyckoff', 1]],
    '按命中次数降序；Wyckoff 是靠转录表里记下的「维科夫」命中的');
  assert.equal(r.locked, 2);
  assert.equal(G.hitTerms(paras, trans, []).hit.length, 1, '不借误识就只剩 commit');
});

test('校对建议：一段一条、段里所有术语一起改，规范写法不进待办', () => {
  const terms = G.mergePacks(PACKS, ['a1'], {kind: 'asr', from: 'zh'}).terms;
  const paras = [
    {id: 'p1', label: '¶3 · 00:16', text: '维科夫讲吸筹，维科夫又讲康米特。'},
    {id: 'p2', label: '¶4 · 00:40', text: 'Wyckoff 的原文是对的。'},
  ];
  const list = G.review(paras, terms);
  assert.equal(list.length, 1, '第二段已经是规范写法，不该出现在待办里');
  assert.equal(list[0].count, 3, '两条术语共三处，合在同一段里');
  assert.deepEqual(list[0].terms.map((t) => [t.source, t.count]), [['Wyckoff', 2], ['commit', 1]]);
  assert.equal(list[0].after, 'Wyckoff讲吸筹，Wyckoff又讲commit。', '替换是逐字替换，不替用户补中英空格');
  assert.deepEqual(G.reviewSummary(list), {rows: 1, hits: 3, terms: 2});
  assert.deepEqual(G.countByTerm(paras, terms).wyc, {termId: 'wyc', exact: 1, variant: 2});
});

test('同一段被两条术语咬住同一截时，只按更长的那条改一次', () => {
  const packs = [{id: 'p9', kind: 'asr', name: '人物', terms: [
    {id: 'a', source: '林澈', variants: ['林彻']},
    {id: 'b', source: '词级对齐', variants: ['林彻说的词集对齐']},
  ]}];
  const terms = G.mergePacks(packs, ['p9'], {kind: 'asr', from: 'zh'}).terms;
  const row = G.review([{id: 'p1', text: '刚才林彻说的词集对齐是地基。'}], terms)[0];
  assert.equal(row.count, 1);
  assert.equal(row.after, '刚才词级对齐是地基。');
});

test('候选回流：只收反复出现、且库里还没有的（含已登记的误识）', () => {
  const terms = G.mergePacks(PACKS, ['a1'], {kind: 'asr', from: 'zh'}).terms;
  const cands = [{source: 'spring', count: 4}, {source: '康米特', count: 3}, {source: 'Wyckoff', count: 9},
    {source: 'backtest', count: 1}];
  assert.deepEqual(G.newTerms(cands, terms).map((c) => c.source), ['spring']);
  assert.deepEqual(G.newTerms(cands, terms, 1).map((c) => c.source), ['spring', 'backtest']);
});

test('识别提示的能力门按模型定；本地 MOSS 的 id 里有 transcribe 也不算 OpenAI 一族', () => {
  assert.equal(G.asrHint('whisper-large-v3').kind, 'prompt');
  assert.equal(G.asrHint('cloud:openai/gpt-4o-transcribe').kind, 'prompt');
  assert.equal(G.asrHint('qwen3-asr-1.7b').kind, 'context');
  assert.equal(G.asrHint('moss-transcribe').kind, 'none');
  assert.equal(G.asrHint('moss-transcribe-diarize').kind, 'none');
  assert.equal(G.asrHint('moss-transcribe').budget, 0);
});

test('送进语音模型的那一串：自定义提示词在前一个字不截，术语填满剩下的篇幅并报出丢了几条', () => {
  const terms = [{source: 'Wyckoff'}, {source: 'commit'}, {source: 'KV cache'}];
  assert.deepEqual(G.hintCompose('', terms, 100),
    {text: 'Wyckoff、commit、KV cache', custom: 0, used: 3, dropped: 0, chars: 23, over: 0});
  const both = G.hintCompose('  一期讲量价方法的课。 ', terms, 100);
  assert.equal(both.text, '一期讲量价方法的课。\nWyckoff、commit、KV cache');
  assert.equal(both.custom, 10);
  const cut = G.hintCompose('一期讲量价方法的课。', terms, 20);
  assert.deepEqual([cut.used, cut.dropped, cut.over], [1, 2, 0], '提示词占掉的篇幅术语就用不了');
  const over = G.hintCompose('一二三四五六七八九十一二三', terms, 10);
  assert.deepEqual([over.used, over.dropped, over.over], [0, 3, 3], '提示词自己就超了要直说');
});

test('改术语只让命中它的句子过期，不触发全文重译', () => {
  const sentences = [{id: 's1', termIds: ['wyc']}, {id: 's2', termIds: []}, {id: 's3', termIds: ['com', 'wyc']}];
  assert.deepEqual(G.staleSentences(['wyc'], sentences), ['s1', 's3']);
  assert.deepEqual(G.staleSentences(['kv'], sentences), []);
});

test('Markdown 往返：转录表只有 Canonical Terms，翻译表只有 Bilingual Glossary，方向写在 front matter', () => {
  const md = G.toMarkdown(enZh);
  assert.ok(md.includes('kind: translate') && md.includes('from: en') && md.includes('to: zh-Hans'));
  assert.ok(md.includes('# Bilingual Glossary') && !md.includes('# Canonical Terms'));
  const back = G.parseMarkdown(md);
  assert.deepEqual(back.warnings, []);
  assert.equal(back.packs.length, 1);
  assert.deepEqual([back.packs[0].kind, back.packs[0].from, back.packs[0].to, back.packs[0].dflt], ['trans', 'en', 'zh-Hans', true]);
  assert.deepEqual(back.packs[0].terms.map((t) => [t.source, t.target, t.lock]),
    [['Wyckoff', '威科夫', true], ['commit', '突破确认', true], ['accumulation', '吸筹', false]]);
  const amd = G.toMarkdown(asrZh);
  assert.ok(amd.includes('kind: transcribe') && amd.includes('lang: zh') && !amd.includes('# Bilingual'));
  assert.deepEqual(G.parseMarkdown(amd).packs[0].terms[0].variants, ['林彻']);
});

test('第一版的混合表无损拆成两张：误识进转录表，译名进翻译表', () => {
  const legacy = ['---', 'name: 交易 · 量价方法', 'targets: [zh-Hans]', '---', '',
    '# Canonical Terms', '| Source | Category | Variants | Note | Lock | Origin |', '|---|---|---|---|---|---|',
    '| Wyckoff | person | 维科夫 · 威克夫 | 人名 | yes | user |', '',
    '# Bilingual Glossary', '| Source | Target | Note | Lock | Origin |', '|---|---|---|---|---|',
    '| Wyckoff | 威科夫 |  | yes | user |'].join('\n');
  const {packs} = G.parseMarkdown(legacy);
  assert.deepEqual(packs.map((p) => [p.kind, p.name]), [['asr', '交易 · 量价方法'], ['trans', '交易 · 量价方法']]);
  assert.equal(packs[1].to, 'zh-Hans');
  assert.equal(packs[1].from, null, '旧表没记原文语言，按任意语言用');
  assert.equal(packs[1].terms[0].target, '威科夫');
});

test('没有表头的几行文本也能导入，种类看调用方', () => {
  assert.equal(G.parseMarkdown('commit = 突破确认', 'trans').packs[0].kind, 'trans');
  assert.equal(G.parseMarkdown('KV cache', 'asr').packs[0].terms[0].source, 'KV cache');
  assert.deepEqual(G.parseMarkdown('').packs, []);
});

test('翻译表掉头：原文译文互换、方向互换，掉头后撞车的只留第一条', () => {
  const r = G.reversePack({...enZh, terms: [...enZh.terms, {id: 'x', source: 'Wyckoff method', target: '威科夫'}]});
  assert.deepEqual([r.from, r.to, r.dflt], ['zh-Hans', 'en', false]);
  assert.deepEqual(r.terms.map((t) => [t.source, t.target]),
    [['威科夫', 'Wyckoff'], ['突破确认', 'commit'], ['吸筹', 'accumulation']]);
});

test('项目启用集合：定过就听用户的（空数组也算），没定过取新项目默认用的那几张', () => {
  assert.deepEqual(G.enabledFor({}, 'p', PACKS), ['a1', 't1']);
  assert.deepEqual(G.enabledFor({p: []}, 'p', PACKS), [], '全关掉也是一种选择，不回落到默认');
  assert.deepEqual(G.enabledFor({p: ['t3', 'gone']}, 'p', PACKS), ['t3'], '删掉的表自动掉出去');
  assert.equal(G.enabledLine(PACKS, ALL, {kind: 'trans', from: 'en', to: 'zh'}), '2 张表 · 4 条');
  assert.equal(G.enabledLine(PACKS, ALL, {kind: 'trans', from: 'en', to: 'ja'}), '');
});
