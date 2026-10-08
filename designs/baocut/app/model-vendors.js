/* API 提供方目录与账号（product-design §7.6）：设置 › 模型 › API 提供方的纯模型。
   一家 API 提供方 = 厂商或中转平台的一个接入；一个账号 = 一把密钥；模型 = API 提供方下某能力的一个模型 id。
   一家加一把密钥，它有的能力（文本 / 识别 / 合成 / 生图）都能用；一家可以有多个账号，有序，
   一次调用用「第一个启用且有密钥」的账号，失败不换号（用户用「设为首选」调序）。
   语音合成与图像生成的模型表仍在 model-cloud-tts.js / model-cloud-image.js（它们还带能力、音色与价格），这里按 id 读过来；
   文本与语音识别的内置模型写在这里。只算，不画。 */
(function () {
  const W = typeof window !== 'undefined' ? window : {};
  const req = (name, file) => W[name] || (typeof require === 'function' ? require(file) : null);
  const TTS = () => req('BC_CLOUD_TTS', './model-cloud-tts.js');
  const IMG = () => req('BC_CLOUD_IMAGE', './model-cloud-image.js');

  /* ---------- 能力 ---------- */
  const CAPS = ['text', 'transcribe', 'tts', 'image'];
  const CAP_SHORT = {text: '文本', transcribe: '识别', tts: '合成', image: '生图'};
  const CAP_LABEL = {text: '文本生成', transcribe: '语音识别', tts: '语音合成', image: '图像生成'};
  /* 旧原型的模型 kind（工具页、面板仍按它读）与设置左栏的项 */
  const KIND = {text: 'llm', transcribe: 'stt', tts: 'tts', image: 'image'};
  const CAP_OF_KIND = {llm: 'text', stt: 'transcribe', tts: 'tts', image: 'image'};
  const NAV = {text: 'llm', transcribe: 'asr', tts: 'tts', image: 'image'};
  const CAP_OF_NAV = {llm: 'text', asr: 'transcribe', tts: 'tts', image: 'image'};

  const m = (id, desc, o) => Object.assign({id, desc: desc || ''}, o || {});
  const R = (global, cn) => [{k: 'global', label: '国际', base: global}, {k: 'cn', label: '中国', base: cn}];

  /* ---------- 目录（共享简报 §3 是唯一事实源；id 不再漂） ----------
     caps：目录声明的能力；p1：其中 Runtime 本轮还没接的（规格里标 P1，原型照目标设计展示）；
     beyond：原型旧种子里已有、目录表没写的能力（保留模型，交付说明里列出由规格裁决）。
     icon：assets/vendors/<id>.svg，mono = 单色（跟主题着色），false = 彩色原样；null 用首字母头像。
     models 只写文本与识别；合成、生图从各自的表按 id 读（见 modelsOf）。模型 id 以各家官方模型页为准。 */
  const VENDORS = [
    {id: 'openai', name: 'OpenAI', kind: 'vendor', caps: ['text', 'transcribe', 'tts', 'image'], p1: [], beyond: [],
     base: 'https://api.openai.com/v1', auth: 'Bearer', site: 'https://platform.openai.com', icon: {mono: true}, balance: false,
     models: {
       text: [m('gpt-6.1-sol', '旗舰'), m('gpt-6-luna', '更快 · 更便宜'), m('gpt-6-sol', '上一代', {prev: true})],
       transcribe: [m('gpt-4o-transcribe', '质量最好'), m('gpt-4o-mini-transcribe', '更便宜'), m('whisper-1', '上一代', {prev: true})],
     }},
    {id: 'anthropic', name: 'Anthropic', kind: 'vendor', caps: ['text'], p1: [], beyond: [],
     base: 'https://api.anthropic.com', auth: 'x-api-key', site: 'https://console.anthropic.com', icon: {mono: true}, balance: false,
     models: {text: [m('claude-opus-5-5', '旗舰'), m('claude-sonnet-5-5', '均衡'), m('claude-haiku-4-5', '最快'), m('claude-fable-5-1', '最强 · 最贵')]}},
    {id: 'google', name: 'Google Gemini', kind: 'vendor', caps: ['text', 'transcribe', 'image'], p1: [], beyond: ['tts'],
     base: 'https://generativelanguage.googleapis.com/v1beta', auth: 'x-goog-api-key', site: 'https://aistudio.google.com', icon: {mono: false}, balance: false,
     models: {
       text: [m('gemini-3.8-flash', '当前一代'), m('gemini-3.5-flash-lite', '更快 · 更便宜')],
       transcribe: [m('gemini-3.5-transcribe', '带时间戳与语种')],
     }},
    {id: 'elevenlabs', name: 'ElevenLabs', kind: 'vendor', caps: ['tts'], p1: [], beyond: ['transcribe'],
     base: 'https://api.elevenlabs.io/v1', auth: 'xi-api-key', site: 'https://elevenlabs.io', icon: {mono: true}, balance: false,
     models: {transcribe: [m('scribe_v2', '自带说话人区分'), m('scribe_v1', '上一代', {prev: true})]}},
    {id: 'deepseek', name: 'DeepSeek', kind: 'vendor', caps: ['text'], p1: [], beyond: [],
     base: 'https://api.deepseek.com/v1', auth: 'Bearer', site: 'https://platform.deepseek.com', icon: {mono: false}, balance: true,
     models: {text: [m('deepseek-v4-flash', '快'), m('deepseek-v4-pro', '推理更强')]}},
    {id: 'moonshot', name: 'Kimi（Moonshot）', kind: 'vendor', caps: ['text'], p1: [], beyond: [],
     base: 'https://api.moonshot.ai/v1', regions: R('https://api.moonshot.ai/v1', 'https://api.moonshot.cn/v1'),
     auth: 'Bearer', site: 'https://platform.moonshot.ai', icon: {mono: true}, balance: true,
     models: {text: [m('kimi-k2.5', '当前一代'), m('kimi-k2-turbo-preview', '更快')]}},
    {id: 'qwen', name: '阿里云百炼（Qwen）', kind: 'vendor', caps: ['text', 'tts', 'transcribe'], p1: ['tts', 'transcribe'], beyond: ['image'],
     base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
     regions: R('https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
     auth: 'Bearer', site: 'https://bailian.console.aliyun.com', icon: {mono: false}, balance: false,
     models: {
       text: [m('qwen3-max', '旗舰'), m('qwen-plus', '均衡'), m('qwen-flash', '最快')],
       transcribe: [m('qwen3-asr-flash', '多语种')],
       tts: [m('qwen3-tts-flash', '多语种 · 多方言')],
     }},
    {id: 'zhipu', name: '智谱 GLM（Z.ai）', kind: 'vendor', caps: ['text'], p1: [], beyond: ['image'],
     base: 'https://api.z.ai/api/paas/v4', regions: R('https://api.z.ai/api/paas/v4', 'https://open.bigmodel.cn/api/paas/v4'),
     auth: 'Bearer', site: 'https://z.ai', icon: {mono: false}, balance: false,
     models: {text: [m('glm-5', '旗舰'), m('glm-4.7', '上一代', {prev: true}), m('glm-4.5-air', '更快')]}},
    {id: 'minimax', name: 'MiniMax', kind: 'vendor', caps: ['text', 'tts'], p1: ['tts'], beyond: ['image'],
     base: 'https://api.minimax.io/v1', regions: R('https://api.minimax.io/v1', 'https://api.minimaxi.com/v1'),
     auth: 'Bearer', site: 'https://platform.minimax.io', icon: {mono: false}, balance: false,
     models: {text: [m('MiniMax-M2.5', '当前一代'), m('MiniMax-M2.1', '上一代', {prev: true})]}},
    {id: 'volcengine', name: '火山引擎（豆包）', kind: 'vendor', caps: ['text', 'tts', 'image'], p1: ['tts', 'image'], beyond: ['transcribe'],
     base: 'https://ark.cn-beijing.volces.com/api/v3', auth: 'Bearer', site: 'https://console.volcengine.com/ark', icon: {mono: false}, balance: false,
     models: {
       text: [m('doubao-seed-1-6-250615', '深度思考'), m('doubao-seed-1-6-flash-250828', '更快')],
       transcribe: [m('bigmodel-asr', '自带说话人区分'), m('bigmodel-asr-flash', '更快')],
       tts: [m('seed-tts-1.0', '豆包语音合成')],
     }},
    {id: 'xai', name: 'xAI（Grok）', kind: 'vendor', caps: ['text', 'image'], p1: ['image'], beyond: [],
     base: 'https://api.x.ai/v1', auth: 'Bearer', site: 'https://console.x.ai', icon: {mono: true}, balance: false,
     models: {text: [m('grok-4', '旗舰'), m('grok-4-fast-reasoning', '更快')]}},
    {id: 'mistral', name: 'Mistral', kind: 'vendor', caps: ['text'], p1: [], beyond: [],
     base: 'https://api.mistral.ai/v1', auth: 'Bearer', site: 'https://console.mistral.ai', icon: {mono: false}, balance: false,
     models: {text: [m('mistral-large-latest', '旗舰'), m('mistral-medium-latest', '均衡'), m('mistral-small-latest', '最快')]}},
    {id: 'groq', name: 'Groq', kind: 'vendor', caps: ['text', 'transcribe'], p1: ['transcribe'], beyond: [],
     base: 'https://api.groq.com/openai/v1', auth: 'Bearer', site: 'https://console.groq.com', icon: {mono: true}, balance: false,
     models: {
       text: [m('openai/gpt-oss-120b', '开放权重'), m('llama-3.3-70b-versatile', '通用')],
       transcribe: [m('whisper-large-v3-turbo', '最快'), m('whisper-large-v3', '更准')],
     }},
    {id: 'openrouter', name: 'OpenRouter', kind: 'relay', caps: ['text'], p1: [], beyond: ['image'],
     base: 'https://openrouter.ai/api/v1', auth: 'Bearer', site: 'https://openrouter.ai', icon: {mono: true}, balance: true,
     models: {text: [m('openrouter/auto', '按提示自动挑模型'), m('openai/gpt-oss-120b', '开放权重')]}},
    {id: 'siliconflow', name: '硅基流动（SiliconFlow）', kind: 'relay', caps: ['text', 'tts', 'transcribe'], p1: ['tts', 'transcribe'], beyond: [],
     base: 'https://api.siliconflow.cn/v1', auth: 'Bearer', site: 'https://cloud.siliconflow.cn', icon: {mono: false}, balance: false,
     models: {
       text: [m('deepseek-ai/DeepSeek-V3.2', '开放权重'), m('Qwen/Qwen3-235B-A22B-Instruct-2507', '开放权重')],
       transcribe: [m('FunAudioLLM/SenseVoiceSmall', '多语种')],
       tts: [m('FunAudioLLM/CosyVoice2-0.5B', '多语种 · 可克隆')],
     }},
    /* 智能体 Provider（product-design §6.9）：不在 API 提供方页列，只在图像生成的默认选择器里出现 */
    {id: 'agent:codex', name: 'Codex', kind: 'agent', caps: ['image'], p1: [], beyond: [], base: '', auth: 'none', icon: {mono: false, file: 'codex'}, balance: false, models: {}},
  ];
  const byId = (id) => VENDORS.find((v) => v.id === id) || null;
  /** 某家某能力实际可用的全部能力（目录声明 + 旧种子保留） */
  const capsOf = (v) => (v ? CAPS.filter((c) => v.caps.indexOf(c) >= 0 || (v.beyond || []).indexOf(c) >= 0) : []);

  /* ---------- 解析：内置 + 自建（store 的 providerSettings[id].custom） ---------- */
  function resolve(id, settings) {
    const s = settings && settings[id];
    if (s && s.custom) {
      return {id, name: s.custom.name, kind: 'custom', caps: s.custom.caps.slice(), p1: [], beyond: [], base: s.custom.base,
        auth: 'Bearer', site: null, icon: null, balance: false, models: {}};
    }
    return byId(id);
  }

  /** 某家某能力的模型：内置表（合成 / 生图读各自的表）+ 用户添加 / 刷新得到的 id。{id, desc, prev, added} */
  function modelsOf(id, cap, settings) {
    const v = resolve(id, settings);
    if (!v) return [];
    let list = [];
    if (cap === 'tts' && TTS()) {
      const p = TTS().PROVIDERS.find((x) => x.id === id);
      list = p ? p.models.map((x) => m(x.id, x.desc, {prev: !!x.prev})) : [];
    } else if (cap === 'image' && IMG()) {
      const p = IMG().PROVIDERS.find((x) => x.id === id);
      list = p ? p.models.map((x) => m(x.id, x.desc, {prev: !!x.prev})) : [];
    }
    if (!list.length && v.models && v.models[cap]) list = v.models[cap].slice();
    const s = settings && settings[id];
    const extra = (s && s.models && s.models[cap]) || [];
    extra.forEach((x) => { if (!list.some((y) => y.id === x)) list.push(m(x, '', {added: true})); });
    return list;
  }
  const modelCount = (id, settings) => capsOf(resolve(id, settings)).reduce((n, c) => n + modelsOf(id, c, settings).length, 0);

  /* ---------- 密钥与账号 ---------- */
  /** 掩码：前 3 + … + 后 4；8 位及以下全 •。密钥写入时算好存下，永不回显 */
  function mask(key) {
    const k = String(key || '').trim();
    if (!k) return '';
    if (k.length <= 8) return '•'.repeat(k.length);
    return k.slice(0, 3) + '…' + k.slice(-4);
  }
  const usable = (a) => !!a && a.enabled !== false && !!a.masked;
  /** 生效的账号：第一个启用且有密钥的（不自动跳过限速 / 失效的，架构 §6.2：不自动回退） */
  const primaryAccount = (accounts) => (accounts || []).find(usable) || null;
  /** 按给定顺序重排（order 里没有的接在后面，保持原相对顺序） */
  function arrange(accounts, order) {
    const list = (accounts || []).slice();
    const pos = (a) => { const i = (order || []).indexOf(a.accountId); return i < 0 ? order.length + list.indexOf(a) : i; };
    return list.sort((a, b) => pos(a) - pos(b));
  }
  /** 设为首选 = 挪到最前 */
  const makePrimary = (accounts, id) => arrange(accounts, [id]);
  /** 上移 / 下移一位（键盘可达的调序） */
  function move(accounts, id, delta) {
    const list = (accounts || []).slice();
    const i = list.findIndex((a) => a.accountId === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return list;
    const [x] = list.splice(i, 1);
    list.splice(j, 0, x);
    return list;
  }
  const accountName = (a) => (a.label && a.label.trim()) || a.masked || '未命名账号';
  /** 新账号的短 id：头一个叫 main，其余随机 */
  const newAccountId = (accounts, rand) => (!(accounts || []).length ? 'main' : 'a' + Math.floor((rand == null ? Math.random() : rand) * 0xffffff).toString(36));
  function makeAccount(o, accounts, now) {
    return {accountId: newAccountId(accounts), label: (o.label || '').trim() || null, masked: mask(o.key), enabled: true,
      region: o.region || undefined, endpoint: String(o.endpoint || '').trim() || undefined, addedAt: new Date(now).toISOString(), status: {state: o.state || 'ok', at: new Date(now).toISOString()}};
  }

  const hm = (iso) => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  /** 账号状态徽标：{label, tone}。限速过了恢复时间就当正常 */
  function statusOf(a, now) {
    if (!a) return {label: '', tone: 'neutral'};
    if (a.enabled === false) return {label: '已停用', tone: 'neutral'};
    const s = a.status || {state: 'unknown'};
    if (s.state === 'invalid-key') return {label: '密钥无效', tone: 'negative'};
    if (s.state === 'quota-exhausted') return {label: '额度用尽', tone: 'negative'};
    if (s.state === 'rate-limited') {
      if (s.until && new Date(s.until).getTime() <= now) return {label: '正常', tone: 'positive'};
      return {label: s.until ? `限速 · ${hm(s.until)} 恢复` : '限速', tone: 'notice'};
    }
    if (s.state === 'ok') return {label: '正常', tone: 'positive'};
    return {label: '未验证', tone: 'neutral'};
  }
  /** 列表右侧的账号摘要：一个账号给掩码（或名字），多个给「N 个账号」 */
  function accountSummary(accounts) {
    const list = accounts || [];
    if (!list.length) return '未添加账号';
    if (list.length === 1) return list[0].masked || accountName(list[0]);
    return `${list.length} 个账号`;
  }
  /** 这家此刻的状态：off 停用 / missing 没有能用的账号 / warn 首选账号上次出错 / ok */
  function stateOf(id, settings, accountsMap, now) {
    const s = (settings || {})[id];
    if (s && s.enabled === false) return {k: 'off', label: '已停用', tone: 'neutral'};
    const p = primaryAccount((accountsMap || {})[id]);
    if (!p) return {k: 'missing', label: (accountsMap || {})[id] && accountsMap[id].length ? '账号都已停用' : '未添加账号', tone: 'neutral'};
    const st = statusOf(p, now);
    if (st.tone === 'negative' || st.tone === 'notice') return {k: 'warn', label: st.label, tone: st.tone};
    return {k: 'ok', label: '已连接', tone: 'positive'};
  }
  /** 已连接 = 启用且有一个启用带密钥的账号（与 Runtime credential: 'set' 同义）。store 的 cloudSaved 由它推出 */
  const connected = (id, settings, accountsMap) => !((settings || {})[id] && settings[id].enabled === false) && !!primaryAccount((accountsMap || {})[id]);
  const connectedIds = (settings, accountsMap) => Object.keys(settings || {}).filter((id) => connected(id, settings, accountsMap));

  /* ---------- 列表与副行 ---------- */
  const hostOf = (url) => String(url || '').replace(/^[a-z]+:\/\//i, '').split('/')[0];
  const baseOf = (id, settings) => {
    const v = resolve(id, settings);
    const s = (settings || {})[id] || {};
    if (s.endpoint) return s.endpoint;
    if (v && v.regions && s.region) return (v.regions.find((r) => r.k === s.region) || v.regions[0]).base;
    return v ? v.base : '';
  };
  /** 这个账号实际用的基址（架构设计 §6.8：账号的 endpoint 优先于提供方级与目录预设）：
      账号 endpoint → 提供方级 endpoint（旧设置，界面不再写）→ 账号的地区基址 → 提供方的地区基址 / 目录基址。空串当没有 */
  function accountBase(id, account, settings) {
    const a = account || {};
    const own = String(a.endpoint || '').trim();
    if (own) return own;
    const v = resolve(id, settings);
    const s = (settings || {})[id] || {};
    if (!s.endpoint && v && v.regions && a.region) return (v.regions.find((r) => r.k === a.region) || v.regions[0]).base;
    return baseOf(id, settings);
  }
  /** 「api.openai.com · 12 个模型 · 文本 / 识别 / 合成 / 生图」 */
  function subline(id, settings) {
    const v = resolve(id, settings);
    return [hostOf(baseOf(id, settings)), `${modelCount(id, settings)} 个模型`, capsOf(v).map((c) => CAP_SHORT[c]).join(' / ')].filter(Boolean).join(' · ');
  }
  /** API 提供方页列表：已添加的那些，已连接排前，其次按目录顺序（自建排最后） */
  function list(settings, accountsMap, now) {
    const order = (id) => { const i = VENDORS.findIndex((v) => v.id === id); return i < 0 ? 999 : i; };
    return Object.keys(settings || {}).filter((id) => resolve(id, settings) && resolve(id, settings).kind !== 'agent')
      .map((id) => ({id, vendor: resolve(id, settings), state: stateOf(id, settings, accountsMap, now),
        summary: accountSummary((accountsMap || {})[id]), single: ((accountsMap || {})[id] || []).length === 1, sub: subline(id, settings)}))
      .sort((a, b) => Number(b.state.k === 'ok' || b.state.k === 'warn') - Number(a.state.k === 'ok' || a.state.k === 'warn') || order(a.id) - order(b.id));
  }
  /** 「自建端点 · OpenAI 兼容」那张卡命中没有：空查询总在；openai / 兼容 / 自建 / custom / 端点 等词命中（任一方向包含） */
  const CUSTOM_TERMS = ['自建端点', 'openai 兼容', 'openai', '兼容', '自建', 'custom', 'compatible', '端点', 'endpoint'];
  function customHit(query) {
    const q = String(query || '').trim().toLowerCase();
    return !q || CUSTOM_TERMS.some((t) => t.indexOf(q) >= 0 || q.indexOf(t) >= 0);
  }
  /** 添加 API 提供方 sheet：按名字 / id 搜，分模型厂商与中转平台；已添加的标出来；custom = 自建端点卡是否命中 */
  function catalog(query, settings) {
    const q = String(query || '').trim().toLowerCase();
    const hit = (v) => !q || [v.id, v.name, ...capsOf(v).map((c) => CAP_LABEL[c])].join(' ').toLowerCase().indexOf(q) >= 0;
    const row = (v) => ({vendor: v, added: !!(settings || {})[v.id], caps: capsOf(v)});
    return {
      vendors: VENDORS.filter((v) => v.kind === 'vendor' && hit(v)).map(row),
      relays: VENDORS.filter((v) => v.kind === 'relay' && hit(v)).map(row),
      custom: customHit(q),
    };
  }

  /* ---------- 自建端点 ---------- */
  const normUrl = (u) => String(u || '').trim().replace(/\/+$/, '').toLowerCase();
  const validBase = (u) => /^https?:\/\/[^\s/]+/.test(String(u || '').trim());
  function slug(name) {
    const s = String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s || 'endpoint';
  }
  /** custom:<slug>，撞名时加序号 */
  function customId(name, settings) {
    const base = 'custom:' + slug(name);
    let id = base;
    for (let i = 2; (settings || {})[id]; i += 1) id = base + '-' + i;
    return id;
  }
  /** 基址撞上已有的一家（内置按当前生效基址比，自建按填的基址比）：提示「添加到「X」」 */
  function findByBase(url, settings) {
    const u = normUrl(url);
    if (!u) return null;
    const id = Object.keys(settings || {}).find((k) => normUrl(baseOf(k, settings)) === u);
    return id ? resolve(id, settings) : null;
  }

  /* ---------- 能力页 ---------- */
  /** 目录里有、Runtime 还没接的能力（架构设计 §6.4 标 P1）：详情里列出并标「尚未接入」，不能测试、不能设为默认，能力页不出现 */
  const isP1 = (id, cap, settings) => { const v = resolve(id, settings); return !!v && (v.p1 || []).indexOf(cap) >= 0; };
  /** 某能力下已添加的 API 提供方与它们的模型：{vendor, ready, why, models}；没连上的写原因。P1 能力不在其中 */
  function choices(cap, settings, accountsMap, now) {
    return list(settings, accountsMap, now).filter((r) => capsOf(r.vendor).indexOf(cap) >= 0 && !isP1(r.id, cap, settings))
      .map((r) => ({vendor: r.vendor, ready: r.state.k === 'ok' || r.state.k === 'warn',
        why: r.state.k === 'ok' || r.state.k === 'warn' ? '' : r.state.label, state: r.state,
        models: modelsOf(r.id, cap, settings)}));
  }
  /** 能力页第 ④ 节：目录里有这种能力的全部 API 提供方（不含智能体、不含该能力标 P1 的）+ 声明了这种能力的自建端点，
      没添加的也列（能力页从这里去配置）。排序：已连接 → 已添加但没有能用的账号（含停用）→ 未添加；同档按目录顺序，自建最后。
      query 按名字 / id / 模型 id 匹配，命中的整组返回。[{vendor, id, added, state, ready, models, kind}] */
  function capCatalog(cap, settings, accountsMap, now, query) {
    const s = settings || {};
    const q = String(query || '').trim().toLowerCase();
    const ids = VENDORS.filter((v) => v.kind !== 'agent').map((v) => v.id).concat(Object.keys(s).filter((id) => s[id] && s[id].custom));
    const order = (id) => { const i = VENDORS.findIndex((v) => v.id === id); return i < 0 ? 999 : i; };
    const tier = (r) => (r.ready ? 0 : r.added ? 1 : 2);
    return ids.map((id) => resolve(id, s)).filter((v) => v && capsOf(v).indexOf(cap) >= 0 && !isP1(v.id, cap, s))
      .map((v) => {
        const added = !!s[v.id];
        const state = added ? stateOf(v.id, s, accountsMap, now) : {k: 'none', label: '未添加', tone: 'neutral'};
        return {vendor: v, id: v.id, added, state, ready: state.k === 'ok' || state.k === 'warn', models: modelsOf(v.id, cap, s), kind: v.kind};
      })
      .filter((r) => !q || [r.id, r.vendor.name, ...r.models.map((x) => x.id)].join(' ').toLowerCase().indexOf(q) >= 0)
      .sort((a, b) => tier(a) - tier(b) || order(a.id) - order(b.id));
  }
  /** 工具页 / 面板读的旧形状：[{id, name, custom?, models: [{id, kind}]}] */
  function legacyCatalog(settings) {
    const ids = VENDORS.filter((v) => v.kind !== 'agent').map((v) => v.id)
      .concat(Object.keys(settings || {}).filter((id) => settings[id].custom));
    return ids.map((id) => {
      const v = resolve(id, settings);
      return {id, name: v.name, custom: v.kind === 'custom', url: v.kind === 'custom' ? v.base : undefined,
        models: capsOf(v).flatMap((c) => modelsOf(id, c, settings).map((x) => ({id: x.id, kind: KIND[c], prev: !!x.prev, custom: !!x.added})))};
    });
  }

  /* ---------- 演示种子（共享简报 §2）：OpenAI 两个账号（其中一个限速）、DeepSeek、ElevenLabs、MiniMax 中国站各一个；
     Anthropic 与 Google 已添加但没有账号（迁移后「未添加账号」的样子）。 ---------- */
  function seed(now) {
    const ago = (min) => new Date(now - min * 60000).toISOString();
    const ok = (min) => ({state: 'ok', at: ago(min)});
    const settings = {
      openai: {enabled: true}, deepseek: {enabled: true}, elevenlabs: {enabled: true},
      minimax: {enabled: true, region: 'cn'}, anthropic: {enabled: true}, google: {enabled: true},
    };
    const accounts = {
      openai: [
        {accountId: 'main', label: '个人', masked: 'sk-…a3f9', enabled: true, addedAt: ago(60 * 24 * 40), lastUsedAt: ago(35), status: ok(35)},
        {accountId: 'k7q2', label: '团队', masked: 'sk-…7c21', enabled: true, addedAt: ago(60 * 24 * 12), lastUsedAt: ago(6),
         status: {state: 'rate-limited', at: ago(6), until: new Date(now + 42 * 60000).toISOString(), detail: '429 · 每分钟请求数超限'}},
      ],
      deepseek: [{accountId: 'main', label: null, masked: 'sk-…e810', enabled: true, addedAt: ago(60 * 24 * 20), lastUsedAt: ago(90), status: ok(90)}],
      elevenlabs: [{accountId: 'main', label: null, masked: 'sk_…4b2d', enabled: true, addedAt: ago(60 * 24 * 30), lastUsedAt: ago(60 * 26), status: ok(60 * 26)}],
      minimax: [{accountId: 'main', label: '中国站', masked: 'eyJ…Q9xk', enabled: true, region: 'cn', addedAt: ago(60 * 24 * 8), lastUsedAt: ago(60 * 5), status: ok(60 * 5)}],
    };
    return {settings, accounts};
  }
  /** 余额演示（P1：DeepSeek /user/balance、OpenRouter /api/v1/credits、Moonshot /v1/users/me/balance） */
  const BALANCE_DEMO = {deepseek: {amount: 86.4, currency: 'CNY'}, moonshot: {amount: 142.1, currency: 'CNY'}, openrouter: {amount: 23.75, currency: 'USD'}};

  /* 编码 Agent 的图标（product-design §3.2.3）：harness id → assets/vendors 的文件。与 packages/ui model/agent-choice.ts
     `AGENT_ICON_FILES` 是同一张表；用户添加的（`added`）与表里没有的返回 null，画首字母头像。 */
  const AGENT_ICONS = {
    claude: {file: 'anthropic', mono: true}, codex: {file: 'codex', mono: false}, copilot: {file: 'githubcopilot', mono: true},
    pi: {file: 'pi', mono: true}, opencode: {file: 'opencode', mono: true}, gemini: {file: 'google', mono: false},
    cursor: {file: 'cursor', mono: true}, grok: {file: 'xai', mono: true}, kimi: {file: 'moonshot', mono: true},
  };
  function agentIcon(h) {
    if (!h || h.added) return null;
    return AGENT_ICONS[h.id] || null;
  }

  const BC_VENDORS = {
    AGENT_ICONS, agentIcon,
    CAPS, CAP_SHORT, CAP_LABEL, KIND, CAP_OF_KIND, NAV, CAP_OF_NAV, VENDORS, BALANCE_DEMO,
    byId, resolve, capsOf, modelsOf, modelCount,
    mask, usable, primaryAccount, arrange, makePrimary, move, accountName, makeAccount, statusOf, accountSummary,
    stateOf, connected, connectedIds, hostOf, baseOf, accountBase, subline, list, catalog, customHit,
    normUrl, validBase, slug, customId, findByBase, isP1, choices, capCatalog, legacyCatalog, seed,
  };
  if (typeof window !== 'undefined') Object.assign(window, {BC_VENDORS});
  if (typeof module !== 'undefined' && module.exports) module.exports = BC_VENDORS;
})();
