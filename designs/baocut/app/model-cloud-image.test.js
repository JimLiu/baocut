/* 图像生成纯模型的单测 —— node --test designs/baocut/app/*.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('./model-cloud-image.js');

const codexOk = {found: true, ver: '0.136.0', loggedIn: true, runError: null};
const list = (o) => I.engines(Object.assign({saved: ['openai', 'google'], codex: {h: codexOk, on: true}, installed: (id) => id === I.LOCAL_ID}, o));

test('三族 id：cloud / agent / local 互斥，parse 只认 cloud:<p>/<m>', () => {
  assert.equal(I.family('cloud:openai/gpt-image-2.5-flare'), 'cloud');
  assert.equal(I.family(I.CODEX_ID), 'agent');
  assert.equal(I.family('qwen-image-2.1'), 'local');
  assert.deepEqual(I.parse('cloud:openrouter/google/gemini-3-pro-image'), {provider: 'openrouter', model: 'google/gemini-3-pro-image'});
  assert.equal(I.parse('cloud:openai'), null);
  assert.equal(I.parse('qwen-image-2.1'), null);
  assert.equal(I.providerOf('cloud:zhipu/glm-image'), 'zhipu');
});

test('种子表：每家至少一只模型、每只都有能力表与价格两档', () => {
  assert.ok(I.PROVIDERS.length >= 8);
  I.PROVIDERS.forEach((p) => {
    assert.ok(p.models.length >= 1, p.id);
    p.models.forEach((m) => {
      assert.ok(m.caps && m.caps.aspects.length && m.caps.maxN >= 1, `${p.id}/${m.id}`);
      assert.ok(m.price && typeof m.price.normal === 'number', `${p.id}/${m.id} 价格`);
      if (m.caps.quality.indexOf('2k') < 0) assert.equal(m.price.k2, null, `${p.id}/${m.id} 没有 2K 就不该有 2K 价`);
    });
  });
  const ids = I.PROVIDERS.map((p) => p.id);
  ['openai', 'google', 'qwen', 'volcengine', 'minimax', 'zhipu', 'openrouter'].forEach((id) => assert.ok(ids.indexOf(id) >= 0, id));
  assert.ok(ids.indexOf('replicate') < 0, 'replicate 本轮不接（product-design §7.6）');
});

test('能力表照设计稿 §4：OpenAI 自由尺寸 + 透明底；智谱一次一张；MiniMax 一张参考图；Codex 固定尺寸', () => {
  const oa = I.capabilities('cloud:openai/gpt-image-2.5-flare');
  assert.equal(oa.sizes.multiple, 16); assert.equal(oa.sizes.maxEdge, 3840); assert.equal(oa.transparent, true); assert.equal(oa.refs, 16);
  assert.equal(I.capabilities('cloud:zhipu/glm-image').maxN, 1);
  assert.equal(I.capabilities('cloud:minimax/image-01').refs, 1);
  assert.equal(I.capabilities('cloud:minimax/image-01').maxN, 9);
  assert.deepEqual(I.capabilities('cloud:google/gemini-3.1-flash-lite-image').quality, ['normal']);
  const cx = I.capabilities(I.CODEX_ID);
  assert.equal(cx.sizes, 'fixed'); assert.equal(cx.maxN, 1); assert.ok(cx.aspects.indexOf('3:4') < 0, 'Codex 没有 3:4');
  const lc = I.capabilities(I.LOCAL_ID);
  assert.equal(lc.sizes.multiple, 32); assert.equal(lc.refs, 0); assert.equal(lc.negative, false); assert.equal(lc.seed, true);
  assert.equal(I.capabilities('cloud:nobody/none').maxN, 4, '不认识的模型给保守默认');
});

test('画幅 → 尺寸（§4.5）：倍数规则按长边取整、枚举按档取、Codex 不给尺寸、显式尺寸优先', () => {
  const oa = I.capabilities('cloud:openai/gpt-image-2.5-flare');
  assert.deepEqual(I.resolveSize(oa, '16:9', 'normal'), [1024, 576]);
  assert.deepEqual(I.resolveSize(oa, '9:16', '2k'), [1152, 2048]);
  assert.deepEqual(I.resolveSize(oa, '1:1', 'normal', [800, 800]), [800, 800]);
  const gm = I.capabilities('cloud:google/gemini-3-pro-image');
  assert.deepEqual(I.resolveSize(gm, '16:9', 'normal'), [1344, 768]);
  assert.deepEqual(I.resolveSize(gm, '16:9', '2k'), [2688, 1536]);
  assert.deepEqual(I.resolveSize(I.capabilities('cloud:google/gemini-3.1-flash-lite-image'), '16:9', '2k'), [1344, 768], '没有 2K 就落 1K');
  assert.equal(I.resolveSize(I.capabilities(I.CODEX_ID), '16:9', 'normal'), null);
  const lc = I.capabilities(I.LOCAL_ID);
  const s = I.resolveSize(lc, '16:9', 'normal');
  assert.equal(s[0] % 32, 0); assert.equal(s[1] % 32, 0);
});

test('checkSize：倍数 / 最长边 / 长宽比三条都给最近合法值', () => {
  const oa = I.capabilities('cloud:openai/gpt-image-2.5-flare');
  assert.equal(I.checkSize(oa, [1024, 576]), null);
  assert.match(I.checkSize(oa, [1000, 500]), /16 的倍数/);
  assert.match(I.checkSize(oa, [4096, 1024]), /最长边 3840/);
  assert.match(I.checkSize(oa, [3840, 1024]), /长宽比/);
  assert.match(I.checkSize(I.capabilities('cloud:google/gemini-3-pro-image'), [1000, 1000]), /固定几档/);
});

test('fitAspect：项目画幅折成最近一档；Codex 没有 3:4 时 4:5 落到 1:1', () => {
  assert.equal(I.fitAspect('16:9'), '16:9');
  assert.equal(I.fitAspect('9:16'), '9:16');
  assert.equal(I.fitAspect('4:5'), '3:4');
  assert.equal(I.fitAspect('4:5', I.capabilities(I.CODEX_ID).aspects), '1:1');
  assert.equal(I.fitAspect('21:9'), '2.35:1');
});

test('Codex 就绪门：未装 / 版本过旧 / 未登录 / 开关关着各给一句；就绪只有一种', () => {
  assert.equal(I.codexReady(null, true).problem, 'missing');
  assert.equal(I.codexReady({found: true, ver: '0.120.0', loggedIn: true}, true).problem, 'outdated');
  assert.equal(I.codexReady({found: true, ver: '0.136.0', loggedIn: false}, true).problem, 'login');
  assert.equal(I.codexReady(codexOk, false).problem, 'off');
  assert.equal(I.codexReady(codexOk, true).ready, true);
  assert.equal(I.codexCanEnable({found: true, ver: '0.129.9', loggedIn: true}), false);
  assert.equal(I.codexCanEnable(codexOk), true);
});

test('engines：三族一张表；已连的云端在前；Codex 不被隐式选中；本地按平台', () => {
  const l = list();
  assert.ok(l.some((e) => e.id === I.CODEX_ID && e.ready));
  assert.ok(l.some((e) => e.id === I.LOCAL_ID && e.ready));
  assert.ok(l.find((e) => e.provider === 'openai').ready);
  assert.equal(l.find((e) => e.provider === 'zhipu').ready, false);
  assert.equal(I.preferred(l, I.CODEX_ID), I.CODEX_ID, '用户显式把默认设成 Codex 且就绪 → 用 Codex');
  assert.notEqual(I.preferred(l, null), I.CODEX_ID, '没有默认时回落不落到 Codex');
  assert.equal(I.preferred(l, 'cloud:google/gemini-3-pro-image'), 'cloud:google/gemini-3-pro-image');
  assert.equal(I.preferred(l, 'cloud:zhipu/glm-image'), 'cloud:openai/gpt-image-2.5-flare', '默认那家没连就落第一只就绪的');
  const none = I.engines({saved: [], codex: {h: null, on: false}, installed: () => false});
  assert.equal(I.anyReady(none), false);
  assert.equal(I.preferred(none, null), null);
  const local = I.engines({saved: [], codex: {h: null, on: false}, installed: () => true, platform: 'macos-arm64'});
  assert.equal(I.preferred(local, I.LOCAL_ID), I.LOCAL_ID, '已安装的本地默认值用于新表单');
  assert.equal(I.preferred(local, null), null, '没有偏好时不擅自选择本地模型');
  assert.equal(I.preferred(local, I.CODEX_ID), null, '默认是 Codex 但没装：回落到第一只就绪的云端，没有云端就是 null');
  const win = I.engines({saved: [], codex: {h: null, on: false}, installed: () => true, platform: 'windows-x64'});
  assert.equal(win.find((e) => e.id === I.LOCAL_ID).ready, true);
  for (const platform of ['windows-x64', 'linux-x64', 'macos-arm64']) {
    const missing = I.engines({installed: () => false, platform}).find((e) => e.id === I.LOCAL_ID);
    assert.equal(missing.ready, false);
    assert.equal(missing.why, '未下载');
  }
  for (const platform of ['windows-arm64', 'macos-x64', 'other']) {
    const unsupported = I.engines({installed: () => true, platform}).find((e) => e.id === I.LOCAL_ID);
    assert.equal(unsupported.ready, false);
    assert.equal(unsupported.why, '此平台或构建暂不可用');
  }
});

test('默认生图模型是 Codex（2026-09-27 裁决）：显式默认照用，隐式回落永不落到 Codex', () => {
  const first = 'cloud:openai/gpt-image-2.5-flare';
  // 显式：默认 = Codex 且就绪 → Codex
  assert.equal(I.preferred(list(), I.CODEX_ID), I.CODEX_ID);
  // 默认 = Codex 但没就绪（开关关着 / 没装 / 没登录 / 太旧）→ 第一只就绪的云端，不清存着的默认（preferred 只读）
  assert.equal(I.preferred(list({codex: {h: codexOk, on: false}}), I.CODEX_ID), first);
  assert.equal(I.preferred(list({codex: {h: null, on: true}}), I.CODEX_ID), first);
  assert.equal(I.preferred(list({codex: {h: Object.assign({}, codexOk, {loggedIn: false}), on: true}}), I.CODEX_ID), first);
  assert.equal(I.preferred(list({codex: {h: Object.assign({}, codexOk, {ver: '0.120.0'}), on: true}}), I.CODEX_ID), first);
  // 没有默认（每次选择）→ 就算 Codex 是唯一就绪的也不选它
  assert.equal(I.preferred(list(), null), first);
  const onlyCodex = I.engines({saved: [], codex: {h: codexOk, on: true}, installed: () => false});
  assert.equal(I.anyReady(onlyCodex), true);
  assert.equal(I.preferred(onlyCodex, null), null);
  assert.equal(I.preferred(onlyCodex, ''), null);
  assert.equal(I.preferred(onlyCodex, I.CODEX_ID), I.CODEX_ID);
});

test('自建 API 提供方：保守默认，勾了才开参考图 / 种子', () => {
  I.customProvider({id: 'custom-9', name: '自家', url: 'https://img.example.com/v1', models: ['sdxl']});
  const c = I.capabilities('cloud:custom-9/sdxl');
  assert.equal(c.refs, 0); assert.equal(c.seed, false); assert.deepEqual(c.quality, ['normal']);
  I.customProvider({id: 'custom-10', name: '自家 2', url: 'https://img.example.com/v1', models: ['sdxl'], edits: true, seed: true});
  assert.equal(I.capabilities('cloud:custom-10/sdxl').refs, 4);
  assert.ok(list().some((e) => e.provider === 'custom-9' && !e.ready));
});

test('switchModel：不认的画幅 / 张数 / 旋钮跟着模型收', () => {
  const f = Object.assign(I.blank('cloud:openai/gpt-image-2.5-flare'), {aspect: '3:4', n: 4, transparent: true, refs: ['a', 'b'], negative: 'x', seed: '7'});
  const g = I.switchModel(f, I.CODEX_ID);
  assert.equal(g.aspect, '1:1'); assert.equal(g.n, 1); assert.equal(g.transparent, false); assert.deepEqual(g.refs, ['a', 'b']); assert.equal(g.negative, ''); assert.equal(g.seed, '');
  const h = I.switchModel(f, I.LOCAL_ID);
  // 参考图留在草稿里（换回认参考图的模型还在），送出去时才按能力裁
  assert.deepEqual(h.refs, ['a', 'b']); assert.equal(h.seed, '7'); assert.equal(h.n, 1);
  assert.deepEqual(I.usedRefs(h, I.capabilities(I.LOCAL_ID)), []);
  assert.deepEqual(I.usedRefs(g, I.capabilities(I.CODEX_ID)), ['a', 'b']);
  assert.deepEqual(I.usedRefs({refs: ['a', 'b']}, I.capabilities('cloud:minimax/image-01')), ['a']);
});

test('参考图：文件登记、解析与提示句', () => {
  const ids = I.addFileRefs([{name: 'logo.png', url: 'blob:x', size: 1200}, {name: 'shot.jpg'}]);
  assert.equal(ids.length, 2); assert.match(ids[0], /^file:\d+$/);
  assert.equal(I.refInfo(ids[0]).name, 'logo.png'); assert.equal(I.refInfo(ids[0]).alpha, true); assert.equal(I.refInfo(ids[1]).alpha, false);
  assert.equal(I.refInfo('m1', [{id: 'm1', name: '徽标'}]).name, '徽标');
  assert.equal(I.refInfo('gone').missing, true);
  const local = I.capabilities(I.LOCAL_ID);
  assert.match(I.refsNote({refs: []}, local, 'Qwen-Image-2.1'), /不认参考图$/);
  assert.match(I.refsNote({refs: ids}, local, 'Qwen-Image-2.1'), /已选的 2 张这次不会用/);
  const mm = I.capabilities('cloud:minimax/image-01');
  assert.match(I.refsNote({refs: ids}, mm, 'MiniMax'), /最多 1 张 · 作为参考 · 参考图会上传给服务商 · 超出的 1 张不送/);
  assert.match(I.refsNote({refs: []}, I.capabilities('cloud:openai/gpt-image-2'), 'OpenAI'), /会按参考图编辑/);
  const cols = I.artColors(I.DEMO_ART[1]);
  assert.equal(cols.length, 2); assert.ok(cols.every((c) => /^#[0-9A-Fa-f]{6}$/.test(c)));
  assert.deepEqual(I.artColors(''), I.artColors(I.DEMO_ART[0]));
});

test('参数门：一次报完；空提示词是第一条', () => {
  const cap = I.capabilities('cloud:zhipu/glm-image');
  const errs = I.validate({prompt: '', aspect: '16:9', n: 3, refs: ['a'], negative: 'no', seed: 'x', transparent: true}, cap);
  assert.equal(errs[0], I.EMPTY_PROMPT);
  assert.ok(errs.some((e) => /最多 1 张/.test(e)));
  // 不认参考图不算错：这次不送而已（refsNote 负责提示）
  assert.ok(!errs.some((e) => /参考图/.test(e)));
  assert.ok(I.validate({prompt: 'x', aspect: '1:1', n: 1, refs: ['a', 'b']}, I.capabilities('cloud:minimax/image-01')).some((e) => /参考图最多 1 张/.test(e)));
  assert.ok(errs.some((e) => /负向/.test(e)));
  assert.ok(errs.some((e) => /种子/.test(e)));
  assert.ok(errs.some((e) => /透明底/.test(e)));
  assert.deepEqual(I.validate({prompt: '一只纸鹤', aspect: '1:1', n: 1, refs: []}, cap), []);
  assert.match(I.validate({prompt: 'x'.repeat(1001), aspect: '1:1', n: 1}, cap)[0], /最多 1000 字/);
});

test('费用 / 状态一句：云端算钱、本机估时、Codex 说慢', () => {
  const l = list();
  const f = Object.assign(I.blank('cloud:openai/gpt-image-2.5-flare'), {n: 2, quality: '2k'});
  assert.deepEqual(I.costOf(f, l), {per: 0.17, total: 0.34, n: 2});
  assert.match(I.statusLine(f, l), /联网 · OpenAI · 2 张约 \$0\.34/);
  assert.match(I.statusLine(I.blank(I.LOCAL_ID), list({platform: 'macos-arm64'}), [1024, 1024]), /本机 · 约 15 分钟 · 不联网/);
  assert.equal(I.statusLine(I.blank(I.LOCAL_ID), list({platform: 'windows-x64'})), '本机 · 不联网 · 耗时取决于设备');
  assert.equal(I.makeRecord(I.blank(I.LOCAL_ID), 1, list({platform: 'windows-x64'})).eta, null);
  assert.match(I.statusLine(I.blank(I.CODEX_ID), l), /Codex/);
  assert.equal(I.headerChip(I.blank(I.LOCAL_ID), l).icon, 'lock');
  assert.equal(I.localEta(I.LOCAL_ID, 512, 512, 20), 208);
});

test('记录与侧车：n 张各自的种子可复现；Codex 只出一张、无尺寸；许可三值', () => {
  const l = list();
  const rnd = () => 0.5;
  const r = I.makeRecord(Object.assign(I.blank('cloud:openai/gpt-image-2.5-flare'), {prompt: '纸鹤', n: 3, seed: '100'}), 7, l, rnd);
  assert.equal(r.images.length, 3);
  assert.deepEqual(r.images.map((i) => i.seed), [100, 101, 102]);
  assert.match(r.images[0].name, /^图片-007-gpt-image-2\.5-flare-100\.png$/);
  assert.equal(I.makeRecord(Object.assign(I.blank('cloud:openai/gpt-image-2.5-flare'), {prompt: 'x'}), 8, l, rnd).images[0].seed, 500000000);
  const c = I.makeRecord(Object.assign(I.blank(I.CODEX_ID), {prompt: '纸鹤', n: 4}), 9, l, rnd);
  assert.equal(c.images.length, 1); assert.equal(c.size, null);
  assert.match(I.recordMeta(c), /尺寸由 Codex 定/);
  const p = I.provenance(r, r.images[0]);
  assert.equal(p.kind, 'image-gen'); assert.equal(p.license, 'provider-terms'); assert.equal(p.seed, 100); assert.equal(p.provider, 'openai');
  assert.equal(I.provenance(I.makeRecord(I.blank(I.LOCAL_ID), 10, l, rnd), {seed: 1}).license, 'local');
  I.customProvider({id: 'custom-11', name: '自家', url: 'https://x/v1', models: ['m']});
  const cust = I.makeRecord(Object.assign(I.blank('cloud:custom-11/m'), {prompt: 'x'}), 11, I.engines({saved: ['custom-11']}), rnd);
  assert.equal(I.provenance(cust, cust.images[0]).license, 'unknown');
  const src = I.toSource(r, r.images[1], 3);
  assert.equal(src.origin, 'ai'); assert.equal(src.gen.seed, 101); assert.equal(src.grad, r.images[1].art);
});

test('阶段文案与工具卡状态行', () => {
  const l = list();
  const local = I.makeRecord(I.blank(I.LOCAL_ID), 1, l, () => 0);
  assert.equal(I.phase(local, 5), '加载模型');
  assert.match(I.phase(local, 50), /^第 \d+\/20 步$/);
  assert.equal(I.phase(local, 95), '解码');
  const cloud = I.makeRecord(Object.assign(I.blank('cloud:openai/gpt-image-2.5-flare'), {n: 4}), 2, l, () => 0);
  assert.equal(I.phase(cloud, 5), '连接 OpenAI');
  assert.match(I.phase(cloud, 50), /生成中 \d\/4/);
  assert.equal(I.toolStatus(l).on, true);
  assert.match(I.toolStatus(l).text, /2 家云端已连接 · 本机已装 1 只 · Codex 画图已开/);
  assert.equal(I.toolStatus(I.engines({saved: [], codex: {h: null}, installed: () => false})).on, false);
});

test('交给 Agent 的提示带模型、画幅、张数与提示词', () => {
  const l = list();
  const p = I.agentPrompt(Object.assign(I.blank('cloud:google/gemini-3-pro-image'), {prompt: '纸鹤', n: 2, refs: ['a']}), l);
  assert.match(p, /Google Gemini gemini-3-pro-image（云端）/);
  assert.match(p, /2 张/); assert.match(p, /参考图 1 张/); assert.match(p, /纸鹤/);
});
