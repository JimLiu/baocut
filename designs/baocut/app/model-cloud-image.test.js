/* 图像生成纯模型的单测 —— node --test designs/baocut/app/*.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('./model-cloud-image.js');

const codexOk = {found: true, ver: '0.136.0', loggedIn: true, auth: 'chatgpt', runError: null};
const codexApiKey = Object.assign({}, codexOk, {auth: 'api-key'});
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
  assert.equal(lc.sizes.multiple, 32); assert.equal(lc.refs, 10); assert.equal(lc.edit, true); assert.equal(lc.negative, false); assert.equal(lc.seed, true);
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
  assert.deepEqual(I.resolveSize(lc, '16:9', '2k'), [2752, 1536], '本地 2K 按原生预设表，不按长边 2048 算');
  assert.deepEqual(I.resolveSize(lc, '1:1', '2k'), [2048, 2048]);
  for (const a of lc.aspects) {
    const k2 = I.resolveSize(lc, a, '2k');
    assert.equal(I.checkSize(lc, k2), null, `本地 2K ${a} ${k2.join('x')} 要合本地的尺寸规则`);
  }
});

test('尺寸档位跟模型走（2026-10-13）：本地与 Gemini 3 有 1K / 2K，Flash Lite 只有 1K，Codex 不给', () => {
  const tiers = (id, a) => I.sizeTiers(I.capabilities(id), a).map((t) => `${t.label} ${t.size.join('x')}`);
  assert.deepEqual(tiers(I.LOCAL_TURBO_ID, '16:9'), ['1K 1024x576', '2K 2752x1536']);
  assert.deepEqual(tiers('cloud:google/gemini-3-pro-image', '1:1'), ['1K 1024x1024', '2K 2048x2048']);
  assert.deepEqual(tiers('cloud:google/gemini-3.1-flash-lite-image', '1:1'), ['1K 1024x1024']);
  assert.deepEqual(I.sizeTiers(I.capabilities(I.CODEX_ID), '1:1'), []);
  const f = I.switchModel(Object.assign(I.blank(I.LOCAL_TURBO_ID), {quality: '2k'}), 'cloud:google/gemini-3.1-flash-lite-image');
  assert.equal(f.quality, 'normal', '换到没有 2K 的模型落回 1K');
  assert.equal(I.switchModel(Object.assign(I.blank(I.LOCAL_TURBO_ID), {quality: '2k'}), I.LOCAL_ID).quality, '2k', '两只本地模型之间 2K 保留');
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
  assert.equal(I.codexReady(codexOk, true).caution, null);
  // API key 登录（2026-10-12）：能选，但带提醒；开关照样能开
  assert.deepEqual(I.codexReady(codexApiKey, true), {ready: true, why: null, problem: null, caution: I.CODEX_API_KEY_CAUTION});
  assert.equal(I.codexCanEnable(codexApiKey), true);
  assert.equal(I.codexCanEnable({found: true, ver: '0.129.9', loggedIn: true}), false);
  assert.equal(I.codexCanEnable(codexOk), true);
});

test('engines：三族一张表，顺序即自动顺序：能画的 Codex › 本地（Turbo 在前）› 已连的云端 › 没连的云端 › 画不了的 Codex', () => {
  const l = list();
  const fam = (xs) => xs.map((e) => (e.family === 'cloud' ? `cloud:${e.ready ? 'on' : 'off'}` : e.family === 'local' ? e.id : e.family));
  assert.deepEqual(fam(l).slice(0, 5), ['agent', I.LOCAL_TURBO_ID, I.LOCAL_ID, 'cloud:on', 'cloud:on']);
  assert.deepEqual(l.filter((e) => e.family === 'cloud' && e.ready).map((e) => e.provider), ['openai', 'google']);
  assert.equal(fam(list({codex: {h: codexOk, on: false}})).at(-1), 'agent', 'Codex 画不了时排最后');
  assert.ok(l.some((e) => e.id === I.LOCAL_ID && e.ready));
  assert.ok(l.find((e) => e.provider === 'openai').ready);
  assert.equal(l.find((e) => e.provider === 'zhipu').ready, false);
  assert.equal(I.preferred(l, 'cloud:google/gemini-3-pro-image'), 'cloud:google/gemini-3-pro-image');
  assert.equal(I.preferred(l, 'cloud:zhipu/glm-image'), I.CODEX_ID, '默认那家没连就按自动顺序取');
  const none = I.engines({saved: [], codex: {h: null, on: false}, installed: () => false});
  assert.equal(I.anyReady(none), false);
  assert.equal(I.preferred(none, null), null);
  const local = I.engines({saved: [], codex: {h: null, on: false}, installed: () => true, platform: 'macos-arm64'});
  assert.equal(I.preferred(local, I.LOCAL_ID), I.LOCAL_ID, '已安装的本地默认值用于新表单');
  assert.equal(I.preferred(local, null), I.LOCAL_TURBO_ID, '没有默认时自动取本地，Turbo 在前');
  assert.equal(I.preferred(local, I.CODEX_ID), I.LOCAL_TURBO_ID, '默认是 Codex 但没装：按自动顺序回落');
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

test('自动选择（2026-10-12 裁决，取代 2026-09-27）：Codex › 本地 › OpenAI › Gemini › 其他；API key 登录的 Codex 不自动选', () => {
  // 没有默认 → Codex（以 ChatGPT 订阅登录、开关开着）
  assert.equal(I.preferred(list(), null), I.CODEX_ID);
  // Codex 画不了（开关关着 / 没装 / 没登录 / 太旧）→ 本地 Turbo（装了的话）→ 第一只已连的云端
  assert.equal(I.preferred(list({codex: {h: codexOk, on: false}}), null), I.LOCAL_ID, '只装了基础版时用基础版');
  assert.equal(I.preferred(list({codex: {h: null, on: true}, installed: () => true, platform: 'macos-arm64'}), null), I.LOCAL_TURBO_ID);
  assert.equal(I.preferred(list({codex: {h: Object.assign({}, codexOk, {loggedIn: false}), on: true}, installed: () => false}), null), 'cloud:openai/gpt-image-2.5-flare');
  assert.equal(I.preferred(list({codex: {h: codexOk, on: false}, installed: () => false, saved: ['google', 'minimax']}), null), 'cloud:google/gemini-3-pro-image');
  // API key 登录：自动跳过，设成默认或手动选照用
  const paid = list({codex: {h: codexApiKey, on: true}});
  assert.equal(I.engineOf(paid, I.CODEX_ID).caution, I.CODEX_API_KEY_CAUTION);
  assert.equal(I.preferred(paid, null), I.LOCAL_ID);
  assert.equal(I.preferred(paid, I.CODEX_ID), I.CODEX_ID);
  // 默认是 Codex 但没就绪 → 按自动顺序回落，不清存着的默认（preferred 只读）
  assert.equal(I.preferred(list({codex: {h: codexOk, on: false}}), I.CODEX_ID), I.LOCAL_ID);
  const onlyCodex = I.engines({saved: [], codex: {h: codexOk, on: true}, installed: () => false});
  assert.equal(I.preferred(onlyCodex, null), I.CODEX_ID);
  const onlyPaid = I.engines({saved: [], codex: {h: codexApiKey, on: true}, installed: () => false});
  assert.equal(I.preferred(onlyPaid, null), null, '只剩 API key 登录的 Codex：自动不选，等用户自己选');
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
  assert.deepEqual(I.usedRefs(h, I.capabilities(I.LOCAL_ID)), ['a', 'b'], '本地 Qwen 认参考图（2026-10-13）');
  assert.deepEqual(I.usedRefs(h, I.capabilities('cloud:zhipu/glm-image')), []);
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
  assert.match(I.refsNote({refs: []}, local, 'Qwen-Image-2.1'), /^最多 10 张 · 第一张是要改的图$/);
  assert.match(I.refsNote({refs: ids}, local, 'Qwen-Image-2.1'), /只在这台电脑上读，不上传/);
  assert.match(I.refsNote({refs: ids}, I.capabilities(I.CODEX_ID), 'Codex'), /作为参考 · 参考图会上传给服务商/);
  assert.match(I.refsNote({refs: ids}, I.capabilities('cloud:zhipu/glm-image'), 'GLM'), /不认参考图，已选的 2 张这次不会用/);
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

test('本地生图两只：Turbo 与基础版同平台、固定 8 步，步数跟着模型走（2026-10-12）', () => {
  const ids = I.LOCAL_MODELS.map((m) => m.id);
  assert.deepEqual(ids, [I.LOCAL_TURBO_ID, I.LOCAL_ID], 'Turbo 排在基础版前面');
  const mac = I.engines({installed: () => true, platform: 'macos-arm64'}).filter((e) => e.family === 'local');
  assert.deepEqual(mac.map((e) => [e.id, e.ready]), [[I.LOCAL_TURBO_ID, true], [I.LOCAL_ID, true]], '菜单里两只都列，Turbo 在前');
  for (const platform of ['windows-x64', 'linux-x64']) {
    assert.equal(I.engines({installed: () => true, platform}).find((e) => e.id === I.LOCAL_TURBO_ID).ready, true, platform);
  }
  assert.equal(I.engines({installed: () => true, platform: 'macos-x64'}).find((e) => e.id === I.LOCAL_TURBO_ID).why, '此平台或构建暂不可用');
  assert.deepEqual(I.stepsOf(I.LOCAL_ID), {min: 8, max: 40, step: 4, default: 20});
  assert.deepEqual(I.stepsOf(I.LOCAL_TURBO_ID), {min: 8, max: 8, step: 8, default: 8});
  assert.equal(I.stepsOf('cloud:openai/gpt-image-2'), null);
  assert.equal(I.fixedSteps(I.LOCAL_TURBO_ID), 8);
  assert.equal(I.fixedSteps(I.LOCAL_ID), null);
  assert.equal(I.blank(I.LOCAL_TURBO_ID).steps, 8, '默认模型是 Turbo 时新表单就是 8 步');
  assert.equal(I.blank(I.LOCAL_ID).steps, 20);
  const base = Object.assign(I.blank(I.LOCAL_ID), {steps: 32});
  const turbo = I.switchModel(base, I.LOCAL_TURBO_ID);
  assert.equal(turbo.steps, 8, '换进 Turbo 一定是 8 步');
  assert.equal(I.switchModel(turbo, I.LOCAL_ID).steps, 20, '从固定步数换出来回到默认');
  assert.equal(I.switchModel(base, I.LOCAL_ID).steps, 32, '同一只模型保留调过的步数');
  assert.equal(I.switchModel(I.blank('cloud:openai/gpt-image-2'), I.LOCAL_TURBO_ID).steps, 8);
  const cap = I.capabilities(I.LOCAL_TURBO_ID);
  assert.deepEqual(I.validate(Object.assign(I.blank(I.LOCAL_TURBO_ID), {prompt: 'x', steps: 20}), cap), ['这只模型固定 8 步']);
  assert.deepEqual(I.validate(Object.assign(I.blank(I.LOCAL_ID), {prompt: 'x', steps: 44}), I.capabilities(I.LOCAL_ID)), ['步数要在 8–40 之间']);
  assert.deepEqual(I.validate(Object.assign(I.blank(I.LOCAL_TURBO_ID), {prompt: 'x'}), cap), []);
  const l = I.engines({installed: () => true, platform: 'macos-arm64'});
  const r = I.makeRecord(Object.assign(I.blank(I.LOCAL_TURBO_ID), {prompt: 'x'}), 1, l, () => 0);
  assert.equal(r.steps, 8);
  assert.equal(I.phase(r, 50), '第 4/8 步');
  assert.match(I.recordMeta(r), /Qwen-Image-2\.1 Turbo · 本机/);
  assert.equal(I.localEta(I.LOCAL_TURBO_ID, 512, 512), 90, '每步与基础版一样快，只是 8 步');
  assert.ok(I.localEta(I.LOCAL_ID, 1024, 1024) / I.localEta(I.LOCAL_TURBO_ID, 1024, 1024) > 2);
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

test('本机按步进度：加载时没有剩余；走完一步起按平均步速推剩余；解码不编造剩余', () => {
  const t0 = 1000;
  const loading = I.stepProgress([], 8, t0, t0 + 3000);
  assert.equal(loading.stage, 'loading'); assert.equal(loading.leftMs, null); assert.equal(I.timeLine(loading), '已用 0:03');
  const zero = I.stepProgress([{t: t0 + 4000, done: 0}], 8, t0, t0 + 5000);
  assert.equal(zero.phase, '第 1/8 步'); assert.equal(zero.leftMs, null, '一步都没走完，推不出步速');
  const s = [{t: t0 + 4000, done: 0}, {t: t0 + 6000, done: 1}, {t: t0 + 8000, done: 2}];
  const p = I.stepProgress(s, 8, t0, t0 + 8500);
  assert.equal(p.phase, '第 3/8 步'); assert.equal(p.pct, 25);
  assert.equal(p.leftMs, 2000 * 6 - 500, '每步 2 秒，还剩 6 步，最后一步之后已过 0.5 秒');
  assert.equal(I.timeLine(p), '已用 0:08 · 剩余 0:12');
  assert.equal(I.stepProgress(s, 8, t0, t0 + 60000).leftMs, 0, '比推算慢时停在 0，不倒数成负数');
  const dec = I.stepProgress(s.concat({t: t0 + 20000, done: 8}), 8, t0, t0 + 21000);
  assert.equal(dec.stage, 'decoding'); assert.equal(dec.phase, '解码'); assert.equal(dec.leftMs, null);
  assert.equal(I.clock(3723000), '1:02:03');
  assert.equal(I.timeLine(I.stepProgress([], 8, null, null)), null);
});

test('按提示词改图时提示词框提醒写清怎么改（2026-10-17）', () => {
  const lc = I.capabilities(I.LOCAL_TURBO_ID);
  const f = Object.assign(I.blank(I.LOCAL_TURBO_ID), {refs: ['a']});
  assert.equal(I.editsByPrompt(f, lc), true);
  assert.match(I.promptPlaceholder(f, lc), /画完整/);
  assert.equal(I.editsByPrompt(Object.assign({}, f, {refMode: 'img2img'}), lc), false, '以图为底重画不算');
  assert.equal(I.editsByPrompt(Object.assign({}, f, {refs: []}), lc), false, '没有参考图是文生图');
  assert.equal(I.editsByPrompt(f, I.capabilities('cloud:google/gemini-3-pro-image')), false, '只作参考的模型不算');
  assert.match(I.promptPlaceholder({refs: []}, lc), /^描述你要的画面/);
});

test('参考图两种用法（2026-10-13）：本地能以图为底重画，逐张各出一张；云端只有改图 / 参考', () => {
  const lc = I.capabilities(I.LOCAL_TURBO_ID);
  assert.deepEqual(I.refModes(lc).map((m) => m.label), ['按提示词改图', '以图为底重画']);
  assert.deepEqual(I.refModes(I.capabilities('cloud:google/gemini-3-pro-image')).map((m) => m.k), ['ref'], 'Gemini 只作为参考');
  assert.deepEqual(I.refModes(I.capabilities('cloud:zhipu/glm-image')), [], '不认参考图就没有用法');
  const f = Object.assign(I.blank(I.LOCAL_TURBO_ID), {prompt: '改成水彩', refMode: 'img2img', refs: ['a', 'b', 'c']});
  assert.equal(I.strengthOf(f, lc), 0.6);
  assert.equal(I.outputCount(f, lc), 3, '一次一张底图：三张各出一张');
  assert.match(I.refsNote(f, lc), /3 张底图各重画一张 · 只在这台电脑上读，不上传/);
  assert.deepEqual(I.validate(f, lc), []);
  assert.ok(I.validate(Object.assign({}, f, {refs: []}), lc).includes('以图为底重画要先选一张底图'));
  assert.ok(I.validate(Object.assign({}, f, {strength: 0}), lc).some((e) => /改动幅度要在 0.1–1 之间/.test(e)));
  const l = I.engines({installed: () => true, platform: 'macos-arm64'});
  const r = I.makeRecord(f, 1, l, () => 0);
  assert.equal(r.n, 3); assert.equal(r.refMode, 'img2img'); assert.equal(r.strength, 0.6);
  assert.deepEqual(r.images.map((img) => img.base), [['a'], ['b'], ['c']]);
  assert.match(I.recordMeta(r), /3 张 · 以图为底 · 幅度 0.6/);
  assert.deepEqual(I.provenance(r, r.images[1]).refs, ['b']);
  assert.equal(I.provenance(r, r.images[1]).refMode, 'img2img');
  assert.match(I.statusLine(f, l, [1024, 1024]), /本机 · 3 张 · 约/);
  assert.match(I.agentPrompt(f, l), /以参考图为底重画 3 张（改动幅度 0.6）/);
  // 换到不能以图为底的模型：落回参考用法，参考图留着
  const g = I.switchModel(f, 'cloud:openai/gpt-image-2');
  assert.equal(g.refMode, 'ref'); assert.deepEqual(g.refs, ['a', 'b', 'c']);
  assert.equal(I.outputCount(g, I.capabilities('cloud:openai/gpt-image-2')), 1);
  // 改图用法：几张一起出一张
  const h = Object.assign({}, f, {refMode: 'ref'});
  assert.equal(I.outputCount(h, lc), 1);
  assert.equal(I.makeRecord(h, 2, l, () => 0).images[0].base, null);
});
