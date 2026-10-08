/* API 提供方目录与账号的单测 —— node --test designs/baocut/app/*.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global.window || {};
const TTS = require('./model-cloud-tts.js');
const IMG = require('./model-cloud-image.js');
const V = require('./model-vendors.js');

const NOW = Date.parse('2026-10-06T10:00:00Z');
const acc = (id, o) => Object.assign({accountId: id, label: null, masked: 'sk-…' + id.padStart(4, '0'), enabled: true, status: {state: 'ok'}}, o);

test('目录 id 固定：共享简报 §3 的 15 家 + Codex，没有 Replicate', () => {
  const ids = V.VENDORS.map((v) => v.id);
  assert.deepEqual(ids, ['openai', 'anthropic', 'google', 'elevenlabs', 'deepseek', 'moonshot', 'qwen', 'zhipu', 'minimax',
    'volcengine', 'xai', 'mistral', 'groq', 'openrouter', 'siliconflow', 'agent:codex']);
  assert.equal(V.byId('replicate'), null);
  ['moonshot', 'qwen', 'zhipu', 'minimax'].forEach((id) => assert.deepEqual(V.byId(id).regions.map((r) => r.k), ['global', 'cn'], id));
  assert.deepEqual(V.VENDORS.filter((v) => v.kind === 'relay').map((v) => v.id), ['openrouter', 'siliconflow']);
  V.VENDORS.forEach((v) => {
    v.p1.forEach((c) => assert.ok(v.caps.indexOf(c) >= 0, `${v.id} 的 P1 能力 ${c} 要在 caps 里`));
    if (v.kind !== 'agent') assert.ok(/^https:\/\//.test(v.base), v.id);
  });
});

test('能力标签与旧 kind / 左栏项互译', () => {
  assert.deepEqual(V.CAPS.map((c) => V.CAP_SHORT[c]), ['文本', '识别', '合成', '生图']);
  assert.equal(V.CAP_LABEL.transcribe, '语音识别');
  V.CAPS.forEach((c) => {
    assert.equal(V.CAP_OF_KIND[V.KIND[c]], c);
    assert.equal(V.CAP_OF_NAV[V.NAV[c]], c);
  });
});

test('合成与生图的模型按 id 从各自的表读，两边不漂', () => {
  TTS.PROVIDERS.forEach((p) => {
    assert.ok(V.byId(p.id), `合成表里的 ${p.id} 要在目录里`);
    assert.deepEqual(V.modelsOf(p.id, 'tts').map((x) => x.id), p.models.map((x) => x.id));
  });
  IMG.PROVIDERS.forEach((p) => {
    assert.ok(V.byId(p.id), `生图表里的 ${p.id} 要在目录里`);
    assert.ok(V.capsOf(V.byId(p.id)).indexOf('image') >= 0, p.id);
    assert.deepEqual(V.modelsOf(p.id, 'image').map((x) => x.id), p.models.map((x) => x.id));
  });
  V.VENDORS.filter((v) => v.kind !== 'agent').forEach((v) => V.capsOf(v).forEach((c) => assert.ok(V.modelsOf(v.id, c).length >= 1, `${v.id} ${c}`)));
});

test('掩码：前 3 + … + 后 4；8 位及以下全 •；空串为空', () => {
  assert.equal(V.mask('sk-proj-abcdefgh1234'), 'sk-…1234');
  assert.equal(V.mask('  sk-abcdefghi  '), 'sk-…fghi');
  assert.equal(V.mask('12345678'), '••••••••');
  assert.equal(V.mask('abc'), '•••');
  assert.equal(V.mask(''), '');
  assert.ok(V.mask('sk-secret-value-9999').indexOf('secret') < 0);
});

test('首选账号：第一个启用且有密钥的；限速的不自动跳过', () => {
  const list = [acc('a', {enabled: false}), acc('b', {status: {state: 'rate-limited', until: '2026-10-06T11:00:00Z'}}), acc('c')];
  assert.equal(V.primaryAccount(list).accountId, 'b');
  assert.equal(V.primaryAccount([acc('x', {masked: ''})]), null);
  assert.equal(V.primaryAccount([]), null);
});

test('调序：arrange / makePrimary / move', () => {
  const list = [acc('a'), acc('b'), acc('c')];
  assert.deepEqual(V.arrange(list, ['c', 'a']).map((a) => a.accountId), ['c', 'a', 'b']);
  assert.deepEqual(V.makePrimary(list, 'c').map((a) => a.accountId), ['c', 'a', 'b']);
  assert.deepEqual(V.move(list, 'a', 1).map((a) => a.accountId), ['b', 'a', 'c']);
  assert.deepEqual(V.move(list, 'a', -1).map((a) => a.accountId), ['a', 'b', 'c']);
  assert.deepEqual(list.map((a) => a.accountId), ['a', 'b', 'c'], '不改原数组');
});

test('新账号：只存掩码，不存密钥；头一个叫 main', () => {
  const a = V.makeAccount({key: 'sk-live-0123456789', label: '  '}, [], NOW);
  assert.equal(a.accountId, 'main');
  assert.equal(a.masked, 'sk-…6789');
  assert.equal(a.label, null);
  assert.ok(JSON.stringify(a).indexOf('0123456789') < 0);
  assert.notEqual(V.makeAccount({key: 'sk-other-999999'}, [a], NOW).accountId, 'main');
  assert.equal(V.accountName(a), 'sk-…6789');
  assert.equal(V.accountName(Object.assign({}, a, {label: '团队'})), '团队');
});

test('状态徽标：正常 / 密钥无效 / 限速 · 几点恢复 / 额度用尽；过了恢复时间算正常', () => {
  const until = new Date(NOW + 30 * 60000);
  const hm = String(until.getHours()).padStart(2, '0') + ':' + String(until.getMinutes()).padStart(2, '0');
  assert.deepEqual(V.statusOf(acc('a'), NOW), {label: '正常', tone: 'positive'});
  assert.equal(V.statusOf(acc('a', {status: {state: 'invalid-key'}}), NOW).label, '密钥无效');
  assert.equal(V.statusOf(acc('a', {status: {state: 'quota-exhausted'}}), NOW).label, '额度用尽');
  assert.equal(V.statusOf(acc('a', {status: {state: 'rate-limited', until: until.toISOString()}}), NOW).label, `限速 · ${hm} 恢复`);
  assert.equal(V.statusOf(acc('a', {status: {state: 'rate-limited', until: new Date(NOW - 1).toISOString()}}), NOW).label, '正常');
  assert.equal(V.statusOf(acc('a', {enabled: false}), NOW).label, '已停用');
});

test('列表：已连接排前；副行是 host · N 个模型 · 能力词；摘要给掩码或账号数', () => {
  const {settings, accounts} = V.seed(NOW);
  const rows = V.list(settings, accounts, NOW);
  assert.deepEqual(rows.map((r) => r.id), ['openai', 'elevenlabs', 'deepseek', 'minimax', 'anthropic', 'google']);
  assert.match(rows[0].sub, /^api\.openai\.com · \d+ 个模型 · 文本 \/ 识别 \/ 合成 \/ 生图$/);
  assert.equal(rows[0].summary, '2 个账号');
  assert.equal(rows.find((r) => r.id === 'deepseek').summary, 'sk-…e810');
  assert.equal(rows.find((r) => r.id === 'anthropic').state.k, 'missing');
  assert.match(rows.find((r) => r.id === 'minimax').sub, /^api\.minimaxi\.com/, '中国站的基址');
  assert.deepEqual(V.connectedIds(settings, accounts).sort(), ['deepseek', 'elevenlabs', 'minimax', 'openai']);
  const off = Object.assign({}, settings, {openai: {enabled: false}});
  assert.equal(V.stateOf('openai', off, accounts, NOW).k, 'off');
  assert.ok(!V.connected('openai', off, accounts));
});

test('添加 API 提供方：搜索与分组；已添加的标出来', () => {
  const {settings} = V.seed(NOW);
  const all = V.catalog('', settings);
  assert.equal(all.vendors.length, 13);
  assert.deepEqual(all.relays.map((r) => r.vendor.id), ['openrouter', 'siliconflow']);
  assert.ok(all.vendors.find((r) => r.vendor.id === 'openai').added);
  assert.deepEqual(V.catalog('kimi', settings).vendors.map((r) => r.vendor.id), ['moonshot']);
  assert.ok(V.catalog('语音识别', settings).vendors.some((r) => r.vendor.id === 'groq'));
});

test('自建端点：custom:<slug>，撞名加序号；基址重复时找到那一家', () => {
  const {settings} = V.seed(NOW);
  assert.equal(V.customId('My LLM Box', settings), 'custom:my-llm-box');
  const s2 = Object.assign({}, settings, {'custom:my-llm-box': {enabled: true, custom: {name: 'My LLM Box', base: 'http://127.0.0.1:8000/v1', caps: ['text']}}});
  assert.equal(V.customId('my llm box', s2), 'custom:my-llm-box-2');
  assert.equal(V.customId('本地', s2), 'custom:endpoint');
  assert.equal(V.findByBase('https://api.openai.com/v1/', settings).id, 'openai');
  assert.equal(V.findByBase('HTTP://127.0.0.1:8000/v1', s2).id, 'custom:my-llm-box');
  assert.equal(V.findByBase('https://example.invalid/v1', s2), null);
  assert.ok(V.validBase('http://localhost:11434/v1'));
  assert.ok(!V.validBase('localhost:11434'));
});

test('能力页的 API 提供方模型与旧目录形状', () => {
  const {settings, accounts} = V.seed(NOW);
  const text = V.choices('text', settings, accounts, NOW);
  assert.deepEqual(text.filter((c) => c.ready).map((c) => c.vendor.id), ['openai', 'deepseek', 'minimax']);
  assert.equal(text.find((c) => c.vendor.id === 'anthropic').why, '未添加账号');
  assert.ok(V.isP1('minimax', 'tts') && V.isP1('groq', 'transcribe') && !V.isP1('openai', 'tts'));
  assert.ok(!V.choices('tts', settings, accounts, NOW).some((c) => c.vendor.id === 'minimax'), 'P1 能力不进能力页');
  assert.ok(V.choices('tts', settings, accounts, NOW).some((c) => c.vendor.id === 'elevenlabs'));
  const s2 = Object.assign({}, settings, {deepseek: {enabled: true, models: {text: ['deepseek-v5-preview']}}});
  assert.ok(V.modelsOf('deepseek', 'text', s2).some((x) => x.id === 'deepseek-v5-preview' && x.added));
  const legacy = V.legacyCatalog(settings);
  const openai = legacy.find((p) => p.id === 'openai');
  assert.ok(openai.models.some((x) => x.kind === 'llm') && openai.models.some((x) => x.kind === 'stt'));
  assert.ok(!legacy.some((p) => p.id === 'agent:codex'));
});

test('能力页第 ④ 节的全目录：已连接 → 已添加没账号 → 未添加，同档按目录顺序', () => {
  const {settings, accounts} = V.seed(NOW);
  const text = V.capCatalog('text', settings, accounts, NOW);
  assert.deepEqual(text.map((r) => r.id), ['openai', 'deepseek', 'minimax', 'anthropic', 'google', 'moonshot', 'qwen', 'zhipu',
    'volcengine', 'xai', 'mistral', 'groq', 'openrouter', 'siliconflow']);
  assert.deepEqual(text.slice(0, 3).map((r) => r.ready), [true, true, true]);
  const anthropic = text.find((r) => r.id === 'anthropic');
  assert.ok(anthropic.added && !anthropic.ready && anthropic.state.k === 'missing');
  const moonshot = text.find((r) => r.id === 'moonshot');
  assert.ok(!moonshot.added && !moonshot.ready && moonshot.models.length > 0);
  assert.equal(text.find((r) => r.id === 'openrouter').kind, 'relay');
  /* 停用的已添加项落在第二档 */
  const off = Object.assign({}, settings, {openai: {enabled: false}});
  const ids = V.capCatalog('text', off, accounts, NOW).map((r) => r.id);
  assert.ok(ids.indexOf('openai') > ids.indexOf('minimax') && ids.indexOf('openai') < ids.indexOf('moonshot'));
});

