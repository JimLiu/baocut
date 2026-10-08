/* 图像生成的纯模型 —— docs/design/image/bcut-image-generation-design.md（2026-09-25，原型先行）。
   三族引擎共一张能力表：云端 API 提供方 `cloud:<provider>/<model>`（OpenAI / Gemini / 百炼 / 火山引擎 / MiniMax / 智谱 /
   OpenRouter + OpenAI-compatible 自建；提供方 id 与 model-vendors.js 的目录一致，product-design §7.6）、Codex CLI 画图 `agent:codex/image-gen`（不走密钥，用装好并登录的
   Codex）、本地模型 `qwen-image-2.1`（4-bit，Apple Silicon / Windows / Linux）。这里放：三族 id 的判别与拆拼、API 提供方种子表、
   按 (provider, model) 的能力表（§4）、画幅 → 尺寸（§4.5）、参数门（§10.2）、费用 / 状态一句、Codex 就绪判定（§2.2）、
   工具页与图片 Tab 共用的表单 / 记录 / 出处侧车（§7.5）、交给 Agent 的提示。真相将来在 `bcut_image::capabilities`
   与 `bcut-kernel/services/image_gen.rs`，这里照设计稿抄。只算，不画。 */
(function () {
  const PREFIX = 'cloud:';
  const AGENT_PREFIX = 'agent:';
  const CODEX_ID = 'agent:codex/image-gen';
  const CODEX_MIN_VER = '0.130.0';
  const LOCAL_ID = 'qwen-image-2.1';

  /* ---------- 画幅 ---------- */
  const ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '2.35:1'];
  const ratioOf = (a) => { const [w, h] = String(a).split(':').map(Number); return w / h; };
  /** 项目画幅（'16:9' / '9:16' / '1:1' / '4:5' …）折成最近的一档生图画幅（§4.5 第 3 条） */
  function fitAspect(ratio, allowed) {
    const list = (allowed && allowed.length ? allowed : ASPECTS);
    const r = typeof ratio === 'number' ? ratio : ratioOf(ratio || '16:9');
    return list.reduce((best, a) => (Math.abs(ratioOf(a) - r) < Math.abs(ratioOf(best) - r) ? a : best), list[0]);
  }

  /* ---------- 能力表（§4）----------
     sizes：`{multiple, maxEdge, maxRatio}`（OpenAI / 本地）、`{enum: {aspect: {normal: [w,h], k2: [w,h]}}}`、`'fixed'`（Codex 忽略尺寸）。
     refs：0 = 不认参考图；n = 最多 n 张。 */
  const ENUM_1K = {'1:1': [1024, 1024], '16:9': [1344, 768], '9:16': [768, 1344], '4:3': [1152, 896], '3:4': [896, 1152], '2.35:1': [1536, 640]};
  const ENUM_2K = {'1:1': [2048, 2048], '16:9': [2688, 1536], '9:16': [1536, 2688], '4:3': [2304, 1792], '3:4': [1792, 2304], '2.35:1': [3072, 1280]};
  const enumSizes = (k2) => ({enum: Object.fromEntries(ASPECTS.map((a) => [a, {normal: ENUM_1K[a], k2: k2 ? ENUM_2K[a] : null}]))});
  const caps = (o) => Object.assign({aspects: ASPECTS, sizes: enumSizes(true), quality: ['normal', '2k'], maxN: 4, refs: 0,
    negative: false, seed: false, transparent: false, promptMax: 4000, edit: false}, o);

  /* ---------- API 提供方种子表（§3.3）----------
     `api`：线上形状。价格是「每张 · 美元」两档（§9.1），写稿时未核实，落地时逐家从官方价目抄（§12.1）。 */
  const PROVIDERS = [
    {id: 'openai', name: 'OpenAI', api: 'openai', env: 'OPENAI_API_KEY',
     desc: '尺寸自由（16 的倍数、最长边 3840）；认参考图（编辑）；能出透明底',
     docs: 'platform.openai.com/docs/guides/image-generation',
     models: [
       {id: 'gpt-image-2.5-flare', desc: '当前一代 · 质量最好', price: {normal: 0.04, k2: 0.17}, caps: caps({sizes: {multiple: 16, maxEdge: 3840, maxRatio: 3}, refs: 16, transparent: true, promptMax: 32000, edit: true})},
       {id: 'gpt-image-2.5-sunburst', desc: '当前一代 · 更快', price: {normal: 0.02, k2: 0.08}, caps: caps({sizes: {multiple: 16, maxEdge: 3840, maxRatio: 3}, refs: 16, transparent: true, promptMax: 32000, edit: true})},
       {id: 'gpt-image-2', desc: '上一代', prev: true, price: {normal: 0.04, k2: 0.17}, caps: caps({sizes: {multiple: 16, maxEdge: 3840, maxRatio: 3}, refs: 16, transparent: true, promptMax: 32000, edit: true})},
       {id: 'gpt-image-1.5', desc: '上一代 · 便宜', prev: true, price: {normal: 0.01, k2: 0.04}, caps: caps({sizes: {multiple: 16, maxEdge: 3840, maxRatio: 3}, refs: 16, transparent: true, promptMax: 32000, edit: true})},
     ]},
    {id: 'google', name: 'Google Gemini', api: 'gemini', env: 'GOOGLE_API_KEY',
     desc: '1K / 2K 两档；最多 14 张参考图；不认负向提示与种子',
     docs: 'ai.google.dev/gemini-api/docs/image-generation',
     models: [
       {id: 'gemini-3-pro-image', desc: '当前一代 · 质量最好 · 最多 14 张参考图', price: {normal: 0.13, k2: 0.24}, caps: caps({refs: 14, promptMax: 8000})},
       {id: 'gemini-3.1-flash-image', desc: '更快 · 最多 14 张参考图', price: {normal: 0.04, k2: 0.08}, caps: caps({refs: 14, promptMax: 8000})},
       {id: 'gemini-3.1-flash-lite-image', desc: '最便宜 · 只有 1K', price: {normal: 0.02, k2: null}, caps: caps({sizes: enumSizes(false), quality: ['normal'], refs: 14, promptMax: 8000})},
     ]},
    {id: 'qwen', name: '阿里云百炼（Qwen）', api: 'dashscope', env: 'DASHSCOPE_API_KEY',
     desc: 'Qwen-Image 文生图；wan2.7 认参考图；负向提示与种子都认',
     docs: 'help.aliyun.com/zh/model-studio/image-generation',
     models: [
       {id: 'qwen-image-3.0-pro', desc: '当前一代 · 文生图 · 中文排版好', price: {normal: 0.03, k2: 0.05}, caps: caps({negative: true, seed: true, promptMax: 800})},
       {id: 'qwen-image-2.0-pro', desc: '上一代', prev: true, price: {normal: 0.02, k2: 0.04}, caps: caps({negative: true, seed: true, promptMax: 800})},
       {id: 'wan2.7-image-pro', desc: '认参考图 · 质量更高', price: {normal: 0.05, k2: 0.08}, caps: caps({refs: 4, negative: true, seed: true, promptMax: 800})},
       {id: 'wan2.7-image', desc: '认参考图 · 更快', price: {normal: 0.03, k2: 0.05}, caps: caps({refs: 4, negative: true, seed: true, promptMax: 800})},
     ]},
    {id: 'volcengine', name: '火山引擎（豆包）', api: 'ark', env: 'ARK_API_KEY',
     desc: 'Seedream；认参考图与种子；1K / 2K / 4K',
     docs: 'www.volcengine.com/docs/82379',
     models: [
       {id: 'doubao-seedream-5.0', desc: '当前一代 · 认参考图（模型 id 待核实）', price: {normal: 0.03, k2: 0.05}, caps: caps({refs: 4, seed: true, promptMax: 2000})},
     ]},
    {id: 'minimax', name: 'MiniMax', api: 'minimax', env: 'MINIMAX_API_KEY',
     desc: '一次最多 9 张；一张主体参考图；只有 1K',
     docs: 'platform.minimax.io/docs/api-reference/image-generation',
     models: [
       {id: 'image-01', desc: '一次最多 9 张 · 一张主体参考图', price: {normal: 0.01, k2: null}, caps: caps({sizes: enumSizes(false), quality: ['normal'], maxN: 9, refs: 1, seed: true, promptMax: 1500})},
     ]},
    {id: 'zhipu', name: '智谱 GLM（Z.ai）', api: 'zai', env: 'ZAI_API_KEY',
     desc: 'GLM-Image；一次一张；只有 1K',
     docs: 'docs.bigmodel.cn/cn/guide/models/image-generation',
     models: [
       {id: 'glm-image', desc: '一次一张 · 只有 1K', price: {normal: 0.01, k2: null}, caps: caps({sizes: enumSizes(false), quality: ['normal'], maxN: 1, promptMax: 1000})},
     ]},
    /* xAI（product-design §7.6 目录：文本 + 图像，图像本轮 P1）：OpenAI 形状的 /v1/images/generations，不收尺寸、一次至多 10 张；价格以官网为准 */
    {id: 'xai', name: 'xAI（Grok）', api: 'openai', env: 'XAI_API_KEY',
     desc: '只认张数，不收尺寸与画幅；一次最多 10 张',
     docs: 'docs.x.ai/docs/guides/image-generations',
     models: [
       {id: 'grok-2-image-1212', desc: '一次最多 10 张 · 不收尺寸', price: {normal: 0.07, k2: null}, caps: caps({sizes: enumSizes(false), quality: ['normal'], maxN: 10, promptMax: 1000})},
     ]},
    {id: 'openrouter', name: 'OpenRouter', api: 'openrouter', env: 'OPENROUTER_API_KEY',
     desc: '一把密钥经它用各家的模型；能力按上游模型查表，查不到按保守默认',
     docs: 'openrouter.ai/docs/features/multimodal/image-generation',
     models: [
       {id: 'google/gemini-3-pro-image', desc: '透传 Gemini · 最多 14 张参考图', price: {normal: 0.13, k2: 0.24}, caps: caps({refs: 14, promptMax: 8000})},
     ]},
  ];
  /** 自建 API 提供方（OpenAI-compatible `/v1/images/generations`）的保守默认（§4.4）；勾了才开参考图 / 种子 */
  const CUSTOM_CAPS = (o) => caps(Object.assign({sizes: {multiple: 64, maxEdge: 2048, maxRatio: 2}, quality: ['normal'], refs: o && o.edits ? 4 : 0, seed: !!(o && o.seed), edit: !!(o && o.edits)}));
  /* 演示里已连上账号、有图像模型的 API 提供方；真正的种子是 model-vendors.js 的 SEED_ACCOUNTS（store 从账号推出 cloudSaved） */
  const SEED_SAVED = ['openai', 'minimax'];

  /* ---------- 三族 id ---------- */
  const isCloud = (id) => String(id || '').indexOf(PREFIX) === 0;
  const isAgent = (id) => String(id || '').indexOf(AGENT_PREFIX) === 0;
  const isLocal = (id) => !!id && !isCloud(id) && !isAgent(id);
  const family = (id) => (isCloud(id) ? 'cloud' : isAgent(id) ? 'agent' : 'local');
  const modelId = (provider, model) => `${PREFIX}${provider}/${model}`;
  function parse(id) {
    if (!isCloud(id)) return null;
    const rest = String(id).slice(PREFIX.length);
    const i = rest.indexOf('/');
    if (i <= 0 || i === rest.length - 1) return null;
    return {provider: rest.slice(0, i), model: rest.slice(i + 1)};
  }
  const providerOf = (id) => { const p = parse(id); return p ? p.provider : null; };

  /* ---------- API 提供方目录（种子 + 自建）---------- */
  const CUSTOM = new Map();
  function customProvider(o) {
    const p = {id: o.id, name: o.name, api: 'openai', custom: true, url: o.url, desc: 'OpenAI-compatible /v1/images/generations',
      models: (o.models || []).map((id) => ({id, desc: '自建 · 保守能力', price: null, caps: CUSTOM_CAPS(o)}))};
    CUSTOM.set(p.id, p);
    return p;
  }
  const providers = (extra) => PROVIDERS.concat(Array.from(CUSTOM.values()), extra || []);
  const providerById = (id, extra) => providers(extra).find((p) => p.id === id) || null;
  function modelOf(id, extra) {
    const p = parse(id);
    if (!p) return null;
    const prov = providerById(p.provider, extra);
    return prov ? (prov.models.find((m) => m.id === p.model) || null) : null;
  }

  /* ---------- 本地模型 ---------- */
  const LOCAL = {
    [LOCAL_ID]: {id: LOCAL_ID, name: 'Qwen-Image-2.1', size: 9.8 * 1024, platform: 'macos-arm64,windows-x64,linux-x64', steps: 20,
      desc: '文生图 · 4-bit · Apple Silicon / Windows / Linux · CPU 较慢',
      /* POC 实测（§6.2）：512² 20 步 ≈ 214 s、1024² ≈ 881 s、VAE 解码 10.4 s——每步秒数按像素线性插值 */
      pace: {512: 9.9, 1024: 43.5, decode: 10.4},
      caps: caps({sizes: {multiple: 32, maxEdge: 1536, maxRatio: 3}, quality: ['normal'], maxN: 1, seed: true, promptMax: 1024})},
  };
  /** 本地生成的耗时估算（秒）：每步秒数按像素在 512² 与 1024² 之间线性插值，加解码 */
  function localEta(id, w, h, steps) {
    const m = LOCAL[id];
    if (!m) return 0;
    const px = (w || 1024) * (h || 1024);
    const t = px <= 512 * 512 ? m.pace[512] * (px / (512 * 512))
      : m.pace[512] + (m.pace[1024] - m.pace[512]) * Math.min(3, (px - 512 * 512) / (1024 * 1024 - 512 * 512));
    return Math.round(t * (steps || m.steps) + m.pace.decode);
  }

  /* ---------- Codex 画图（§2.2 / §4.3）---------- */
  const CODEX_CAPS = caps({aspects: ['1:1', '16:9', '9:16', '4:3', '2.35:1'], sizes: 'fixed', quality: ['normal'], maxN: 1, refs: 4, promptMax: 4000});
  function compareVer(a, b) {
    const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
    const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }
  /** Codex 画图就绪与否：探测到 ∧ 登录 ∧ 版本 ≥ 0.130 ∧ 用户开了开关。`why` 是没就绪时的一句。 */
  function codexReady(h, on) {
    if (!h || !h.found) return {ready: false, why: '未安装 Codex', problem: 'missing'};
    if (h.runError) return {ready: false, why: 'Codex 无法运行', problem: 'error'};
    if (compareVer(h.ver, CODEX_MIN_VER) < 0) return {ready: false, why: `Codex ${h.ver} 太旧 · 画图至少要 ${CODEX_MIN_VER}`, problem: 'outdated'};
    if (h.loggedIn === false) return {ready: false, why: 'Codex 需要登录', problem: 'login'};
    if (!on) return {ready: false, why: '「用 Codex 画图」还没打开', problem: 'off'};
    return {ready: true, why: null, problem: null};
  }
  /** 开关本身能不能打开（不看开关值） */
  const codexCanEnable = (h) => codexReady(h, true).ready;

  /* ---------- 引擎清单（三族折成一张表）----------
     `saved`：已连密钥的提供方 id；`extra`：自建；`codex`：{h, on}；`installed(id)`：本地权重装没装。
     每条 {id, family, name, ready, why, models:[{id: 完整 id, model, desc, prev, price, caps}]}。
     Codex 不被隐式选中（§1.1 第 3 条，2026-09-27 用户裁决拆成两半）：用户在设置里把默认生图模型显式设成 Codex 且它就绪时
     `preferred` 照用；「每次选择 / 第一只能用的」这条回落永远跳过它。 */
  function engines(o) {
    const saved = (o && o.saved) || [];
    const out = providers(o && o.extra).map((p) => ({
      id: PREFIX + p.id, family: 'cloud', provider: p.id, name: p.name, desc: p.desc, custom: !!p.custom,
      ready: saved.indexOf(p.id) >= 0, why: saved.indexOf(p.id) >= 0 ? null : '未连接',
      models: p.models.map((m) => ({id: modelId(p.id, m.id), model: m.id, desc: m.desc, prev: !!m.prev, price: m.price, caps: m.caps})),
    }));
    const cr = codexReady(o && o.codex && o.codex.h, o && o.codex && o.codex.on);
    out.push({id: CODEX_ID, family: 'agent', name: 'Codex 画图', desc: '不用密钥 · 一次一张 · 忽略尺寸 · 慢 5–10 倍', ready: cr.ready, why: cr.why, problem: cr.problem,
      models: [{id: CODEX_ID, model: 'image-gen', desc: '用 Codex 自带的图像生成工具', price: null, caps: CODEX_CAPS}]});
    Object.keys(LOCAL).forEach((id) => {
      const m = LOCAL[id];
      const on = !!(o && o.installed && o.installed(id));
      const platform = !o || o.platform == null || m.platform.split(',').includes(o.platform);
      out.push({id, family: 'local', name: m.name, desc: m.desc, size: m.size, ready: on && platform,
        measuredPace: !!(o && o.platform === 'macos-arm64'),
        why: !platform ? '此平台或构建暂不可用' : on ? null : '未下载',
        models: [{id, model: id, desc: m.desc, price: null, caps: m.caps}]});
    });
    return out;
  }
  const engineOf = (list, id) => list.find((e) => e.models.some((m) => m.id === id)) || null;
  const modelIn = (list, id) => { const e = engineOf(list, id); return e ? e.models.find((m) => m.id === id) : null; };
  /** 开页先取已配置且就绪的默认值（云端、本地，或用户显式设成默认的 Codex），再取第一只就绪的云端。
      回落永远不落到 Codex；默认是 Codex 但没就绪（开关关着 / 没装 / 没登录 / 太旧）时同样回落到第一只就绪的云端，存着的默认不清。 */
  function preferred(list, dflt) {
    if (dflt && modelIn(list, dflt) && engineOf(list, dflt).ready) return dflt;
    const e = list.find((x) => x.ready && x.family === 'cloud');
    return e ? e.models[0].id : null;
  }
  /** 有没有任何一只能用（图片 Tab 决定画表单还是引路卡） */
  const anyReady = (list) => list.some((e) => e.ready);

  /* ---------- 能力查表 ---------- */
  function capabilities(id, extra) {
    if (id === CODEX_ID) return CODEX_CAPS;
    if (LOCAL[id]) return LOCAL[id].caps;
    const m = modelOf(id, extra);
    return m ? m.caps : caps({});
  }

  /* ---------- 画幅 → 尺寸（§4.5）---------- */
  const roundTo = (n, k) => Math.max(k, Math.round(n / k) * k);
  function resolveSize(cap, aspect, quality, explicit) {
    if (cap.sizes === 'fixed') return null;
    if (explicit) return explicit;
    const a = cap.aspects.indexOf(aspect) >= 0 ? aspect : cap.aspects[0];
    const q = cap.quality.indexOf(quality) >= 0 ? quality : 'normal';
    if (cap.sizes.enum) {
      const row = cap.sizes.enum[a] || cap.sizes.enum['1:1'];
      return (q === '2k' && row.k2) || row.normal;
    }
    const long = Math.min(cap.sizes.maxEdge, q === '2k' ? 2048 : 1024);
    const r = ratioOf(a);
    const k = cap.sizes.multiple;
    return r >= 1 ? [roundTo(long, k), roundTo(long / r, k)] : [roundTo(long * r, k), roundTo(long, k)];
  }
  /** 显式尺寸合不合规则；不合就给最近合法值 */
  function checkSize(cap, size) {
    if (!size || cap.sizes === 'fixed') return null;
    const [w, h] = size;
    if (cap.sizes.enum) {
      const ok = Object.values(cap.sizes.enum).some((row) => [row.normal, row.k2].some((s) => s && s[0] === w && s[1] === h));
      return ok ? null : `这只模型只认固定几档尺寸 · 例如 ${cap.sizes.enum['1:1'].normal.join('×')}`;
    }
    const {multiple, maxEdge, maxRatio} = cap.sizes;
    const fix = [roundTo(Math.min(w, maxEdge), multiple), roundTo(Math.min(h, maxEdge), multiple)];
    if (w % multiple || h % multiple || w > maxEdge || h > maxEdge) return `尺寸要是 ${multiple} 的倍数、最长边 ${maxEdge} · 建议 ${fix.join('×')}`;
    if (Math.max(w / h, h / w) > maxRatio) return `长宽比不能超过 ${maxRatio}:1`;
    return null;
  }

  /* ---------- 表单 ---------- */
  function blank(model) {
    return {prompt: '', model: model || null, aspect: '16:9', fit: true, quality: 'normal', n: 1, refs: [], negative: '', seed: '', transparent: false, steps: 20, advanced: false};
  }
  /** 换模型：不认的画幅落到它的第一档、数量夹到上限、不认的旋钮清零 */
  function switchModel(f, id, extra) {
    const cap = capabilities(id, extra);
    const next = Object.assign({}, f, {model: id});
    if (cap.aspects.indexOf(f.aspect) < 0) next.aspect = cap.aspects[0];
    if (cap.quality.indexOf(f.quality) < 0) next.quality = 'normal';
    next.n = Math.min(Math.max(1, f.n || 1), cap.maxN);
    // 参考图留在草稿里：换到不认参考图的模型只是这次不用（表单写一句提示），换回来还在；超过上限的也留着，参数门报
    next.refs = (f.refs || []).slice();
    if (!cap.negative) next.negative = '';
    if (!cap.seed) next.seed = '';
    if (!cap.transparent) next.transparent = false;
    return next;
  }
  /** 参数门（§10.2）：一次报完所有违反项；空提示词是第一条 */
  const EMPTY_PROMPT = '先写要画的画面';
  function validate(f, cap) {
    const errs = [];
    const p = String(f.prompt || '').trim();
    if (!p) errs.push(EMPTY_PROMPT);
    if (p.length > cap.promptMax) errs.push(`提示词 ${p.length} 字 · 这只模型最多 ${cap.promptMax} 字`);
    if (cap.aspects.indexOf(f.aspect) < 0) errs.push(`这只模型不认 ${f.aspect} 画幅`);
    if ((f.n || 1) > cap.maxN) errs.push(`一次最多 ${cap.maxN} 张`);
    // 不认参考图的模型：已选的参考图这次不用，不算错（表单里写提示）；认的才按上限报
    if (cap.refs && (f.refs || []).length > cap.refs) errs.push(`参考图最多 ${cap.refs} 张`);
    if (f.negative && !cap.negative) errs.push('这只模型不认负向提示');
    if (f.seed !== '' && f.seed != null && !cap.seed) errs.push('这只模型不认种子');
    if (f.seed !== '' && f.seed != null && !/^\d+$/.test(String(f.seed))) errs.push('种子要是整数');
    if (f.transparent && !cap.transparent) errs.push('这只模型不能出透明底');
    if (f.size) { const bad = checkSize(cap, f.size); if (bad) errs.push(bad); }
    return errs;
  }

  /* ---------- 参考图（§2.4 第 5 条）：素材库里的按 id 引用；从文件选 / 拖进来的登记在这张表里 ----------
     id 形如 `file:3`；正式版是拷进素材库再引用，原型只留名字与预览 url。 */
  const FILE_REFS = {};
  let fileSeq = 0;
  /** items: [{name, url?, size?}] → 登记后的 id 列表 */
  function addFileRefs(items) {
    return (items || []).map((it) => {
      const id = 'file:' + (++fileSeq);
      FILE_REFS[id] = {id, name: it.name || ('图片-' + fileSeq + '.png'), url: it.url || null, size: it.size || 0, file: true,
        alpha: /\.png$/i.test(it.name || '')};
      return id;
    });
  }
  /** 解析一个参考图 id：先查素材库，再查文件表；查不到给一条只有名字的占位 */
  function refInfo(id, lib) {
    return (lib || []).find((s) => s.id === id) || FILE_REFS[id] || {id, name: String(id).replace(/^file:/, '参考图 '), missing: true};
  }
  /** 这次真会送出去的参考图：模型不认就一张不送，认的按上限截 */
  function usedRefs(f, cap) {
    const refs = (f.refs || []).slice();
    return cap.refs ? refs.slice(0, cap.refs) : [];
  }
  /** 参考图那一行的提示：认 / 不认 / 超了 */
  function refsNote(f, cap, engineName) {
    const n = (f.refs || []).length;
    if (!cap.refs) return `${engineName || '这只模型'} 不认参考图${n ? `，已选的 ${n} 张这次不会用` : ''}`;
    const tail = cap.edit ? ' · 会按参考图编辑' : ' · 作为参考';
    return `最多 ${cap.refs} 张${tail}${n ? ' · 参考图会上传给服务商' : ''}${n > cap.refs ? ` · 超出的 ${n - cap.refs} 张不送` : ''}`;
  }
  /** 示例缩略（CSS 渐变）里的几个色站，给「下载图片」画一张真 PNG 用 */
  const artColors = (art) => (String(art || '').match(/#[0-9A-Fa-f]{6}/g) || DEMO_ART[0].match(/#[0-9A-Fa-f]{6}/g));

  /* ---------- 费用与状态一句（§9.1 / §2.4 第 7 条）---------- */
  const usd = (x) => `$${x.toFixed(2)}`;
  function costOf(f, list) {
    const m = modelIn(list, f.model);
    if (!m || !m.price) return null;
    const per = f.quality === '2k' && m.price.k2 != null ? m.price.k2 : m.price.normal;
    return {per, total: per * (f.n || 1), n: f.n || 1};
  }
  /** 生成按钮旁那句：联网的算钱、本机的估时、Codex 说明慢 */
  function statusLine(f, list, size) {
    const e = engineOf(list, f.model);
    if (!e) return '先选一只模型';
    if (e.family === 'agent') return 'Codex · 一张 · 通常 1–3 分钟 · 用你的 Codex 订阅';
    if (e.family === 'local') {
      if (!e.measuredPace) return '本机 · 不联网 · 耗时取决于设备';
      const s = size || [1024, 1024];
      const eta = localEta(f.model, s[0], s[1], f.steps);
      return `本机 · 约 ${eta >= 90 ? Math.round(eta / 60) + ' 分钟' : eta + ' 秒'} · 不联网`;
    }
    const c = costOf(f, list);
    return `联网 · ${e.name}${c ? ` · ${c.n > 1 ? `${c.n} 张约 ${usd(c.total)}` : `每张约 ${usd(c.per)}`}` : ' · 价格以服务商为准'}`;
  }
  /** 页顶 chip */
  function headerChip(f, list) {
    const e = engineOf(list, f.model);
    if (!e) return {icon: 'image', tone: undefined, text: '还没选模型'};
    if (e.family === 'agent') return {icon: 'agent', tone: 'notice', text: 'Codex · 用订阅额度 · 慢 5–10 倍'};
    if (e.family === 'local') return {icon: 'lock', tone: undefined, text: '在这台电脑上出图 · 不联网'};
    return {icon: 'remote', tone: 'notice', text: `联网 · ${e.name} · 按张计费`};
  }

  /* ---------- 记录与出处侧车（§7.5）---------- */
  const pad = (n) => String(n).padStart(3, '0');
  const shortName = (id) => (isCloud(id) ? parse(id).model : isAgent(id) ? 'codex' : id).replace(/[^a-z0-9.-]+/gi, '-').slice(0, 24);
  /* 演示用的「生成结果」：确定性地按 seed 挑一张渐变，不是随机——原型必须可复现 */
  /* @ds-allow: 生成结果的缩略是素材本身，不是 S2 表面 */
  const DEMO_ART = [
    'linear-gradient(135deg, #F6D365 0%, #FDA085 100%)',
    'linear-gradient(160deg, #A1C4FD 0%, #C2E9FB 100%)',
    'linear-gradient(140deg, #2B5876 0%, #4E4376 100%)',
    'linear-gradient(135deg, #F093FB 0%, #F5576C 100%)',
    'linear-gradient(150deg, #43E97B 0%, #38F9D7 100%)',
    'linear-gradient(135deg, #30CFD0 0%, #330867 100%)',
    'linear-gradient(145deg, #FFECD2 0%, #FCB69F 100%)',
    'linear-gradient(135deg, #0F2027 0%, #2C5364 100%)',
  ];
  const demoArt = (seed) => DEMO_ART[Math.abs(Number(seed) || 0) % DEMO_ART.length];
  const seedFor = (f, i, rnd) => (f.seed !== '' && f.seed != null ? Number(f.seed) + i : Math.floor((rnd || Math.random)() * 1e9));
  /** 一次生成的一条记录：状态 queued → running → done / error；`images[]` 是这次的 n 张 */
  function makeRecord(f, seq, list, rnd) {
    const e = engineOf(list, f.model) || {name: '?', family: 'cloud'};
    const cap = capabilities(f.model);
    const size = resolveSize(cap, f.aspect, f.quality, f.size);
    const n = e.family === 'agent' ? 1 : Math.min(f.n || 1, cap.maxN);
    const c = costOf(f, list);
    return {
      id: 'img' + seq, seq, status: 'queued', pct: 0, taskId: null, ago: null,
      prompt: String(f.prompt || '').trim(), model: f.model, family: e.family, engineName: e.name,
      provider: e.family === 'cloud' ? e.name : null,
      aspect: f.aspect, size, quality: f.quality, n, refs: usedRefs(f, cap), negative: f.negative || null,
      transparent: !!f.transparent, steps: e.family === 'local' ? f.steps : null,
      cost: c ? c.total : null,
      eta: e.family === 'local' ? (e.measuredPace && size ? localEta(f.model, size[0], size[1], f.steps) : null) : e.family === 'agent' ? 120 : 12,
      images: Array.from({length: n}, (_, i) => { const seed = seedFor(f, i, rnd); return {id: `img${seq}-${i + 1}`, name: `图片-${pad(seq)}-${shortName(f.model)}-${seed}.png`, seed, art: demoArt(seed)}; }),
      form: Object.assign({}, f),
    };
  }
  /** 记录的元数据行：「1536×864 · 16:9 · OpenAI · gpt-image-2.5-flare · 2 张 · $0.08」 */
  function recordMeta(r) {
    const model = isCloud(r.model) ? parse(r.model).model : isAgent(r.model) ? 'Codex' : (LOCAL[r.model] || {name: r.model}).name;
    return [r.size ? r.size.join('×') : '尺寸由 Codex 定', r.aspect, r.engineName, isAgent(r.model) ? null : model, r.n > 1 ? `${r.n} 张` : null,
      r.cost != null ? `约 ${usd(r.cost)}` : r.family === 'local' ? '本机' : r.family === 'agent' ? '订阅额度' : null].filter(Boolean).join(' · ');
  }
  /** 出处侧车（§7.5 的 JSON 形状）：收进素材库时随文件写一份 */
  function provenance(r, img) {
    return {kind: 'image-gen', v: 1, model: r.model, provider: r.family === 'cloud' ? providerOf(r.model) : r.family,
      engineName: r.engineName, modelName: isCloud(r.model) ? parse(r.model).model : null,
      prompt: r.prompt, negative: r.negative, aspect: r.aspect, size: r.size, quality: r.quality, seed: img.seed, refs: r.refs,
      createdAt: r.createdAt || null, elapsedMs: r.elapsed != null ? Math.round(r.elapsed * 1000) : null,
      cost: r.cost != null ? {amount: r.cost, currency: 'USD'} : null,
      license: r.family === 'cloud' ? (modelOf(r.model) && !providerById(providerOf(r.model)).custom ? 'provider-terms' : 'unknown') : r.family === 'local' ? 'local' : 'provider-terms'};
  }
  const LICENSE_LABEL = {'provider-terms': '按服务商条款', local: '本机模型 · 按权重许可', unknown: '许可未知 · 导出前会提醒'};
  /** 生成结果收进素材库后的那条 `Source`（图片 Tab 的素材卡）：带出处、✦ 徽标 */
  function toSource(r, img, seq) {
    return {id: 'ai' + seq, name: img.name, meta: `${r.size ? r.size.join(' × ') : '—'} · AI 生成`, grad: img.art, alpha: r.transparent,
      origin: 'ai', gen: provenance(r, img)};
  }
  /** 生成阶段一句（进度 → 文案） */
  function phase(r, pct) {
    if (r.family === 'agent') return pct < 15 ? '启动 Codex' : pct < 90 ? 'Codex 正在画' : '检查 PNG';
    if (r.family === 'local') { const total = r.steps || 20; return pct < 10 ? '加载模型' : pct < 92 ? `第 ${Math.max(1, Math.min(total, Math.round(((pct - 10) / 82) * total)))}/${total} 步` : '解码'; }
    return pct < 15 ? `连接 ${r.provider}` : pct < 85 ? `生成中${r.n > 1 ? ` ${Math.min(r.n, 1 + Math.floor(((pct - 15) / 70) * r.n))}/${r.n}` : ''}` : '下载';
  }

  /* ---------- 交给 Agent（§2.6）---------- */
  function agentPrompt(f, list) {
    const e = engineOf(list, f.model);
    const name = !e ? '默认模型' : e.family === 'cloud' ? `${e.name} ${parse(f.model).model}（云端）` : e.family === 'agent' ? 'Codex 画图' : e.name + '（本机）';
    const parts = [`模型 ${name}`, `画幅 ${f.aspect}`];
    if ((f.n || 1) > 1) parts.push(`${f.n} 张`);
    if (f.refs && f.refs.length) parts.push(`参考图 ${f.refs.length} 张`);
    if (f.quality === '2k') parts.push('2K');
    if (f.transparent) parts.push('透明底');
    return `用 BaoCut 生成图片（bcut image）：${parts.join('，')}。生成好放进视频素材库，不要改我的提示词。要画的画面：\n\n${String(f.prompt || '').trim() || '（把要画的画面放在这里）'}`;
  }

  /* ---------- 卡片状态行（工具页目录）---------- */
  function toolStatus(list) {
    const cloud = list.filter((e) => e.family === 'cloud' && e.ready).length;
    const local = list.filter((e) => e.family === 'local' && e.ready).length;
    const codex = list.some((e) => e.family === 'agent' && e.ready);
    const bits = [cloud ? `${cloud} 家云端已连接` : null, local ? `本机已装 ${local} 只` : null, codex ? 'Codex 画图已开' : null].filter(Boolean);
    return {text: bits.length ? bits.join(' · ') : '还没有可用的生图模型', on: bits.length > 0};
  }

  const BC_CLOUD_IMAGE = {
    PREFIX, AGENT_PREFIX, CODEX_ID, CODEX_MIN_VER, LOCAL_ID, ASPECTS, PROVIDERS, LOCAL, SEED_SAVED, EMPTY_PROMPT, DEMO_ART, LICENSE_LABEL,
    ratioOf, fitAspect, isCloud, isAgent, isLocal, family, modelId, parse, providerOf,
    customProvider, providers, providerById, modelOf, capabilities, CUSTOM_CAPS,
    localEta, codexReady, codexCanEnable, compareVer,
    engines, engineOf, modelIn, preferred, anyReady,
    resolveSize, checkSize, blank, switchModel, validate, costOf, statusLine, headerChip,
    makeRecord, recordMeta, provenance, toSource, phase, demoArt, agentPrompt, toolStatus,
    addFileRefs, refInfo, usedRefs, refsNote, artColors, FILE_REFS,
  };
  if (typeof module !== 'undefined') module.exports = BC_CLOUD_IMAGE;
  if (typeof window !== 'undefined') Object.assign(window, {BC_CLOUD_IMAGE});
})();
