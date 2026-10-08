/* 云端语音合成的纯模型 —— docs/design/speech/bcut-cloud-tts-design.md（2026-09-24，原型先行）。
   设置 › 模型 › 云端模型多一档「语音合成 · TTS」：第一批 MiniMax / OpenAI / ElevenLabs，用户也能添加任何
   OpenAI-compatible 的 `/v1/audio/speech` 服务；2026-09-25 加第四家 Google Gemini（`generateContent` 出音频，
   30 只内置音色、风格指令写成一句话、没有数值语速、不接克隆，设计稿 §5.6 / §12.9）。这里放：四家的种子表（模型、能力、音色目录、默认音色、
   字数上限、语速区间）、`cloud:<provider>/<model>` 的拼与拆、把已连接的 API 提供方折成 model-tts.js 认的
   「引擎」对象、「我的声音」在某家的克隆状态（上传 / 首次用时上传 / 参考不足 / 许可未说明 / 不能克隆）、
   共享选择器在云端引擎下的分组、费用一句、页顶 chip。真相将来在 `bcut_tts::cloud`（能力表）与
   `bcut-kernel/services/cloud_tts.rs`（请求映射），这里照设计稿 §3–§6 抄。只算，不画。 */
(function () {
  const CATALOG = (typeof window !== 'undefined' && window.BC_LANGUAGES)
    || (typeof require === 'function' ? require('./model-languages.js') : null);
  const native = (code) => (CATALOG ? CATALOG.native(code) : code);
  const PREFIX = 'cloud:';

  /* ---------- 语言 ---------- */
  /** 「多语言」引擎的 Picker 只列这 12 种常用的，其余在「更多…」后面 */
  const COMMON_LANGS = ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'es', 'it', 'pt', 'ru', 'ar', 'hi'];
  const ELEVEN_V2 = ['en', 'ja', 'zh', 'de', 'hi', 'fr', 'ko', 'pt', 'it', 'es', 'id', 'nl', 'tr', 'fil', 'pl', 'sv', 'bg', 'ro', 'ar', 'cs', 'el', 'fi', 'hr', 'ms', 'sk', 'da', 'ta', 'uk', 'ru'];
  const ELEVEN_FLASH = ELEVEN_V2.concat(['hu', 'no', 'vi']);
  /* MiniMax `language_boost` 的枚举折成主码；`yue` 是「Chinese,Yue」 */
  const MINIMAX_LANGS = ['zh', 'yue', 'en', 'ja', 'ko', 'de', 'fr', 'es', 'it', 'pt', 'ru', 'ar', 'hi', 'tr', 'nl', 'uk', 'vi', 'id', 'th', 'pl', 'ro', 'el', 'cs', 'fi', 'bg', 'da', 'he', 'ms', 'fa', 'sk', 'sv', 'hr', 'fil', 'hu', 'no', 'sl', 'ca', 'nn', 'ta', 'af'];
  const MINIMAX_BOOST = {zh: 'Chinese', yue: 'Chinese,Yue', en: 'English', ja: 'Japanese', ko: 'Korean', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish', nl: 'Dutch', uk: 'Ukrainian', vi: 'Vietnamese', id: 'Indonesian', th: 'Thai', pl: 'Polish', ro: 'Romanian', el: 'Greek', cs: 'Czech', fi: 'Finnish', bg: 'Bulgarian', da: 'Danish', he: 'Hebrew', ms: 'Malay', fa: 'Persian', sk: 'Slovak', sv: 'Swedish', hr: 'Croatian', fil: 'Filipino', hu: 'Hungarian', no: 'Norwegian', sl: 'Slovenian', ca: 'Catalan', nn: 'Nynorsk', ta: 'Tamil', af: 'Afrikaans'};

  /* ---------- API 提供方种子表（设计稿 §3.3 / §4） ----------
     `api`：线上形状——`openai`（也是所有自建 API 提供方的形状）/ `elevenlabs` / `minimax` / `gemini`。
     `clone`：能不能拿参考段建克隆；OpenAI 的自定义音色要「本人朗读同意短语 + 商务开通」、Gemini 的声音复刻要同一人
     再念一句固定同意语，第一批都不接（null）。
     `speed / pitch / volume / sliders / emotions`：各家收的旋钮；不收的就没有那一行（Gemini 没有 `speed`：快慢只能写进风格）。
     `bill`：计费口径一句（缺省「按字符计费」；Gemini 按 token）。`langsTag`：卡片上的语言标签要跨模型写全时用它。
     `ownVoices`：「不能克隆」那句里「用它的 X」的 X（缺省「内置音色」）。
     `voices`：内置音色目录（OpenAI 是固定 13 只；另两家是「刷新音色」问回来的，这里是演示用的几只）。
     `defaultVoice`：按语言挑的默认音色（§3.5），`*` 是兜底。
     价格一句写稿时未核实（§12.2），落地时从官方价目抄。 */
  const PROVIDERS = [
    {id: 'openai', name: 'OpenAI', api: 'openai', rate: 24000, region: false,
     desc: '13 只内置音色；gpt-4o-mini-tts 收一句风格指令；没有克隆',
     docs: 'platform.openai.com/docs/guides/text-to-speech',
     price: '按输入字符计费 · 价目以官网为准',
     models: [
       {id: 'gpt-4o-mini-tts', desc: '收风格指令 · 音质最好', instruct: true, maxChars: 4096, langs: '*', langCount: 50},
       {id: 'tts-1-hd', desc: '高音质 · 不收风格指令', maxChars: 4096, langs: '*', langCount: 50},
       {id: 'tts-1', desc: '最快 · 不收风格指令', maxChars: 4096, langs: '*', langCount: 50},
     ],
     clone: null, speed: {min: 0.25, max: 4, step: 0.05}, sliders: [], emotions: null,
     voices: [
       {id: 'marin', name: 'marin', sub: '女声 · 自然 · 官方推荐'}, {id: 'cedar', name: 'cedar', sub: '男声 · 自然 · 官方推荐'},
       {id: 'alloy', name: 'alloy', sub: '中性 · 平稳'}, {id: 'ash', name: 'ash', sub: '男声 · 沉稳'}, {id: 'ballad', name: 'ballad', sub: '男声 · 柔和'},
       {id: 'coral', name: 'coral', sub: '女声 · 明亮'}, {id: 'echo', name: 'echo', sub: '男声 · 清晰'}, {id: 'fable', name: 'fable', sub: '中性 · 叙事'},
       {id: 'onyx', name: 'onyx', sub: '男声 · 低沉'}, {id: 'nova', name: 'nova', sub: '女声 · 轻快'}, {id: 'sage', name: 'sage', sub: '女声 · 温和'},
       {id: 'shimmer', name: 'shimmer', sub: '女声 · 柔亮'}, {id: 'verse', name: 'verse', sub: '男声 · 表现力'},
     ],
     defaultVoice: {'*': 'marin'}},
    {id: 'elevenlabs', name: 'ElevenLabs', api: 'elevenlabs', rate: 24000, region: false,
     desc: '目录里上千只音色，可即时克隆；eleven_v3 会念 70 多种语言',
     docs: 'elevenlabs.io/docs/api-reference/text-to-speech',
     price: '按字符扣套餐额度 · 免费层不许商用与克隆',
     models: [
       {id: 'eleven_v3', desc: '最富表现力 · 70+ 种语言 · 一次 5 000 字', maxChars: 5000, langs: '*', langCount: 70},
       {id: 'eleven_multilingual_v2', desc: '稳定 · 29 种语言 · 一次 10 000 字', maxChars: 10000, langs: ELEVEN_V2},
       {id: 'eleven_flash_v2_5', desc: '低延迟 · 32 种语言 · 一次 40 000 字', maxChars: 40000, langs: ELEVEN_FLASH, langCode: true},
     ],
     clone: {min: 1, max: 300, recommend: 60, how: '即时克隆（IVC）'},
     speed: {min: 0.7, max: 1.2, step: 0.05},
     sliders: [{k: 'stability', label: '稳定', sub: '低 = 更有起伏，高 = 更平稳'}, {k: 'similarity', label: '相似', sub: '与音色本人的贴近程度'}, {k: 'styleStrength', label: '风格强度', sub: '夸张程度，克隆音色慎用'}],
     emotions: null,
     voices: [
       {id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', sub: '女声 · 英语 · 叙事', lang: 'en'}, {id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', sub: '女声 · 英语 · 平稳', lang: 'en'},
       {id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', sub: '男声 · 英语 · 深沉', lang: 'en'}, {id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', sub: '男声 · 英语 · 年轻', lang: 'en'},
       {id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', sub: '男声 · 英语 · 温和', lang: 'en'}, {id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', sub: '女声 · 英语 · 年轻', lang: 'en'},
       {id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', sub: '男声 · 英语 · 有力', lang: 'en'}, {id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', sub: '男声 · 英语 · 播音', lang: 'en'},
       {id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', sub: '女声 · 英语 · 亲切', lang: 'en'}, {id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', sub: '女声 · 英语 · 讲故事', lang: 'en'},
       {id: 'zh-cn-lin', name: '林语', sub: '女声 · 中文 · 叙事', lang: 'zh'}, {id: 'zh-cn-hao', name: '子豪', sub: '男声 · 中文 · 沉稳', lang: 'zh'},
       {id: 'ja-jp-aoi', name: 'Aoi', sub: '女声 · 日语 · 明亮', lang: 'ja'}, {id: 'de-de-mia', name: 'Mia', sub: '女声 · 德语 · 平稳', lang: 'de'},
     ],
     defaultVoice: {en: 'EXAVITQu4vr4xnSDxMaL', zh: 'zh-cn-lin', ja: 'ja-jp-aoi', '*': 'EXAVITQu4vr4xnSDxMaL'}},
    {id: 'minimax', name: 'MiniMax', api: 'minimax', rate: 32000, region: true,
     desc: '几百只系统音色，可克隆；情绪、语速、音高、音量都能调；国际与中国两个接入点',
     docs: 'platform.minimax.io/docs/api-reference/speech-t2a-http',
     price: '按字符计费 · 价目以官网为准',
     models: [
       {id: 'speech-2.8-hd', desc: '当前一代 · 高音质', maxChars: 10000, langs: MINIMAX_LANGS},
       {id: 'speech-2.8-turbo', desc: '当前一代 · 更快', maxChars: 10000, langs: MINIMAX_LANGS},
       {id: 'speech-2.6-hd', desc: '上一代 · 高音质', maxChars: 10000, langs: MINIMAX_LANGS, prev: true},
       {id: 'speech-2.6-turbo', desc: '上一代 · 更快', maxChars: 10000, langs: MINIMAX_LANGS, prev: true},
     ],
     clone: {min: 10, max: 300, maxMb: 20, expiresDays: 7, how: 'voice_clone'},
     speed: {min: 0.5, max: 2, step: 0.05}, pitch: {min: -12, max: 12}, volume: {min: 0, max: 10}, sliders: [],
     emotions: [{id: 'happy', name: '开心'}, {id: 'sad', name: '难过'}, {id: 'angry', name: '生气'}, {id: 'fearful', name: '害怕'}, {id: 'disgusted', name: '厌恶'}, {id: 'surprised', name: '惊讶'}, {id: 'calm', name: '平静'}, {id: 'fluent', name: '流畅'}, {id: 'whisper', name: '耳语'}],
     voices: [
       {id: 'Chinese (Mandarin)_Warm_Girl', name: '温暖女声', sub: '女声 · 中文 · 温暖', lang: 'zh'}, {id: 'Chinese (Mandarin)_Gentleman', name: '儒雅男声', sub: '男声 · 中文 · 沉稳', lang: 'zh'},
       {id: 'Chinese (Mandarin)_News_Anchor', name: '新闻主播', sub: '男声 · 中文 · 播音', lang: 'zh'}, {id: 'Chinese (Mandarin)_Lyrical_Voice', name: '抒情女声', sub: '女声 · 中文 · 柔和', lang: 'zh'},
       {id: 'Cantonese_GentleLady', name: '粤语淑女', sub: '女声 · 粤语 · 温柔', lang: 'yue'},
       {id: 'English_Graceful_Lady', name: 'Graceful Lady', sub: '女声 · 英语 · 优雅', lang: 'en'}, {id: 'English_Trustworthy_Man', name: 'Trustworthy Man', sub: '男声 · 英语 · 可靠', lang: 'en'},
       {id: 'English_Magnetic_Male', name: 'Magnetic Male', sub: '男声 · 英语 · 磁性', lang: 'en'},
       {id: 'Japanese_Whisper_Belle', name: 'Whisper Belle', sub: '女声 · 日语 · 轻柔', lang: 'ja'}, {id: 'Korean_Sweet_Girl', name: 'Sweet Girl', sub: '女声 · 韩语 · 甜美', lang: 'ko'},
       {id: 'Spanish_Narrator', name: 'Narrator', sub: '男声 · 西班牙语 · 叙事', lang: 'es'}, {id: 'German_Friendly_Man', name: 'Friendly Man', sub: '男声 · 德语 · 亲切', lang: 'de'},
       {id: 'French_Female_News', name: 'Female News', sub: '女声 · 法语 · 播音', lang: 'fr'},
     ],
     defaultVoice: {zh: 'Chinese (Mandarin)_Warm_Girl', yue: 'Cantonese_GentleLady', en: 'English_Graceful_Lady', ja: 'Japanese_Whisper_Belle', ko: 'Korean_Sweet_Girl', '*': 'English_Graceful_Lady'}},
    /* Google Gemini（2026-09-25，设计稿 §5.6 / §12.9）：文本模型早就在这家下面，密钥共用；语音只是多两只 `kind: tts` 的模型。
       30 只内置音色都是多语言、官方只给一个风格词（没标性别，这里不编）；「刷新音色」问 `GET /v1beta/voices` 拿扩展音色库与
       你在 AI Studio 建的自定义音色。语言自动识别（官方模型页：3.8 Flash 130 种、Flash-Lite 101 种）。 */
    {id: 'google', name: 'Google Gemini', api: 'gemini', rate: 24000, region: false,
     desc: '30 只内置音色，风格指令写成一句话，会念 130 种语言；不能克隆',
     docs: 'ai.google.dev/gemini-api/docs/speech-generation',
     price: '按 token 计费 · 3.8 Flash 约 $0.00225 / 10 秒、Flash-Lite 约 $0.0015 / 10 秒 · 2027-01-01 起翻倍',
     bill: '按 token 计费', langsTag: '130 种语言（Flash-Lite 101）', ownVoices: '它的音色目录（含你在 AI Studio 建的）',
     models: [
       {id: 'gemini-3.8-flash-tts', desc: '旗舰 · 收风格指令 · 130 种语言', instruct: true, maxChars: 4096, langs: '*', langCount: 130, langExact: true},
       {id: 'gemini-3.8-flash-lite-tts', desc: '更快更便宜 · 收风格指令 · 101 种语言', instruct: true, maxChars: 4096, langs: '*', langCount: 101, langExact: true},
     ],
     clone: null, sliders: [], emotions: null,
     voices: [
       {id: 'Zephyr', name: 'Zephyr', sub: '明亮 · 多语言'}, {id: 'Puck', name: 'Puck', sub: '欢快 · 多语言'}, {id: 'Charon', name: 'Charon', sub: '知性 · 多语言'},
       {id: 'Kore', name: 'Kore', sub: '坚定 · 多语言'}, {id: 'Fenrir', name: 'Fenrir', sub: '激昂 · 多语言'}, {id: 'Leda', name: 'Leda', sub: '年轻 · 多语言'},
       {id: 'Orus', name: 'Orus', sub: '坚定 · 多语言'}, {id: 'Aoede', name: 'Aoede', sub: '轻快 · 多语言'}, {id: 'Callirrhoe', name: 'Callirrhoe', sub: '随和 · 多语言'},
       {id: 'Autonoe', name: 'Autonoe', sub: '明亮 · 多语言'}, {id: 'Enceladus', name: 'Enceladus', sub: '气声 · 多语言'}, {id: 'Iapetus', name: 'Iapetus', sub: '清晰 · 多语言'},
       {id: 'Umbriel', name: 'Umbriel', sub: '随和 · 多语言'}, {id: 'Algieba', name: 'Algieba', sub: '圆润 · 多语言'}, {id: 'Despina', name: 'Despina', sub: '圆润 · 多语言'},
       {id: 'Erinome', name: 'Erinome', sub: '清晰 · 多语言'}, {id: 'Algenib', name: 'Algenib', sub: '沙哑 · 多语言'}, {id: 'Rasalgethi', name: 'Rasalgethi', sub: '知性 · 多语言'},
       {id: 'Laomedeia', name: 'Laomedeia', sub: '欢快 · 多语言'}, {id: 'Achernar', name: 'Achernar', sub: '柔和 · 多语言'}, {id: 'Alnilam', name: 'Alnilam', sub: '坚定 · 多语言'},
       {id: 'Schedar', name: 'Schedar', sub: '平稳 · 多语言'}, {id: 'Gacrux', name: 'Gacrux', sub: '成熟 · 多语言'}, {id: 'Pulcherrima', name: 'Pulcherrima', sub: '直率 · 多语言'},
       {id: 'Achird', name: 'Achird', sub: '友善 · 多语言'}, {id: 'Zubenelgenubi', name: 'Zubenelgenubi', sub: '随意 · 多语言'}, {id: 'Vindemiatrix', name: 'Vindemiatrix', sub: '温柔 · 多语言'},
       {id: 'Sadachbia', name: 'Sadachbia', sub: '活泼 · 多语言'}, {id: 'Sadaltager', name: 'Sadaltager', sub: '博学 · 多语言'}, {id: 'Sulafat', name: 'Sulafat', sub: '温暖 · 多语言'},
     ],
     defaultVoice: {'*': 'Kore'}},
  ];
  /** 演示里已连上账号的 API 提供方（product-design §7.6）；真正的种子是 model-vendors.js 的 SEED_ACCOUNTS，store 从账号推出已连接集合 */
  const SEED_SAVED = ['openai', 'deepseek', 'elevenlabs', 'minimax'];
  /** MiniMax 两个接入点（§3.4）：换接入点 = 换服务器，测试结论与音色目录都作废 */
  const REGIONS = [{k: 'global', label: '国际', host: 'api.minimax.io'}, {k: 'cn', label: '中国', host: 'api.minimaxi.com'}];

  /* ---------- id ---------- */
  const isCloud = (engineOrModel) => String(engineOrModel || '').indexOf(PREFIX) === 0;
  const engineId = (provider) => PREFIX + provider;
  const modelId = (provider, model) => `${PREFIX}${provider}/${model}`;
  /** `cloud:<provider>/<model>` → {provider, model}；只到 `cloud:<provider>` 也认（model 为空） */
  function parse(id) {
    if (!isCloud(id)) return null;
    const rest = String(id).slice(PREFIX.length);
    const i = rest.indexOf('/');
    return i < 0 ? {provider: rest, model: ''} : {provider: rest.slice(0, i), model: rest.slice(i + 1)};
  }
  const providerOf = (id) => { const p = parse(id); return p ? p.provider : null; };

  /* ---------- 目录：内置四家 + 用户自建 ---------- */
  /** 自建 API 提供方（设置页「添加自建 API 提供方」选了 TTS）：OpenAI-compatible 形状，音色是用户填的一串 id，
   *  没填就由对方缺省；`GET /v1/voices` 有就用。能力按 OpenAI 的保守值。 */
  /* 自建 API 提供方登记表：`customProvider` 折出来的每一只都记在这里，所以只拿着 `cloud:<id>` 的调用方
     （引擎卡、语言表、字数上限、记录……）不必把 store 里的自建列表一路传下来也能认出它；`extra` 仍然
     优先（同 id 以 extra 的为准），给测试与将来「改过的自建」用。 */
  const CUSTOM = new Map();
  function customProvider(o) {
    const voices = String(o.voices || '').split(/[,\s，]+/).map((s) => s.trim()).filter(Boolean)
      .map((id) => ({id, name: id, sub: '自建 · 手填'}));
    const p = {id: o.id, name: o.name, api: 'openai', custom: true, rate: 24000, region: false, url: o.url,
      desc: `OpenAI-compatible · ${o.url || ''}`, price: '按对方的规矩计费',
      models: (o.models || []).map((m) => ({id: m, desc: '自建', maxChars: 4096, langs: '*', langCount: 12, instruct: true})),
      clone: {min: 3, max: 30, how: '参考音频内联（BaoCut 自家形状）'}, speed: {min: 0.5, max: 2, step: 0.05}, sliders: [], emotions: null,
      voices, defaultVoice: voices.length ? {'*': voices[0].id} : {}};
    CUSTOM.set(p.id, p);
    return p;
  }
  /** 全部 API 提供方：内置四家 + 登记过的自建 + `extra`（自建，已折成 customProvider 的形状；同 id 以 extra 为准） */
  function providers(extra) {
    const out = PROVIDERS.slice();
    const seen = new Set(out.map((p) => p.id));
    (extra || []).concat([...CUSTOM.values()]).forEach((p) => { if (!seen.has(p.id)) { seen.add(p.id); out.push(p); } });
    return out;
  }
  const providerById = (id, extra) => providers(extra).find((p) => p.id === id) || null;
  const modelOf = (provider, model) => provider ? (provider.models.find((m) => m.id === model) || provider.models[0]) : null;

  /* ---------- 能力（设计稿 §4）：按 (API 提供方, 模型) 算 ---------- */
  function capabilities(provider, model) {
    const p = typeof provider === 'string' ? providerById(provider) : provider;
    if (!p) return null;
    const m = modelOf(p, model);
    return {
      provider: p.id, model: m.id, api: p.api,
      instruct: !!m.instruct, clone: !!p.clone, profile: p.clone ? 'remote' : 'none',
      speed: p.speed || null, pitch: p.pitch || null, volume: p.volume || null,
      sliders: p.sliders || [], emotions: p.emotions || null,
      maxChars: m.maxChars, langs: m.langs, langCount: m.langs === '*' ? (m.langCount || 12) : m.langs.length, langExact: !!m.langExact,
      rate: p.rate, region: !!p.region,
    };
  }
  /** 语言 Picker 的选项：「自动」+ 这只模型会念的。多语言（`*`）或超过 12 种时，`all` 为假只列常用 12 种，
   *  由界面挂一项「更多…」。 */
  function langOptions(provider, model, all) {
    const cap = capabilities(provider, model);
    if (!cap) return [{code: 'auto', name: '自动'}];
    const codes = cap.langs === '*' ? COMMON_LANGS
      : (all || cap.langs.length <= 12) ? cap.langs : cap.langs.filter((c) => COMMON_LANGS.indexOf(c) >= 0);
    return [{code: 'auto', name: '自动'}].concat(codes.map((c) => ({code: c, name: native(c)})));
  }
  /** 会不会念这种语言：多语言引擎都算会 */
  function speaks(provider, model, lang) {
    const cap = capabilities(provider, model);
    if (!cap) return false;
    const code = String(lang || '').split(/[-_]/)[0];
    return cap.langs === '*' || cap.langs.indexOf(code) >= 0;
  }
  /** 语言简写给卡片：`70+ 种语言` / `29 种语言` / `130 种语言`（官方给了确数的）/ `多语言` */
  function langsShort(provider, model) {
    const cap = capabilities(provider, model);
    if (!cap) return '';
    if (cap.langs === '*') return cap.langExact ? `${cap.langCount} 种语言` : cap.langCount >= 50 ? `${cap.langCount}+ 种语言` : '多语言';
    return `${cap.langs.length} 种语言`;
  }
  /** `--lang` 在 MiniMax 上映射成 `language_boost` 的枚举；不在表里 → auto */
  const minimaxBoost = (lang) => MINIMAX_BOOST[String(lang || '').split(/[-_]/)[0]] || 'auto';

  /* ---------- 折成 model-tts.js 认的「引擎」（§11.1） ----------
     一家一只引擎 `cloud:<provider>`；`models.preset` 是这家的第一只（缺省）模型 id，表单再用 `cloudModel` 挑别的。
     `builtin: 'cloud'`：内置录音对云端没意义（§2.3 没有「内置音色」组）。`langs` 取缺省模型的。 */
  function engineFor(p) {
    const first = p.models[0];
    const cap = capabilities(p, first.id);
    return {
      id: engineId(p.id), name: p.name, family: p.name, desc: p.desc, cloud: true, provider: p.id, custom: !!p.custom,
      models: {preset: modelId(p.id, first.id)}, builtin: 'cloud', emotion: false, slow: false,
      langs: cap.langs === '*' ? COMMON_LANGS.slice() : cap.langs.slice(),
      cloudModels: p.models.map((m) => ({id: modelId(p.id, m.id), model: m.id, desc: m.desc, prev: !!m.prev})),
    };
  }
  /** 已连接的 API 提供方 → 引擎列表；`saved` 是已连密钥的提供方 id 数组，`extra` 是自建 */
  function engines(saved, extra) {
    const on = saved || [];
    return providers(extra).filter((p) => on.indexOf(p.id) >= 0).map(engineFor);
  }
  /** 全部 API 提供方 → 引擎列表（含没连的，卡片上写「未连接」） */
  const allEngines = (extra) => providers(extra).map(engineFor);
  /** 引擎卡（§4.4）：一句话 + 能力标签；没连的多一枚「未连接」 */
  function card(provider, connected) {
    const p = typeof provider === 'string' ? providerById(provider) : provider;
    if (!p) return null;
    const cap = capabilities(p, p.models[0].id);
    const tags = [{label: '预设音色'}];
    if (cap.clone) tags.push({label: '克隆'});
    /* 只有部分模型收风格指令才点名是哪几只；全都收（自建、Gemini）就只写「风格指令」 */
    const styled = p.models.filter((m) => m.instruct);
    if (styled.length) tags.push({label: p.custom || styled.length === p.models.length ? '风格指令' : `风格指令（${styled.map((m) => m.id).join(' / ')}）`});
    if (cap.emotions) tags.push({label: '情绪'});
    /* 没有数值语速的（Gemini）连「语速」都不写——不做假开关 */
    const knobs = [].concat(cap.speed ? ['语速'] : [], cap.pitch ? ['音高'] : [], cap.volume ? ['音量'] : []);
    if (knobs.length) tags.push({label: knobs.join(' / ')});
    if (cap.sliders.length) tags.push({label: cap.sliders.map((s) => s.label).join(' / ')});
    tags.push({label: p.langsTag || langsShort(p, p.models[0].id)});
    tags.push({label: p.custom ? 'OpenAI-compatible' : '联网计费', tone: 'notice'});
    if (connected === false) tags.push({label: '未连接', tone: 'neutral'});
    return {id: engineId(p.id), name: p.name, line: p.desc, tags};
  }
  /** 计费口径一句：自建「发到你自建的服务」、Gemini「按 token 计费」、其余「按字符计费」 */
  const billing = (provider) => {
    const p = typeof provider === 'string' ? providerById(provider) : provider;
    return p && p.custom ? '发到你自建的服务' : (p && p.bill) || '按字符计费';
  };
  /** 页顶 chip：本地写「在这台电脑上合成 · 不联网」，云端换成这句 */
  const headerChip = (provider) => {
    const p = typeof provider === 'string' ? providerById(provider) : provider;
    return p ? `联网 · ${p.name} · ${billing(p)}` : '';
  };

  /* ---------- 音色目录与默认音色（§3.5 / §3.6） ---------- */
  /** 这家的音色：内置目录 + `discovered`（「刷新音色」问回来的，原型里是 store 上的一份） */
  function voicesOf(provider, discovered) {
    const p = typeof provider === 'string' ? providerById(provider) : provider;
    if (!p) return [];
    const extra = (discovered && discovered[p.id]) || [];
    return p.voices.concat(extra.filter((v) => !p.voices.some((x) => x.id === v.id)));
  }
  /** 没选音色时按念的语言挑：先精确命中，其次英语，最后表首（与 `voices::default_for` 同口径） */
  function defaultVoice(provider, lang, discovered) {
    const p = typeof provider === 'string' ? providerById(provider) : provider;
    if (!p) return null;
    const code = String(lang || '').split(/[-_]/)[0];
    const list = voicesOf(p, discovered);
    const byId = (id) => list.find((v) => v.id === id) || null;
    const d = p.defaultVoice || {};
    return byId(d[code]) || (code && list.find((v) => v.lang === code)) || byId(d.en) || byId(d['*']) || list[0] || null;
  }
  const voiceById = (provider, id, discovered) => voicesOf(provider, discovered).find((v) => v.id === id) || null;
  /** 目录搜索：名字 / 副文案 / id 里含关键字（不分大小写），最多 `cap` 只 */
  function searchVoices(list, q, cap) {
    const s = String(q || '').trim().toLowerCase();
    const hit = s ? list.filter((v) => `${v.name} ${v.sub || ''} ${v.id}`.toLowerCase().indexOf(s) >= 0) : list;
    return hit.slice(0, cap || 30);
  }
  /** 目录多于这个数就给搜索框 */
  const SEARCH_AT = 12;

  /* ---------- 「我的声音」在某家的克隆状态（§6） ----------
     音色档多一段 `cloud: {<provider>: {voiceId, referenceSha256, at, region?}}`。
     返回 {k, ok, line, chip}：k ∈ uploaded / first / stale / short / consent / unsupported / orphan。 */
  const consentBlocks = (v) => (v.consent || 'unspecified') === 'unspecified';
  function cloneStatus(v, provider, opt) {
    const p = typeof provider === 'string' ? providerById(provider, opt && opt.extra) : provider;
    const o = opt || {};
    if (!p) return {k: 'unsupported', ok: false, line: '没有这家提供方', chip: '—'};
    if (!p.clone) {
      const alt = providers(o.extra).filter((x) => x.clone && (!o.saved || o.saved.indexOf(x.id) >= 0)).map((x) => x.name);
      return {k: 'unsupported', ok: false, chip: `${p.name} 不能克隆`,
        line: `${p.name} 不能克隆 · 用${p.ownVoices || '它的内置音色'}${alt.length ? '，或换 ' + alt.join(' / ') : ''}`};
    }
    const b = v && v.cloud && v.cloud[p.id];
    if (b && b.orphan) return {k: 'orphan', ok: true, chip: `${p.name} ⚠`, line: `密钥已移除 · ${p.name} 上的克隆副本清理不了 · 重新连接后第一次用时重建`};
    if (consentBlocks(v)) return {k: 'consent', ok: false, chip: `${p.name} —`, line: '许可未说明 · 不上传到第三方 · 去设置里补一行'};
    const usable = Math.max(+(v.sourceDur || 0), +(v.dur || 0));
    if (p.clone.min && usable < p.clone.min) {
      return {k: 'short', ok: false, chip: `${p.name} — 参考不足 ${p.clone.min} 秒`,
        line: `参考只有 ${usable.toFixed(1)} 秒 · ${p.name} 要 ${p.clone.min} 秒以上 · 换参考段`};
    }
    if (b && b.voiceId) {
      if (b.stale || (b.referenceSha256 && v.referenceSha256 && b.referenceSha256 !== v.referenceSha256) || (p.region && o.region && b.region && b.region !== o.region)) {
        return {k: 'stale', ok: true, chip: `${p.name} ⚠ 参考已换`, line: `参考段换过了 · 下次用时先删 ${p.name} 上的旧克隆再重传`};
      }
      return {k: 'uploaded', ok: true, chip: `${p.name} ↑ 已上传`, line: `已上传到 ${p.name} · ${b.at || ''}`.replace(/ · $/, '')};
    }
    const secs = usable.toFixed(1);
    return {k: 'first', ok: true, chip: `${p.name} · 首次用时上传`,
      line: `第一次用时上传参考段（${secs} 秒）到 ${p.name} 建克隆${p.clone.expiresDays ? ` · ${p.clone.expiresDays} 天不用会过期，用时自动重建` : ''}`};
  }
  /** 行卡上的云端 chip：只列已连接的 API 提供方 */
  function cloudChips(v, saved, opt) {
    return providers(opt && opt.extra).filter((p) => (saved || []).indexOf(p.id) >= 0)
      .map((p) => Object.assign({id: p.id, name: p.name}, cloneStatus(v, p, opt)));
  }
  /** 音色档的状态变换：上传 / 删远端 / 换参考段（标陈旧） / 移除密钥（标 orphan）。都回新的 `cloud` 段。 */
  function bindAfter(v, provider, action, o) {
    const cloud = Object.assign({}, v.cloud || {});
    if (action === 'upload') cloud[provider] = {voiceId: (o && o.voiceId) || `bc_${provider}_${String(v.id).slice(-4)}`, referenceSha256: v.referenceSha256 || null, at: (o && o.at) || '刚刚', region: o && o.region};
    else if (action === 'delete') delete cloud[provider];
    else if (action === 'retake') Object.keys(cloud).forEach((k) => { cloud[k] = Object.assign({}, cloud[k], {stale: true}); });
    else if (action === 'orphan') { if (cloud[provider]) cloud[provider] = Object.assign({}, cloud[provider], {orphan: true}); }
    return cloud;
  }
  /** 第一次往某家上传前的告知（§6.3）：一次一家，勾「不再提示」按 API 提供方记 */
  function uploadNotice(v, provider) {
    const p = typeof provider === 'string' ? providerById(provider) : provider;
    const secs = Math.max(+(v.sourceDur || 0), +(v.dur || 0)).toFixed(1);
    return `要把「${v.name}」的参考段（${secs} 秒）上传到 ${p.name} 建克隆。之后用这只音色会直接用对方的 voice id；删音色时会一并删除。`;
  }

  /* ---------- 共享选择器在云端引擎下的分组（§2.3）：默认 / 我的声音 / 提供方音色 / 临时用一段 ---------- */
  /** `opt`：{discovered, saved, extra, lang, query, file}。值的形状与本地同：{kind: default | my | voice | file, id?, name?} */
  function pickerGroups(provider, voices, opt) {
    const o = opt || {};
    const p = typeof provider === 'string' ? providerById(provider, o.extra) : provider;
    if (!p) return [];
    const dv = defaultVoice(p, o.lang, o.discovered);
    const groups = [];
    groups.push({k: 'default', label: '默认', items: [{kind: 'default', label: '默认音色', sub: dv ? `按念的语言挑一只 ${p.name} 的音色（${dv.name}）` : '由对方缺省'}]});
    const mine = (voices || []).map((v) => {
      const st = cloneStatus(v, p, o);
      return {kind: 'my', id: v.id, label: v.name, sub: st.line, disabled: !st.ok, why: st.line};
    });
    mine.push({kind: 'new', label: '克隆新音色…', sub: '去设置 › 模型 › 语音合成 › 我的声音录一段或从视频里取'});
    groups.push({k: 'my', label: '我的声音', items: mine});
    const list = voicesOf(p, o.discovered);
    const items = searchVoices(list, o.query, 30).map((v) => ({kind: 'voice', id: v.id, label: v.name, sub: v.sub || v.id}));
    groups.push({k: 'voices', label: `${p.name} 的音色`, search: list.length > SEARCH_AT, total: list.length, items: items.length ? items : [{kind: 'none', label: list.length ? '没有匹配的音色' : '刷新音色目录', sub: list.length ? '换个关键字' : '设置 › 模型 › 云端模型 › 刷新音色', disabled: true}]});
    if (p.clone && o.file !== false) {
      groups.push({k: 'file', label: '临时', items: [{kind: 'file', label: '临时用一段录音…',
        sub: p.clone.expiresDays ? `只这一次 · ${p.name} 建临时克隆，${p.clone.expiresDays} 天后自动过期` : `只这一次 · ${p.name} 建临时克隆，用完即删`}]});
    }
    return groups;
  }
  /** 值 → 控件上显示的名字 */
  function valueLabel(provider, value, voices, opt) {
    const v = value || {kind: 'default'};
    if (v.kind === 'my') { const m = (voices || []).find((x) => x.id === v.id); return m ? m.name : '已删除的音色'; }
    if (v.kind === 'voice') { const x = voiceById(provider, v.id, opt && opt.discovered); return x ? x.name : v.id; }
    if (v.kind === 'file') return v.name || '临时录音';
    return '默认音色';
  }
  /** 选中后写在控件下的一句 */
  function valueLine(provider, value, voices, opt) {
    const o = opt || {};
    const p = typeof provider === 'string' ? providerById(provider, o.extra) : provider;
    const v = value || {kind: 'default'};
    if (!p) return null;
    if (v.kind === 'my') {
      const m = (voices || []).find((x) => x.id === v.id);
      if (!m) return '这只音色已经删了 · 换一只，或退回默认';
      const st = cloneStatus(m, p, o);
      return st.ok ? `${st.line} · 多句时每句都用同一只 voice id` : st.line;
    }
    if (v.kind === 'voice') { const x = voiceById(p, v.id, o.discovered); return x ? `${p.name} 的音色 · ${x.sub || x.id}` : `${p.name} 的音色 · ${v.id}`; }
    if (v.kind === 'file') return p.clone && p.clone.min > 3 ? `只这一次 · ${p.clone.min} 秒以上、一个人说话的干净录音` : '只这一次 · 5–15 秒、一个人说话的干净录音';
    const dv = defaultVoice(p, o.lang, o.discovered);
    return dv ? `不选就按念的语言挑 ${p.name} 的音色（${dv.name}）` : '不选就由对方缺省';
  }
  /** 收据 / 现状小字里的音色短名 */
  function voiceLabel(provider, value, voices, opt) {
    const o = opt || {};
    const v = value || {kind: 'default'};
    if (v.kind === 'default') { const dv = defaultVoice(provider, o.lang, o.discovered); return dv ? `默认音色 · ${dv.name}` : '默认音色'; }
    return valueLabel(provider, v, voices, o);
  }

  /* ---------- 表单：校验、费用、现状 ---------- */
  /** 云端专属的校验：超过这只模型一次能收的字数、我的声音在这家不可用 */
  function validate(f, voices, opt) {
    const o = opt || {};
    const errs = [];
    const pr = parse(f.engine);
    const p = pr && providerById(pr.provider, o.extra);
    if (!p) return errs;
    const cap = capabilities(p, (parse(f.cloudModel) || {}).model);
    const text = String(f.text || '').trim();
    if (text.length > cap.maxChars) errs.push(`${cap.model} 一次最多 ${cap.maxChars.toLocaleString()} 字，超出的会在本机切段后分几次发送`);
    const v = f.cloudVoice || {kind: 'default'};
    if (v.kind === 'my') {
      const m = (voices || []).find((x) => x.id === v.id);
      if (!m) errs.push('选中的音色已经删了，换一只');
      else { const st = cloneStatus(m, p, o); if (!st.ok) errs.push(st.line); }
    }
    if (v.kind === 'file' && !v.name) errs.push('先选一段参考音频，或换回默认音色');
    if (o.saved && o.saved.indexOf(p.id) < 0) errs.push(`先连接 ${p.name} 的密钥`);
    return errs;
  }
  /** 费用一句：`按字符计费 · 这次约 128 字 · 停止等待不会撤回已发送的请求`（口径按 `billing`） */
  function costLine(text, provider) {
    const n = String(text || '').trim().length;
    return `${billing(provider)} · 这次约 ${n} 字 · 停止等待不会撤回已发送的请求`;
  }
  /** 生成条现状小字：`eleven_v3 · Sarah · 约 12.4 秒 · 约 128 字` 的后两段 */
  const charsLabel = (text) => `约 ${String(text || '').trim().length} 字`;
  /** 记录 / 素材卡元数据行里的 API 提供方与字数：`ElevenLabs · eleven_v3 · Sarah · 英语 · 128 字` 中的 `128 字` */
  const chars = (text) => String(text || '').trim().length;

  const BC_CLOUD_TTS = {
    PREFIX, PROVIDERS, REGIONS, SEED_SAVED, COMMON_LANGS, MINIMAX_LANGS, MINIMAX_BOOST, SEARCH_AT,
    isCloud, engineId, modelId, parse, providerOf, customProvider, providers, providerById, modelOf,
    capabilities, langOptions, speaks, langsShort, minimaxBoost,
    engineFor, engines, allEngines, card, billing, headerChip,
    voicesOf, defaultVoice, voiceById, searchVoices,
    cloneStatus, cloudChips, bindAfter, uploadNotice,
    pickerGroups, valueLabel, valueLine, voiceLabel, validate, costLine, charsLabel, chars,
  };
  if (typeof window !== 'undefined') Object.assign(window, {BC_CLOUD_TTS});
  if (typeof module !== 'undefined' && module.exports) module.exports = BC_CLOUD_TTS;
})();