test('能力页第 ④ 节的全目录：查询名字 / id / 模型 id；P1 与智能体不列，自建列在最后', () => {
  const {settings, accounts} = V.seed(NOW);
  assert.deepEqual(V.capCatalog('text', settings, accounts, NOW, ' Kimi ').map((r) => r.id), ['moonshot']);
  assert.deepEqual(V.capCatalog('text', settings, accounts, NOW, 'gpt-6').map((r) => r.id), ['openai']);
  assert.deepEqual(V.capCatalog('text', settings, accounts, NOW, 'groq').map((r) => r.id), ['groq']);
  assert.deepEqual(V.capCatalog('text', settings, accounts, NOW, '没有这家'), []);
  assert.ok(!V.capCatalog('tts', settings, accounts, NOW).some((r) => r.id === 'minimax'), 'MiniMax 的合成是 P1');
  assert.ok(!V.capCatalog('transcribe', settings, accounts, NOW).some((r) => r.id === 'groq'), 'Groq 的识别是 P1');
  assert.ok(!V.capCatalog('image', settings, accounts, NOW).some((r) => r.id === 'agent:codex' || r.kind === 'agent'), '智能体不列');
  const s2 = Object.assign({}, settings, {'custom:box': {enabled: true, custom: {name: 'Box', base: 'http://127.0.0.1:8000/v1', caps: ['text']}, models: {text: ['box-1']}}});
  const a2 = Object.assign({}, accounts, {'custom:box': [acc('main')]});
  const text = V.capCatalog('text', s2, a2, NOW);
  const box = text.find((r) => r.id === 'custom:box');
  assert.ok(box && box.kind === 'custom' && box.ready && box.models.some((x) => x.id === 'box-1'));
  assert.equal(text.filter((r) => r.ready).slice(-1)[0].id, 'custom:box', '已连接的自建排在已连接一档的最后');
  assert.ok(!V.capCatalog('tts', s2, a2, NOW).some((r) => r.id === 'custom:box'), '没声明合成的自建不进合成页');
  assert.deepEqual(V.capCatalog('text', s2, a2, NOW, 'box-1').map((r) => r.id), ['custom:box']);
});

test('账号的基址：账号 endpoint → 地区基址 → 提供方基址；空串当没有', () => {
  const settings = {moonshot: {enabled: true, region: 'global'}, openai: {enabled: true}};
  assert.equal(V.accountBase('moonshot', {endpoint: 'https://gw.example.com/v1', region: 'cn'}, settings), 'https://gw.example.com/v1');
  assert.equal(V.accountBase('moonshot', {endpoint: '', region: 'cn'}, settings), 'https://api.moonshot.cn/v1');
  assert.equal(V.accountBase('moonshot', {endpoint: '   ', region: 'cn'}, settings), 'https://api.moonshot.cn/v1');
  assert.equal(V.accountBase('moonshot', {}, settings), 'https://api.moonshot.ai/v1');
  assert.equal(V.accountBase('moonshot', {}, {moonshot: {region: 'cn'}}), 'https://api.moonshot.cn/v1');
  assert.equal(V.accountBase('openai', {endpoint: ''}, settings), 'https://api.openai.com/v1');
  assert.equal(V.accountBase('openai', null, settings), 'https://api.openai.com/v1');
  /* 旧的提供方级 endpoint 仍可读：优先于目录预设，让位于账号自己的 */
  const legacy = {openai: {enabled: true, endpoint: 'https://proxy.example.com/v1'}};
  assert.equal(V.accountBase('openai', {}, legacy), 'https://proxy.example.com/v1');
  assert.equal(V.accountBase('openai', {endpoint: 'http://127.0.0.1:9/v1'}, legacy), 'http://127.0.0.1:9/v1');
});

test('新账号带 endpoint：去空白，空的不存；判重仍按提供方基址', () => {
  assert.equal(V.makeAccount({key: 'sk-0123456789', endpoint: ' https://gw.example.com/v1 '}, [], NOW).endpoint, 'https://gw.example.com/v1');
  assert.equal(V.makeAccount({key: 'sk-0123456789', endpoint: '  '}, [], NOW).endpoint, undefined);
  const {settings} = V.seed(NOW);
  assert.equal(V.findByBase('https://gw.example.com/v1', settings), null);
});

test('自建端点卡：openai / 兼容 / 自建 / custom 命中，空查询总在，无关词不中', () => {
  ['', 'openai', 'OpenAI 兼容', '兼容', '自建', '自建端点', 'custom', 'Custom'].forEach((q) => assert.ok(V.customHit(q), q));
  ['kimi', 'deepseek', '语音识别'].forEach((q) => assert.ok(!V.customHit(q), q));
  const {settings} = V.seed(NOW);
  const c = V.catalog('兼容', settings);
  assert.equal(c.vendors.length + c.relays.length, 0);
  assert.equal(c.custom, true);
  assert.equal(V.catalog('kimi', settings).custom, false);
  assert.ok(V.catalog('openai', settings).custom);
});

test('编码 Agent 图标：九家内置的都指向 assets/vendors 里存在的文件；添加的与没有的用首字母', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ids = ['claude', 'codex', 'copilot', 'pi', 'opencode', 'gemini', 'cursor', 'grok', 'kimi'];
  assert.deepEqual(Object.keys(V.AGENT_ICONS).sort(), ids.slice().sort());
  for (const id of ids) {
    const icon = V.agentIcon({id});
    const svg = fs.readFileSync(path.join(__dirname, '../assets/vendors', `${icon.file}.svg`), 'utf8');
    // mono 的文件填 currentColor，彩色的不是。
    assert.equal(/<svg[^>]*fill="currentColor"/.test(svg), icon.mono, id);
  }
  assert.equal(V.agentIcon({id: 'goose', added: 'catalog'}), null);
  assert.equal(V.agentIcon({id: 'claude', added: 'custom'}), null);
  assert.equal(V.agentIcon(null), null);
});
