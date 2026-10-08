/* 本地语音合成 / 克隆 / 翻译配音的纯模型 —— §13.6 / §15.3 / §15.4 / §17.3（2026-09-11）。
   三块屏共用一份真相：设置页「语音合成 / 音源分离」两张卡、音频 Tab 的生成面板、
   AI 工具里的「翻译配音」。这里只算：引擎 → 需要哪只模型、表单校验、分段计数、
   进度 → 阶段与活动行、配音块的时间适配与说话人着色、语速库与「按时长整理译文」
   的计划、收据文案。不碰 React、不碰 DOM，`node --test` 直接 require。 */
(function () {
  /* 语言的名字与配音目标语言都从共用目录取（model-languages.js，镜像 `bcut-lang`）：
     这只模块不另带一份语言表，只带「哪只引擎会念哪些语言」这张能力表。 */
  const CATALOG = (typeof window !== 'undefined' && window.BC_LANGUAGES)
    || (typeof require === 'function' ? require('./model-languages.js') : null);
  /* 注音（model-readings.js，2026-09-23）：文字里可以带 `<字|读音>` 注记，量语速 / 估时长前先去掉 */
  const RD = (typeof window !== 'undefined' && window.BC_READINGS)
    || (typeof require === 'function' ? require('./model-readings.js') : null);
  const bare = (text) => (RD ? RD.stripReadings(text) : String(text || ''));
  /* ---------- 模型目录（与 data.js `setModels` 的 id 一一对应） ---------- */
  const MODELS = {
    'qwen3-tts-0.6b-base':        {engine: 'qwen3', mode: 'clone',  name: 'Qwen3-TTS 0.6B Base'},
    'qwen3-tts-0.6b-customvoice': {engine: 'qwen3', mode: 'preset', name: 'Qwen3-TTS 0.6B CustomVoice'},
    'qwen3-tts-1.7b-base':        {engine: 'qwen3-1.7b', mode: 'clone', name: 'Qwen3-TTS 1.7B Base'},
    'qwen3-tts-1.7b-customvoice': {engine: 'qwen3-1.7b', mode: 'preset', name: 'Qwen3-TTS 1.7B CustomVoice'},
    'qwen3-tts-1.7b-voicedesign': {engine: 'qwen3-1.7b', mode: 'describe', name: 'Qwen3-TTS 1.7B VoiceDesign'},
    'indextts2':                  {engine: 'indextts2', mode: 'clone', name: 'IndexTTS2'},
    'index-tts2.5':               {engine: 'indextts25', mode: 'clone', name: 'IndexTTS 2.5'},
    'gpt-sovits-v2':              {engine: 'gptsovits', mode: 'clone', name: 'GPT-SoVITS v2'},
    'voxcpm2':                    {engine: 'voxcpm2', mode: 'clone', name: 'VoxCPM2'},
    'omnivoice':                  {engine: 'omnivoice', mode: 'clone', name: 'OmniVoice'},
    'htdemucs-ft':                {engine: 'sep', name: 'HTDemucs-FT'},
  };
  /* 引擎表。`models` = 音色方式 → 要装的模型 id，它同时决定这只引擎能给哪几种音色方式：
     Qwen3-TTS 官方 12 Hz 系列在 BaoCut 每档保留 Base（克隆）/ CustomVoice（9 个预设 + 风格指令）两只。
     `builtin` = 内置音色在这只引擎上怎么落地（2026-09-21 起**每只引擎都有默认音色**）：
     `'ref'` 拿随包录音当参考（克隆三只与 Qwen3-TTS Base），`'describe'` 拿随包的那句声音描述
     造声（目前没有引擎走这条）；CustomVoice 走 `models.preset`，用模型自己的 9 只说话人。
     `emotion` = 表单里有情绪控制。
     `family` = 收据、任务 sub、配音组头里的引擎名：两只 Qwen3-TTS 都写 Qwen3-TTS（与 App 回执一致）。
     2026-09-26 起「有描述」不再等于「只能描述」：Qwen3-TTS 1.7B 恢复 VoiceDesign（`models.describe`，一句自由描述，
     不吃参考音频；没写描述时落到所选内置音色的那句描述），OmniVoice 既能克隆也能描述，但描述是**受限词表**
     （`vocab`：性别 / 年龄 / 音高 / 风格 / 口音 / 方言各挑至多一项，见 `OMNI_DESIGN`）。
     `style` = 不靠预设也收一句风格指令（VoxCPM2：写了风格就走可控克隆）。
     `duration` = 能按目标时长合成（秒上限）：配音时每句直接按原句槽位长度合成，语速旋钮失效。
     `nonCommercial` = 权重许可只许非商业用途（下载前要确认，见 data.js 该行的 `license`）。 */
  const ENGINES = [
    {id: 'qwen3', name: 'Qwen3-TTS 0.6B', family: 'Qwen3-TTS', desc: '9 个预设音色，或 3 秒参考音频克隆；可用一句话指定风格',
     models: {preset: 'qwen3-tts-0.6b-customvoice', clone: 'qwen3-tts-0.6b-base'}},
    {id: 'qwen3-1.7b', name: 'Qwen3-TTS 1.7B', family: 'Qwen3-TTS', desc: '同样 9 个预设音色与 3 秒克隆，还能只凭一句描述造一个新声音；音质更好也更慢', slow: true,
     models: {preset: 'qwen3-tts-1.7b-customvoice', clone: 'qwen3-tts-1.7b-base', describe: 'qwen3-tts-1.7b-voicedesign'}},
    {id: 'indextts2', name: 'IndexTTS2', desc: '八只内置音色，或用自己的录音克隆；情绪可另拿一段音频或按预设调', models: {clone: 'indextts2'}, builtin: 'ref', emotion: true},
    {id: 'indextts25', name: 'IndexTTS 2.5', desc: '同样八只内置音色与克隆，情绪同 IndexTTS2；多会念日语、西班牙语、阿拉伯语', models: {clone: 'index-tts2.5'}, builtin: 'ref', emotion: true},
    {id: 'gptsovits', name: 'GPT-SoVITS', desc: '八只内置音色，或用自己的录音克隆；再给参考音频的原文会更像，这时参考要 3–10 秒；没有情绪控制', models: {clone: 'gpt-sovits-v2'}, builtin: 'ref'},
    {id: 'voxcpm2', name: 'VoxCPM2', desc: '八只内置音色，或用自己的录音克隆；给了录音原文最像，也可用一句话指定说话风格；会念 30 种语言与粤语，出 48 kHz',
     models: {clone: 'voxcpm2'}, builtin: 'ref', style: true},
    {id: 'omnivoice', name: 'OmniVoice', desc: '八只内置音色、用自己的录音克隆，或挑性别、年龄、音高造一个新声音；能按目标时长念，会念的语言最多；仅限非商用',
     models: {clone: 'omnivoice', describe: 'omnivoice'}, builtin: 'ref', vocab: true, duration: 60, nonCommercial: true},
  ];
  /* 音色方式的固定次序与标签：预设 → 参考音频 → 描述。 */
  const VOICE_MODES = [
    {k: 'preset', label: '预设'}, {k: 'clone', label: '参考音频'}, {k: 'describe', label: '描述'},
  ];
  /* CustomVoice 的 9 个预设音色（0.6B 与 1.7B 同一张表，spk_id 也一样）。
     名字是模型权重里的标识，不翻译；副题是听感。 */
  const PRESETS = [
    {id: 'Vivian',   sub: '女声 · 明亮'},
    {id: 'Serena',   sub: '女声 · 沉稳'},
    {id: 'Uncle_Fu', sub: '男声 · 低沉'},
    {id: 'Dylan',    sub: '男声 · 青年'},
    {id: 'Eric',     sub: '男声 · 播音'},
    {id: 'Ryan',     sub: '男声 · 轻快'},
    {id: 'Aiden',    sub: '男声 · 叙事'},
    {id: 'Ono_Anna', sub: '女声 · 日语'},
    {id: 'Sohee',    sub: '女声 · 韩语'},
  ];
  /* IndexTTS2 / IndexTTS 2.5 的情绪向量，界面上给成预设 + 一根强度滑杆 */
  const EMOTIONS = [
    {id: 'eager', name: '热切'}, {id: 'happy', name: '开心'}, {id: 'excited', name: '兴奋'},
    {id: 'angry', name: '生气'}, {id: 'sad', name: '难过'}, {id: 'afraid', name: '害怕'},
    {id: 'disgusted', name: '厌恶'}, {id: 'melancholic', name: '忧郁'}, {id: 'surprised', name: '惊讶'},
    {id: 'calm', name: '平静'},
  ];
  const LANGS = [{code: 'auto', name: '自动'}]
    .concat(['zh', 'en', 'ja', 'ko'].map((c) => ({code: c, name: CATALOG.native(c)})));
  /* 配音能选的目标语言（§15.4）：已翻译的轨直接配，没翻的先跑一遍「翻译字幕」再配。
     Qwen3-TTS 能念 10 种，IndexTTS2 与 GPT-SoVITS 只有中英——引擎不支持的语言在菜单里标出来。 */
  const DUB_LANGS = CATALOG.dub.map((c) => ({code: c, name: CATALOG.native(c)}));
  /* 时间适配策略。默认「压到下一句前」：超长的句只加速、**不截断**——截掉的是译文的
     尾巴，听的人不知道少了什么；加速的句至少完整，快过 1.35× 的在轨上标橙，
     人能看见、能拉、能回去整理译文。「压缩并截断」是 2026-09-11 之前的旧默认，留着给
     不能容忍任何过快的场合。 */
  const FIT = [
    {id: 'compress', name: '压到下一句前', desc: '超出原句就加速，能借下一句开口前的空档；不截断，快过 1.35× 的句在轨上标橙'},
    {id: 'truncate', name: '压缩并截断', desc: '最多加速 1.35×，再超就截到下一句前'},
    {id: 'overrun', name: '允许超出', desc: '按自然语速合成，长句会盖到下一句上'},
    {id: 'fixed', name: '固定语速', desc: '统一 1.0×，不看原句长短'},
  ];
  const ORIGINAL = [
    {id: 'mute', name: '静音'}, {id: 'duck', name: '压低到 −18 dB'},
  ];
  const STRATEGY = [
    {id: 'clone', name: '克隆每位说话人的原声', desc: '每人取连续几整句（5–10 秒）连同原文当参考，全程同一段参考、同一颗种子'},
    {id: 'preset', name: '每位说话人指定一个预设音色', desc: '只有 Qwen3-TTS 有预设'},
    {id: 'upload', name: '上传一段参考音频', desc: '所有人用同一个声音'},
    {id: 'describe', name: '按一句话描述造一个新声音', desc: '所有说话人共用；Qwen3-TTS 1.7B 与 OmniVoice 会'},
  ];

  /* ---------- 本地引擎的数值旋钮（2026-09-26） ----------
     只有这几只引擎收数值参数（`bcut tts --speed / --cfg / --steps`，区间照 core `bcut_tts::capabilities::local_ranges`）。
     界面上收在「高级」折叠里、默认收起；用户没碰过的键不进表单（`knobs` 里没有这个键），合成时也不传——
     CLI 只在给了的时候才把它算进指纹，不给就用模型自己的默认。IndexTTS2 不收 `--speed`（只有 2.5 收）。
     OmniVoice 的区间取官方 Gradio demo 的滑杆（语速 0.5–1.5、引导 0–4、步数 4–64），与 core 能力表同一出处。 */
  const LOCAL_KNOBS = {
    indextts25: [
      {k: 'speed', label: '语速', flag: '--speed', min: 0.5, max: 1.5, step: 0.05, dflt: 1, unit: '×'},
    ],
    voxcpm2: [
      {k: 'cfg', label: '引导强度', flag: '--cfg', min: 1, max: 3, step: 0.1, dflt: 2, sub: '越高越贴参考与风格，太高会发紧'},
      {k: 'steps', label: '采样步数', flag: '--steps', min: 1, max: 50, step: 1, dflt: 10, sub: '步数多更细，也更慢'},
    ],
    omnivoice: [
      {k: 'speed', label: '语速', flag: '--speed', min: 0.5, max: 1.5, step: 0.05, dflt: 1, unit: '×', sub: '给了目标时长时不起作用'},
      {k: 'cfg', label: '引导强度', flag: '--cfg', min: 0, max: 4, step: 0.1, dflt: 2, sub: '越高越贴参考与描述，太高会发紧；0 是不做引导'},
      {k: 'steps', label: '采样步数', flag: '--steps', min: 4, max: 64, step: 1, dflt: 32, sub: '步数多更细，也更慢'},
    ],
  };
  /** 这只引擎有哪些旋钮（没有就空表，「高级」那一栏不画） */
  const knobsOf = (engine) => LOCAL_KNOBS[engineOf(engine).id] || [];
  const clampKnob = (d, v) => {
    const n = Math.min(d.max, Math.max(d.min, +v));
    return d.step >= 1 ? Math.round(n) : +(Math.round(n / d.step) * d.step).toFixed(2);
  };
  /** 旋钮现在的值：用户设过取设过的（夹进区间），没设过取模型默认 */
  function knobValue(engine, knobs, k) {
    const d = knobsOf(engine).find((x) => x.k === k);
    if (!d) return null;
    const v = (knobs || {})[k];
    return v == null || !isFinite(+v) ? d.dflt : clampKnob(d, v);
  }
  /** 拨一只旋钮：返回新的 `knobs`（不改入参）。`v` 为 null 就删掉这个键（回到「不传」） */
  function setKnob(engine, knobs, k, v) {
    const d = knobsOf(engine).find((x) => x.k === k);
    const out = Object.assign({}, knobs || {});
    if (!d || v == null) { delete out[k]; return out; }
    out[k] = clampKnob(d, v);
    return out;
  }
  /** 合成时真正传的参数：只有这只引擎认、且用户设过的键；`opt.duration` 为真（按目标时长合成）时语速不传 */
  function knobArgs(engine, knobs, opt) {
    const o = opt || {};
    return knobsOf(engine)
      .filter((d) => (knobs || {})[d.k] != null && !(o.duration && d.k === 'speed'))
      .map((d) => ({k: d.k, flag: d.flag, v: knobValue(engine, knobs, d.k)}));
  }
  const knobText = (d, v) => (d.unit ? (+v).toFixed(2) + d.unit : d.step >= 1 ? String(v) : (+v).toFixed(1));
  /** 「高级」折叠的副题：设过的写成「引导强度 2.4 · 采样步数 20」，都没设写「按模型默认」 */
  function knobLine(engine, knobs, opt) {
    const set = knobArgs(engine, knobs, opt);
    if (!set.length) return '按模型默认';
    return set.map((a) => {
      const d = knobsOf(engine).find((x) => x.k === a.k);
      return `${d.label} ${knobText(d, a.v)}`;
    }).join(' · ');
  }
  /** 能按目标时长合成的上限（秒）：OmniVoice 60，其余 0 */
  const DURATION_MAX = {omnivoice: 60};
  const durationMax = (engine) => DURATION_MAX[engineOf(engine).id] || 0;

  /* ---------- OmniVoice 的声音描述词表（2026-09-26） ----------
     OmniVoice 的「描述」不是自由文本：每一类至多挑一项，用逗号连起来交给 `--instruct`；一项都不挑不算描述。
     英语口音只在念英语时生效，汉语方言只在念中文时生效；描述造声官方只在中文、英语上训练过。
     参考音频与描述同时给时听参考的（所以描述只放在「描述」那一档，克隆那一档不画）。
     词表的写法（`value`）照 core `bcut_tts::omnivoice::instruct` 的词表（即官方 `voice_design.py`），口音带 ` accent` 后缀；
     `model-tts.test.js` 从 Rust 源码读词表对拍。内核收半角逗号，混写中英时按方言 / 口音统一成一种语言。 */
  const OMNI_DESIGN = {
    joiner: ', ',
    trained: ['zh', 'en'],
    cats: [
      {k: 'gender', label: '性别', items: ['男', '女']},
      {k: 'age', label: '年龄', items: ['儿童', '少年', '青年', '中年', '老年']},
      {k: 'pitch', label: '音高', items: ['极低音调', '低音调', '中音调', '高音调', '极高音调']},
      {k: 'style', label: '风格', items: ['耳语']},
      {k: 'accent', label: '英语口音', lang: 'en', items: ['american accent', 'british accent', 'australian accent', 'canadian accent', 'indian accent', 'chinese accent', 'korean accent', 'japanese accent', 'portuguese accent', 'russian accent'],
       names: {'american accent': '美国', 'british accent': '英国', 'australian accent': '澳大利亚', 'canadian accent': '加拿大', 'indian accent': '印度', 'chinese accent': '中国', 'korean accent': '韩国', 'japanese accent': '日本', 'portuguese accent': '葡萄牙', 'russian accent': '俄罗斯'}},
      {k: 'dialect', label: '汉语方言', lang: 'zh', items: ['河南话', '陕西话', '四川话', '贵州话', '云南话', '桂林话', '济南话', '石家庄话', '甘肃话', '宁夏话', '青岛话', '东北话']},
    ],
  };
  /* 配音 / 试听给的三组现成挑法（不挑就没有声音，所以得有起点） */
  const OMNI_PRESETS = [
    {k: 'omni-f', label: '青年女声', sel: {gender: '女', age: '青年'}},
    {k: 'omni-m', label: '中年男声', sel: {gender: '男', age: '中年', pitch: '低音调'}},
    {k: 'omni-whisper', label: '耳语女声', sel: {gender: '女', style: '耳语'}},
  ];
  /** 这门语言能挑哪几类：口音 / 方言只在各自的语言下出现；「自动」两类都不出 */
  function omniCats(lang) {
    const code = langCode(lang);
    return OMNI_DESIGN.cats.filter((c) => !c.lang || c.lang === code);
  }
  /** 一项的显示名（口音写「英国口音」这类中文，值仍是词表原文） */
  function omniItemLabel(cat, v) {
    const c = OMNI_DESIGN.cats.find((x) => x.k === cat);
    return c && c.names && c.names[v] ? c.names[v] + '口音' : v;
  }
  /** 只留这门语言下合法的项：换语言时把不再生效的口音 / 方言清掉；也丢掉词表外的值 */
  function omniFit(sel, lang) {
    const out = {};
    omniCats(lang).forEach((c) => {
      const v = (sel || {})[c.k];
      if (v && c.items.indexOf(v) >= 0) out[c.k] = v;
    });
    return out;
  }
  /** 点一项：同一项再点一次取消（每类至多一项） */
  function omniToggle(sel, cat, v) {
    const out = Object.assign({}, sel || {});
    if (out[cat] === v) delete out[cat]; else out[cat] = v;
    return out;
  }
  /** 挑了几项（只数词表内的） */
  function omniCount(sel) {
    return OMNI_DESIGN.cats.filter((c) => (sel || {})[c.k] && c.items.indexOf(sel[c.k]) >= 0).length;
  }
  /** 挑好的项 → `--instruct` 的那一串，按类的固定次序 */
  function omniInstruct(sel) {
    return OMNI_DESIGN.cats.map((c) => (sel || {})[c.k]).filter((v, i) => v && OMNI_DESIGN.cats[i].items.indexOf(v) >= 0).join(OMNI_DESIGN.joiner);
  }
  /** 给人看的一行：「女 · 青年 · 英国口音」 */
  function omniLabel(sel) {
    return OMNI_DESIGN.cats.filter((c) => (sel || {})[c.k]).map((c) => omniItemLabel(c.k, sel[c.k])).join(' · ');
  }
  /** OmniVoice 描述的问题：一项都没挑 / 口音或方言与语言对不上；没问题回 null */
  function omniProblem(sel, lang) {
    if (!omniCount(sel)) return '先在性别、年龄、音高等几项里至少挑一项';
    const code = langCode(lang);
    const bad = OMNI_DESIGN.cats.find((c) => c.lang && (sel || {})[c.k] && c.lang !== code);
    return bad ? `${bad.label}只在念${CATALOG.native(bad.lang)}时生效，先把语言选成${CATALOG.native(bad.lang)}，或取消这一项` : null;
  }
  /** 描述造声只在中文、英语上训练过：别的语言给一句提醒（不拦） */
  function omniLangNote(lang) {
    const code = langCode(lang);
    if (!code || code === 'auto' || OMNI_DESIGN.trained.indexOf(code) >= 0) return null;
    return '描述造声只在中文、英语上训练过，念这门语言可能不像描述的那样';
  }
  /** 表单里的「声音描述」原文：OmniVoice 由挑好的项拼，其余就是写的那句 */
  const describeText = (f) => (engineOf(f.engine).vocab ? omniInstruct(f.omni) : String(f.instruct || '').trim());

  const MAX_RATE = 1.35;      // 舒适上限：快过它就标橙、就该整理译文
  const RETRANS_RATE = 1.8;   // 预测语速超过它：缩写救不回来，建议重译
  const MANUAL_RATE = {min: 0.7, max: 2.0};   // 手动拉伸块能到的语速范围
  const GAP = 0.05;           // 借下一句空档时留的间隙（秒）
  const SEP_WINDOW = 7.8;     // HTDemucs 一窗 7.8 秒，分离进度按窗数走
  const CJK_CPS = 4.2;        // 中文 / 日文每秒约 4.2 字（播音语速）
  const LATIN_WPS = 2.6;      // 英文每秒约 2.6 词
  const BED_TRACK_ID = 'bed';
  const langCode = (lang) => String(lang || '').split(/[-_]/)[0];

  /** 认不出的引擎 id 落到表头（Qwen3-TTS 0.6B） */
  /* 每只引擎会念的语言：能力表在共用目录里（`bcut_lang::TTS_ENGINES`），这儿只挂上来。 */
  ENGINES.forEach((e) => { e.langs = CATALOG.ttsLangs(e.id); });
  /* 云端引擎（`cloud:<provider>`，2026-09-24 云端语音合成设计稿）不在 ENGINES 里：由 model-cloud-tts.js
     按 API 提供方折成同形状的对象，这里只在本地表查不到时再问它；认不出的仍落到表头。 */
  const CLOUD = () => (typeof window !== 'undefined' && window.BC_CLOUD_TTS) || (typeof require === 'function' ? require('./model-cloud-tts.js') : null);
  const cloudEngineOf = (engine) => {
    const C = CLOUD();
    if (!C || !C.isCloud(engine)) return null;
    const p = C.providerById(C.providerOf(engine));
    return p ? C.engineFor(p) : null;
  };
  const engineOf = (engine) => ENGINES.find((x) => x.id === engine) || cloudEngineOf(engine) || ENGINES[0];
  /** 本地六只 + 已连接的云端 API 提供方（`saved` 是已连密钥的提供方 id）：工具页与面板的引擎目录 */
  const allEngines = (saved, extra) => { const C = CLOUD(); return ENGINES.concat(C ? C.engines(saved, extra) : []); };
  const engineName = (engine) => engineOf(engine).name;
  /** 收据、任务 sub、配音组头里的引擎名：两只 Qwen3-TTS 都写 Qwen3-TTS */
  const engineFamily = (engine) => engineOf(engine).family || engineName(engine);
  /** 引擎 + 音色方式 → 需要的模型 id。Qwen3-TTS 每档按方式分开装（Base / CustomVoice）；
   *  旧版持久化下来的非法方式落到当前首选（CustomVoice）。 */
  function modelFor(engine, mode) {
    const models = engineOf(engine).models;
    return models[mode] || models[voiceModes(engine)[0]] || models.clone;
  }
  /** 这个引擎允许的音色方式，按 VOICE_MODES 的固定次序 */
  function voiceModes(engine) {
    const models = engineOf(engine).models;
    return VOICE_MODES.map((m) => m.k).filter((k) => models[k]);
  }
  /** 没有预设音色：生成面板不出「预设」那一档 */
  const cloneOnly = (engine) => !engineOf(engine).models.preset;
  /** 能不能描述造一个新声音（Qwen3-TTS 1.7B VoiceDesign / OmniVoice）。 */
  const hasDescribe = (engine) => !!engineOf(engine).models.describe;
  /** 描述走受限词表（OmniVoice）而不是一句自由描述 */
  const describeByVocab = (engine) => !!engineOf(engine).vocab;
  /** 能不能给一句风格指令：CustomVoice（`bcut tts --instruct`）与 VoxCPM2（风格指令 → 可控克隆） */
  const hasStyle = (engine) => {
    const e = engineOf(engine);
    if (e.cloud) { const C = CLOUD(); return !!(C && C.capabilities(e.provider).instruct); }
    return !!e.models.preset || !!e.style;
  };
  /** 「风格」一行在这种音色方式下出不出现：CustomVoice 在预设那一档，VoxCPM2 在克隆那一档，云端看模型 */
  function styleOn(engine, mode) {
    const e = engineOf(engine);
    if (!hasStyle(engine)) return false;
    if (e.cloud) return true;
    return e.style ? mode === 'clone' : mode === 'preset';
  }
  /** 内置音色在这只引擎（+ 音色方式）上怎么落地：'presets' 用模型自己的说话人表
   *  （CustomVoice），'describe' 拿随包的那句描述造声（Qwen3-TTS 1.7B VoiceDesign 在描述那一档），
   *  'none' 这一档不用内置音色（OmniVoice 的描述只认词表，那几句英文描述不合法），其余拿随包录音当参考。
   *  对照 `bcut_tts::voices::support`。 */
  function builtinKind(engine, mode) {
    const e = engineOf(engine);
    if (mode === 'preset' && e.models.preset) return 'presets';
    if (mode === 'describe' && e.models.describe) return e.vocab ? 'none' : 'describe';
    return e.builtin || 'ref';
  }
  /** 参考音频必填：2026-09-21 起一只都没有了（每只引擎都有默认音色），留着是为了旧调用点 */
  const refRequired = () => false;
  /** 表单里有没有情绪控制（IndexTTS 两只） */
  const hasEmotion = (engine) => !!engineOf(engine).emotion;
  /** 这个引擎会不会念这种语言 */
  function engineSpeaks(engine, lang) {
    const e = engineOf(engine);
    if (e.cloud) { const C = CLOUD(); return !!(C && C.speaks(e.provider, null, lang)); }
    return e.langs.indexOf(langCode(lang)) >= 0;
  }
  /** 生成表单的语言 Picker：「自动」加上这只引擎会念的那几项 */
  function formLangs(engine) {
    return LANGS.filter((l) => l.code === 'auto' || engineSpeaks(engine, l.code));
  }
  /** 通用语言框（ui.jsx `LanguageCombobox` 的 `only`）里配音能列的语言：从目录 codes 里筛出
   *  这个引擎会念的，原声语言不配（按主语言码比：原声是简体中文，繁體中文念出来也是同一口普通话）。
   *  换引擎就换一张表——Qwen3-TTS 10 种、IndexTTS2 只剩中英。 */
  function ttsLangs(engine, codes, srcLang) {
    const src = langCode(srcLang);
    return (codes || []).filter((c) => engineSpeaks(engine, c) && (!src || langCode(c) !== src));
  }
  /** 语言框每项的副题：已有译文的「直接按译文配」，其余「先翻译再配」 */
  function dubLangMarks(codes, translated) {
    const have = {};
    (translated || []).forEach((c) => { have[c] = true; });
    const out = {};
    (codes || []).forEach((c) => { out[c] = have[c] ? '已有译文' : '先翻译'; });
    return out;
  }
  /** 换引擎后当前语言不在新表里：优先落到已有译文的第一种，否则落到表头 */
  function fallbackLang(value, allowed, translated) {
    if ((allowed || []).indexOf(value) >= 0) return value;
    const t = (translated || []).find((c) => (allowed || []).indexOf(c) >= 0);
    return t || (allowed || [])[0] || value;
  }
  /* 克隆参考（2026-09-11 改）：旧做法取「最长一句的前 6 秒」且多半不带原文，Qwen3-TTS 只能
     拿声纹向量（x-vector）比着念，加上每句随机种子，句句像换了个人。现在每位说话人挑
     **连续的几整句**、总长 5–10 秒，连同这几句的原文一起给（ICL，声音身份最稳），整个 run
     每句都用同一段参考、同一颗种子。 */
  const REF_WINDOW = {min: 5, max: 10, gap: 1.5};
  /** 选一位说话人的参考窗：同一人、在文稿里相邻、句间停顿不超过 gap 的整句串；
   *  总长落在 [min, max] 里取最长，都不到 min 取最接近的，单句就超过 max 取最短那句截到 max
   *  （截断后原文对不上，`text` 为 null，只能走声纹）。返回 {ids, start, end, text, cut} 或 null。 */
  function referenceWindow(cues, speaker, o) {
    return referenceWindows(cues, speaker, 1, o)[0] || null;
  }
  /** 一位说话人的**前 n 段**参考候选（2026-09-24「我的声音」分人页）：与 `referenceWindow` 同一套
   *  打分，按分数排，彼此不共用句子；第一项就是 `referenceWindow` 的答案。一段带内的都没有时，
   *  只回那一段截到 max 的声纹窗（cut）。没有这位的句子回空数组。 */
  function referenceWindows(cues, speaker, n, o) {
    const opt = Object.assign({}, REF_WINDOW, o || {});
    const list = cues || [];
    const want = Math.max(1, n || 1);
    const score = (span) => (span <= opt.max + 1e-9 ? (span >= opt.min - 1e-9 ? 1e6 + span : span) : -1);
    const all = [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].sp !== speaker) continue;
      for (let j = i; j < list.length; j++) {
        const c = list[j];
        if (c.sp !== speaker) break;
        if (j > i && c.start - list[j - 1].end > opt.gap) break;
        const span = c.end - list[i].start;
        if (span > opt.max + 1e-9) break;
        all.push({s: score(span), i, j});
      }
    }
    // 分数高的在前；同分先出现的在前（与单窗版「严格更大才换」同口径）
    all.sort((a, b) => b.s - a.s || a.i - b.i || a.j - b.j);
    const out = [];
    const used = new Set();
    all.forEach((w) => {
      if (out.length >= want) return;
      let clash = false;
      for (let k = w.i; k <= w.j; k++) if (used.has(k)) clash = true;
      if (clash) return;
      for (let k = w.i; k <= w.j; k++) used.add(k);
      const run = list.slice(w.i, w.j + 1);
      out.push({ids: run.map((c) => c.id), start: run[0].start, end: +run[run.length - 1].end.toFixed(2),
        text: run.map((c) => String(c.text || '').trim()).filter(Boolean).join(' '), cut: false});
    });
    if (out.length) return out;
    const mine = list.filter((c) => c.sp === speaker);
    if (!mine.length) return [];
    const c = mine.reduce((a, b) => (b.end - b.start < a.end - a.start ? b : a));
    return [{ids: [c.id], start: c.start, end: +(c.start + opt.max).toFixed(2), text: null, cut: true}];
  }
  /** 说话人行上的参考摘要：「克隆 · 连续 3 句 · 8.4 秒」 */
  function referenceLine(w) {
    if (!w) return '克隆 · 没有这位的句子';
    const secs = (w.end - w.start).toFixed(1);
    return w.cut ? `克隆 · 截 ${secs} 秒 · 仅声纹` : `克隆 · ${w.ids.length > 1 ? '连续 ' + w.ids.length + ' 句' : '1 句'} · ${secs} 秒`;
  }
  /* GPT-SoVITS 带参考文本时，官方推理只收 3–10 秒的参考音频；不带参考文本只取音色，不查时长。 */
  const GSV_REF = {min: 3, max: 10};
  /** 参考音频时长不合引擎要求时给一句话，否则 null。时长未知（刚选的本地文件）不拦，交给合成报错。 */
  function refProblem(f) {
    if (refTextRequired(f.engine) && f.mode !== 'describe' && f.ref && !String(f.refText || '').trim())
      return 'OmniVoice 克隆要写参考录音的原文：它把参考当作正文前面那一截来续，不写原文会吞掉正文开头';
    if (f.engine !== 'gptsovits' || !f.ref || typeof f.ref.dur !== 'number' || !String(f.refText || '').trim()) return null;
    if (f.ref.dur >= GSV_REF.min && f.ref.dur <= GSV_REF.max) return null;
    return `GPT-SoVITS 带参考文本时参考音频要 ${GSV_REF.min}–${GSV_REF.max} 秒（现在 ${f.ref.dur.toFixed(1)} 秒）；清空参考文本也能念`;
  }
  /** 参考录音的原文是不是必填：OmniVoice 不带原文会吞掉正文开头（内核 `ref-text-required` 同样拦），
   *  内置音色与带原文的「我的声音」自带原文，只有自己的录音要手写 */
  const refTextRequired = (engine) => engineOf(engine).id === 'omnivoice';
  /* 内置音色（2026-09-13 两段示例 → 2026-09-21 八只）：每只引擎都有默认音色，不必自己先找录音。
     八只命名音色（zh / en / ja / es × 男女）各带一段随包录音、录音的原文和一句英文描述，
     落地方式按引擎分（`builtinKind`）：只能克隆的三只与 Qwen3-TTS Base 拿录音当参考，
     Qwen3-TTS 1.7B VoiceDesign 接不了参考音频、拿那句描述造声，CustomVoice 有模型自己的 9 只说话人、不吃这张表。
     录音取 FLEURS（CC BY 4.0）与 CMU ARCTIC，6–9 秒，落在 GPT-SoVITS 带参考文本的 3–10 秒与
     克隆参考窗 5–10 秒之内。跨语言克隆这几只引擎都支持：中文参考念英语没问题，听的是音色不是口音。
     真相在 `bcut_tts::voices`，这张表照抄它。 */
  const BUILTIN_REFS = [
    {id: 'zh-female', label: '中文女声', name: '中文女声', dur: 6.72, lang: 'zh', female: true,
     text: '一般来说，卫星电话不能取代移动电话，因为只有在卫星信号畅通的室外，才能进行通话。',
     describe: 'A warm, natural young female voice speaking Mandarin Chinese at an even, unhurried pace',
     file: 'tts-voice-zh-female.wav', source: 'FLEURS · cmn_hans_cn · dev · 11138309825590803862.wav'},
    {id: 'zh-male', label: '中文男声', name: '中文男声', dur: 6.16, lang: 'zh', female: false,
     text: '游猎活动也许是非洲最吸引人的旅游活动，也是许多游客行程中的亮点。',
     describe: 'A calm, steady adult male voice speaking Mandarin Chinese, clear and even',
     file: 'tts-voice-zh-male.wav', source: 'FLEURS · cmn_hans_cn · dev · 7878925372167965477.wav'},
    {id: 'en-female', label: '英语女声', name: '英语女声', dur: 7.32, lang: 'en', female: true,
     text: 'Author of the danger trail, Philip Steels, etc. Not at this particular case, Tom, apologized Whittemore.',
     describe: 'A warm, clear adult female voice speaking American English at an even pace',
     file: 'tts-voice-en-female.wav', source: 'CMU ARCTIC · cmu_us_slt_arctic · arctic_a0001 + arctic_a0002'},
    {id: 'en-male', label: '英语男声', name: '英语男声', dur: 6.9, lang: 'en', female: false,
     text: 'Author of the danger trail, Philip Steels, etc. Not at this particular case, Tom, apologized Whittemore.',
     describe: 'A deep, steady adult male voice speaking American English, clear and even',
     file: 'tts-voice-en-male.wav', source: 'CMU ARCTIC · cmu_us_bdl_arctic · arctic_a0001 + arctic_a0002'},
    {id: 'ja-female', label: '日语女声', name: '日语女声', dur: 8.44, lang: 'ja', female: true,
     text: '州間の税法や関税を無効にする権限もありませんでした。',
     describe: 'A bright, gentle young female voice speaking Japanese at an even pace',
     file: 'tts-voice-ja-female.wav', source: 'FLEURS · ja_jp · dev · 9633305044980004895.wav'},
    {id: 'ja-male', label: '日语男声', name: '日语男声', dur: 6.4, lang: 'ja', female: false,
     text: '宇宙にある人工衛星は通話を受信して、ほぼ瞬時にそれを反映します。',
     describe: 'A calm, low adult male voice speaking Japanese, clear and even',
     file: 'tts-voice-ja-male.wav', source: 'FLEURS · ja_jp · dev · 18146068393309246703.wav'},
    {id: 'es-female', label: '西班牙语女声', name: '西班牙语女声', dur: 6.92, lang: 'es', female: true,
     text: 'Los canales navegables internos pueden ser una buena temática para las vacaciones.',
     describe: 'A warm, clear adult female voice speaking Latin American Spanish at an even pace',
     file: 'tts-voice-es-female.wav', source: 'FLEURS · es_419 · dev · 16573424493246998243.wav'},
    {id: 'es-male', label: '西班牙语男声', name: '西班牙语男声', dur: 7.86, lang: 'es', female: false,
     text: 'Cuando uno se comunica con alguien que está a miles de millas de distancia, se está haciendo uso de un satélite.',
     describe: 'A deep, steady adult male voice speaking Latin American Spanish, clear and even',
     file: 'tts-voice-es-male.wav', source: 'FLEURS · es_419 · dev · 14695292064114231662.wav'},
  ];
  const REF_CREDIT = 'FLEURS 语料（CC BY 4.0）与 CMU ARCTIC · 经裁剪与响度归一 · 保留原始声明';
  /* 行上 / 芯片里直接露出的四只，其余四只收进「更多音色」 */
  const QUICK_BUILTINS = ['zh-female', 'zh-male', 'en-female', 'en-male'];
  /** 按 id 取一只内置音色；认 2026-09-21 之前的两个旧 id */
  const REF_ALIAS = {'ref-male': 'en-male', 'ref-female': 'en-female'};
  const builtinRef = (id) => BUILTIN_REFS.find((r) => r.id === (REF_ALIAS[id] || id)) || null;
  /** 「默认音色」取哪只：先看语言，再看文本用的字，都认不出落到中文女声（与 `voices::default_for` 同口径） */
  function defaultBuiltin(lang, text) {
    const code = langCode(lang);
    const has = BUILTIN_REFS.some((r) => r.lang === code);
    const want = has ? code : scriptLang(String(text || ''));
    return BUILTIN_REFS.find((r) => r.lang === want && r.female) || BUILTIN_REFS[0];
  }
  /** 文本字形 → 语言：假名 → 日语，汉字 → 中文，其余英语 */
  function scriptLang(text) {
    if (/[\u3040-\u30ff]/.test(text)) return 'ja';
    return /[\u3400-\u4dbf\u4e00-\u9fff]/.test(text) ? 'zh' : 'en';
  }
  /** 没在快捷四只里的那几只（设置页「更多音色」） */
  const moreBuiltins = () => BUILTIN_REFS.filter((r) => QUICK_BUILTINS.indexOf(r.id) < 0);
  /** 参考来源的选项：默认音色 + 快捷四只内置音色 + 自己的音频。
   *  `all` 为真时列全部八只（设置页的「更多音色」）。 */
  function refSources(engine, all, mine) {
    const ids = all ? BUILTIN_REFS.map((r) => r.id) : QUICK_BUILTINS;
    const items = ids.map((id) => ({k: id, label: builtinRef(id).label}));
    items.push({k: 'file', label: '临时用一段'});
    // 「我的声音」（2026-09-24）：设置页存好的音色档排在默认音色后面、内置音色前面，k = `my:<id>`
    const my = (mine || []).map((v) => ({k: 'my:' + v.id, label: v.name, my: true, sub: v.text}));
    items.unshift({k: 'none', label: '默认音色'}, ...my);
    return items;
  }
  /** 当前参考落在哪个来源选项上；`picking` = 选了「临时用一段」但还没选文件 */
  function refSourceOf(ref, picking) {
    if (ref) return ref.my ? 'my:' + ref.my : (ref.builtin || 'file');
    return picking ? 'file' : 'none';
  }
  /** 切参考来源。内置示例 / 我的声音连参考文本一起换；换成自己的音频或不用参考时，清掉它们留下的原文，
   *  用户自己写的参考文本保留。`file` 是 {name, dur?}，没给就先空着等用户选；`mine` 是音色档列表。 */
  function pickRef(form, source, file, mine) {
    const wasBuiltin = BUILTIN_REFS.some((r) => r.text === form.refText)
      || (mine || []).some((v) => v.text && v.text === form.refText);
    const keepText = wasBuiltin ? '' : (form.refText || '');
    const b = builtinRef(source);
    if (b) return {ref: {builtin: b.id, name: b.name, dur: b.dur}, refText: b.text, refPicking: false};
    if (typeof source === 'string' && source.indexOf('my:') === 0) {
      const v = (mine || []).find((x) => 'my:' + x.id === source);
      if (v) return {ref: {my: v.id, name: v.name, dur: v.dur}, refText: v.text || '', refPicking: false};
    }
    // 选了「临时用一段」还没给文件：`refPicking` 把这半步记下来，免得和「默认音色」混成一个样子
    if (source === 'file') {
      return {ref: file ? Object.assign({}, file) : null, refText: keepText, refPicking: !file};
    }
    return {ref: null, refText: keepText, refPicking: false};
  }
  /** 预览草稿的初值：不带参考——每只引擎都有默认音色，打开就能生成 */
  function refDefault() {
    return {ref: null, refText: ''};
  }
  /** 设置页预览：不给参考就是默认音色，谁都不缺声音；不套项目生成的字数上限。 */
  function validatePreview(f) {
    if (!String(f.text || '').trim()) return ['先输入要合成的文本'];
    // 按描述造声音（1.7B VoiceDesign 试听）：描述就是声音本身，必填；OmniVoice 至少挑一项
    if (f.mode === 'describe') {
      if (describeByVocab(f.engine)) { const p = omniProblem(f.omni, f.lang); return p ? [p] : []; }
      return String(f.instruct || '').trim() ? [] : ['先用一句话描述想要的声音'];
    }
    if (f.refPicking && !f.ref) return ['先选一段参考音频，或换回内置音色'];
    const ref = refProblem(f);
    return ref ? [ref] : [];
  }
  /* 设置页 TTS 行（2026-09-13 二轮）：行上只留「能拿它做什么」——出声方式、要不要自己给录音、
     情绪、会念哪些语言；仓库名、语速库、组件清单收进展开的「技术信息」。一键试听用下面的
     示例句与快捷音色，按下就合成，不先填表。 */
  const LANG_SHORT = {zh: '中', en: '英', ja: '日', ko: '韩', de: '德', fr: '法', es: '西', it: '意', pt: '葡', ru: '俄', ar: '阿'};
  /** 行上的简介：{voice, needsRef, emotion, langs, summary, facts[]}
      2026-09-14 起行上也放「试听」。 */
  function modelBrief(id) {
    const spec = MODELS[id];
    if (!spec || spec.engine === 'sep') return null;
    const e = engineOf(spec.engine);
    const preset = spec.mode === 'preset';
    const describe = spec.mode === 'describe';
    const emotion = hasEmotion(spec.engine);
    const short = e.langs.map((c) => LANG_SHORT[c] || c);
    const langs = short.length > 5 ? `${short.slice(0, 4).join(' / ')} 等 ${short.length} 种语言` : short.join(' / ');
    // 一只权重同时管克隆与描述（OmniVoice）：行上两样都写
    const both = !describe && !preset && e.models.describe === id;
    const summary = both ? '八只内置音色、用一段录音克隆，或挑性别、年龄、音高造一个新声音；能按目标时长念'
      : describe ? '用一句话描述想要的声音，模型现造一个；也可以直接用八只内置音色'
        : preset ? `${PRESETS.length} 个预设音色，选一个就能念`
          : `八只内置音色，或用一段录音克隆声音${emotion ? '，情绪可调' : ''}${e.style ? '；可用一句话指定风格' : ''}`;
    const facts = [both ? '内置音色 / 克隆 / 描述' : describe ? '按描述造声音' : preset ? '预设音色' : '内置音色 / 克隆'];
    if (emotion) facts.push('情绪可调');
    if (e.style && !preset) facts.push('风格指令');
    facts.push(langs);
    return {voice: describe ? 'describe' : preset ? 'preset' : 'clone', needsRef: false, emotion, langs, summary, facts, nonCommercial: !!e.nonCommercial};
  }
  /* 试听台词（2026-09-21 重写）：十一门语言 × 三句，覆盖每只引擎会念的每一门语言
     （Qwen3-TTS 十门，IndexTTS 2.5 多一门阿拉伯语）——「会念」的语言不许在试听里选不到。
     三句各测一件事：`intro` 是一句热情洋溢的 BaoCut 自我介绍（默认，约 4 秒），
     `numbers` 专挑数字、时间与「4K」这类拉丁词，`mood` 是问句加感叹句，听停顿与语调。
     语言自称取共用语言目录，这儿不留第二份语言表。 */
  const SAMPLE_KINDS = [
    {k: 'intro', label: '介绍'},
    {k: 'numbers', label: '数字'},
    {k: 'mood', label: '语气'},
  ];
  const SAMPLE_LINES = [
    {code: 'zh', kind: 'intro', text: '欢迎使用 BaoCut！转录、翻译、配音，全都在你自己的电脑上完成。'},
    {code: 'zh', kind: 'numbers', text: '这条 4K 片段 3 分 28 秒，导出只用了 1 分 12 秒。'},
    {code: 'zh', kind: 'mood', text: '是不是快得有点不像话？而且素材从头到尾没离开过你的电脑！'},
    {code: 'en', kind: 'intro', text: 'Welcome to BaoCut! Transcribe, translate and voice over, all on your own machine.'},
    {code: 'en', kind: 'numbers', text: 'This 4K clip runs 3 minutes 28 seconds, and the export took just 1 minute 12.'},
    {code: 'en', kind: 'mood', text: "Fast, isn't it? And your footage never leaves your computer!"},
    {code: 'ja', kind: 'intro', text: 'BaoCut へようこそ！文字起こしも翻訳も吹き替えも、ぜんぶ自分のパソコンで終わります。'},
    {code: 'ja', kind: 'numbers', text: 'この 4K クリップは 3 分 28 秒、書き出しはたったの 1 分 12 秒でした。'},
    {code: 'ja', kind: 'mood', text: '驚くほど速いでしょう？素材は一度もパソコンから出ていません！'},
    {code: 'ko', kind: 'intro', text: 'BaoCut에 오신 것을 환영합니다! 전사, 번역, 더빙까지 모두 내 컴퓨터에서 끝납니다.'},
    {code: 'ko', kind: 'numbers', text: '이 4K 클립은 3분 28초이고, 내보내기는 1분 12초밖에 걸리지 않았습니다.'},
    {code: 'ko', kind: 'mood', text: '놀랄 만큼 빠르죠? 게다가 소재는 컴퓨터 밖으로 나가지 않습니다!'},
    {code: 'es', kind: 'intro', text: '¡Bienvenido a BaoCut! Transcribe, traduce y dobla, todo en tu propio equipo.'},
    {code: 'es', kind: 'numbers', text: 'Este clip en 4K dura 3 minutos y 28 segundos, y exportarlo llevó solo 1 minuto y 12.'},
    {code: 'es', kind: 'mood', text: '¿A que es rapidísimo? ¡Y tu material nunca sale de tu ordenador!'},
    {code: 'de', kind: 'intro', text: 'Willkommen bei BaoCut! Transkribieren, Übersetzen und Vertonen, alles auf deinem eigenen Rechner.'},
    {code: 'de', kind: 'numbers', text: 'Dieser 4K-Clip dauert 3 Minuten und 28 Sekunden, der Export nur 1 Minute 12.'},
    {code: 'de', kind: 'mood', text: 'Ganz schön schnell, oder? Und dein Material verlässt deinen Rechner nie!'},
    {code: 'fr', kind: 'intro', text: 'Bienvenue dans BaoCut ! Transcription, traduction et doublage, tout se passe sur votre ordinateur.'},
    {code: 'fr', kind: 'numbers', text: "Ce clip 4K dure 3 minutes 28, et l'export n'a pris qu'une minute 12."},
    {code: 'fr', kind: 'mood', text: 'Plutôt rapide, non ? Et vos rushes ne quittent jamais votre ordinateur !'},
    {code: 'it', kind: 'intro', text: 'Benvenuto in BaoCut! Trascrizione, traduzione e doppiaggio, tutto sul tuo computer.'},
    {code: 'it', kind: 'numbers', text: "Questa clip in 4K dura 3 minuti e 28 secondi, e l'esportazione ha richiesto solo 1 minuto e 12."},
    {code: 'it', kind: 'mood', text: 'Veloce, vero? E il tuo materiale non lascia mai il computer!'},
    {code: 'pt', kind: 'intro', text: 'Bem-vindo ao BaoCut! Transcrição, tradução e dublagem, tudo no seu próprio computador.'},
    {code: 'pt', kind: 'numbers', text: 'Este clipe em 4K tem 3 minutos e 28 segundos, e a exportação levou apenas 1 minuto e 12.'},
    {code: 'pt', kind: 'mood', text: 'Rápido, não é? E o seu material nunca sai do seu computador!'},
    {code: 'ru', kind: 'intro', text: 'Добро пожаловать в BaoCut! Расшифровка, перевод и озвучка — всё на вашем компьютере.'},
    {code: 'ru', kind: 'numbers', text: 'Этот 4K-фрагмент длится 3 минуты 28 секунд, а экспорт занял всего 1 минуту 12 секунд.'},
    {code: 'ru', kind: 'mood', text: 'Быстро, правда? И ваши материалы никогда не покидают компьютер!'},
    {code: 'ar', kind: 'intro', text: 'مرحبًا بك في BaoCut! التفريغ والترجمة والدبلجة، كلها تتم على جهازك.'},
    {code: 'ar', kind: 'numbers', text: 'هذا المقطع بدقة 4K مدته 3 دقائق و28 ثانية، والتصدير استغرق دقيقة و12 ثانية فقط.'},
    {code: 'ar', kind: 'mood', text: 'سريع، أليس كذلك؟ وموادك لا تغادر جهازك أبدًا!'},
  ];
  /** 语言 chip 上的名字：语言目录里的母语名 */
  const langLabel = (code) => CATALOG.native(code);
  /** 这只模型能试听哪几门语言（引擎会念、且有示例句的），按示例表的次序 */
  function sampleLangs(id) {
    const spec = MODELS[id] || {};
    const seen = [];
    SAMPLE_LINES.forEach((l) => {
      if (engineSpeaks(spec.engine, l.code) && seen.indexOf(l.code) < 0) seen.push(l.code);
    });
    return seen.map((code) => ({code, label: langLabel(code)}));
  }
  /** 这门语言有哪几种台词 */
  function sampleKinds(code) {
    return SAMPLE_KINDS.filter((k) => SAMPLE_LINES.some((l) => l.code === code && l.kind === k.k));
  }
  /** 按语言 + 台词种类取示例句；缺这一种就退到这门语言的第一句，再退到表头 */
  function sampleLine(code, kind) {
    return SAMPLE_LINES.find((l) => l.code === code && l.kind === kind)
      || SAMPLE_LINES.find((l) => l.code === code)
      || SAMPLE_LINES[0];
  }
  /* CustomVoice 行上直接露出的四个音色，男女各两；其余五个收进「更多音色」 */
  const QUICK_PRESETS = ['Vivian', 'Serena', 'Eric', 'Uncle_Fu'];
  /* 「按描述造声音」的三句现成描述 + 自己描述；描述文本就是 `bcut tts --instruct` 的参数，给
     Qwen3-TTS 1.7B VoiceDesign 用（OmniVoice 只认词表，用 `OMNI_PRESETS`）。 */
  const DESCRIBE_VOICES = [
    {k: 'warm', label: '温暖女声', instruct: '温暖、亲切的成年女声，语速适中，像在和朋友聊天'},
    {k: 'anchor', label: '沉稳男声', instruct: '沉稳、清晰的成年男声，播音腔，节奏平稳'},
    {k: 'bright', label: '明快少年', instruct: '明快、有活力的少年声音，语气轻松'},
  ];
  /* 试听的语气（2026-09-21）。两条路各管一段引擎，别互换：
     `instruct` 是 Qwen3-TTS CustomVoice 的一句自然语言风格指令（`bcut tts --instruct`），
     `emotion` 是 IndexTTS2 / 2.5 的八维情感向量里点亮的那一维。Base 与 GPT-SoVITS
     两样都不认，根本不画这一行；VoiceDesign 的语气就是它那句声音描述，也不重复画。
     热情洋溢排第一，也是试听的默认——设置页的试听是听「它念 BaoCut 的介绍好不好听」。 */
  const INSTRUCT_TONES = [
    {k: 'upbeat', label: '热情洋溢', instruct: '用热情洋溢、充满活力的语气，语速略快'},
    {k: 'natural', label: '自然'},
    {k: 'anchor', label: '沉稳', instruct: '用沉稳、清晰的播音腔，节奏平稳'},
    {k: 'soft', label: '轻声', instruct: '放轻声音，语速放慢，像在近处轻声说话'},
  ];
  const EMOTION_TONES = [
    {k: 'upbeat', label: '热情洋溢', emotion: 'happy', level: 0.8},
    {k: 'natural', label: '自然'},
    {k: 'anchor', label: '沉稳', emotion: 'calm', level: 0.8},
    {k: 'surprised', label: '惊讶', emotion: 'surprised', level: 0.8},
  ];
  /** 这只模型能改语气吗、能改成哪几档；不能改的给空表（那一行不画） */
  function quickTones(id) {
    const spec = MODELS[id] || {};
    if (spec.mode === 'preset') return INSTRUCT_TONES;
    if (spec.mode !== 'describe' && hasEmotion(spec.engine)) return EMOTION_TONES;
    return [];
  }
  /** 按 k 取一档语气；认不出（换了模型、旧草稿）回中立档，没有这一行时回 null */
  function quickTone(id, k) {
    const tones = quickTones(id);
    return tones.find((t) => t.k === k) || tones.find((t) => t.k === 'natural') || null;
  }
  /** 试听前要先说清楚的一句；没有就返回 null。 */
  function quickSlow(id) {
    const spec = MODELS[id] || {};
    if (spec.mode === 'describe') return '声音完全由这句描述决定：换一句描述就是另一个人，没有预设音色可选';
    if (spec.engine === 'voxcpm2') return '大约一倍实时：一句念多长就要等多久，首次加载约 5 秒';
    if (engineOf(spec.engine).nonCommercial) return '仅限非商用（CC-BY-NC-4.0）：做要商用的内容请换别的模型';
    return null;
  }
  /** 快捷音色：预设模型给四个预设；其余给参考来源（默认音色 / 快捷四只内置音色 / 我的音频）；
   *  按描述造声音的给三句现成描述 + 自己描述（k = 'describe'） */
  function quickVoices(id, mine) {
    const spec = MODELS[id] || {};
    if (spec.mode === 'describe') {
      // VoiceDesign 接不了参考音频：同一组内置音色在它身上是一句英文描述（`voices::style_for`）
      const builtins = QUICK_BUILTINS.map((k) => ({k, label: builtinRef(k).label, sub: builtinRef(k).describe}));
      return builtins
        .concat(DESCRIBE_VOICES.map((v) => ({k: v.k, label: v.label, sub: v.instruct})))
        .concat([{k: 'describe', label: '自己描述'}]);
    }
    if (spec.mode === 'preset') {
      return QUICK_PRESETS.map((k) => {
        const p = PRESETS.find((x) => x.id === k);
        return {k, label: p.sub, sub: p.id};
      });
    }
    return refSources(spec.engine, false, mine);
  }
  /** 试听的初始选择：第一种示例语言 + 那句 BaoCut 的自我介绍 + 预设 Vivian /
   *  其余用这门语言的内置音色 + 这只模型的头一档语气（能改语气的就是「热情洋溢」） */
  function quickDefaults(id) {
    const spec = MODELS[id] || {};
    const langs = sampleLangs(id);
    const lang = langs.length ? langs[0].code : 'zh';
    const voice = spec.mode === 'preset' ? QUICK_PRESETS[0] : defaultBuiltin(lang, '').id;
    const tones = quickTones(id);
    return {lang, kind: 'intro', voice, tone: tones.length ? tones[0].k : 'natural', custom: '', describe: ''};
  }
  /** 试听选择 → 预览表单（喂 validatePreview / 合成）。custom 非空时念自定义文本；voice = 'file' 时 file 是用户选的录音。
   *  语气按引擎落地：CustomVoice 落成 instruct，IndexTTS 两代落成 emotion，其余引擎不带。 */
  function quickForm(id, pick, file, mine) {
    const spec = MODELS[id] || {};
    const p = Object.assign(quickDefaults(id), pick || {});
    // 换了示例语言但没点音色：默认音色跟着语言走（与 `voices::default_for` 同口径）
    if (!(pick && pick.voice) && spec.mode !== 'preset') p.voice = defaultBuiltin(p.lang, '').id;
    const line = sampleLine(p.lang, p.kind);
    const text = String(p.custom || '').trim() ? p.custom : line.text;
    const base = {text, engine: spec.engine, mode: spec.mode};
    const tone = quickTone(id, p.tone);
    if (tone && tone.k !== 'natural') {
      base.tone = tone.k;
      if (tone.instruct) base.instruct = tone.instruct;
      if (tone.emotion) { base.emotion = tone.emotion; base.emoLevel = tone.level; }
    }
    if (spec.mode === 'describe') {
      const b = builtinRef(p.voice);
      const v = DESCRIBE_VOICES.find((x) => x.k === p.voice);
      const instruct = b ? b.describe : v ? v.instruct : String(p.describe || '');
      return Object.assign(base, {preset: null, ref: null, refText: '', instruct, builtin: b ? b.id : null});
    }
    if (spec.mode === 'preset') {
      const known = PRESETS.some((x) => x.id === p.voice);
      return Object.assign(base, {preset: known ? p.voice : QUICK_PRESETS[0], ref: null, refText: ''});
    }
    return Object.assign(base, {preset: null}, pickRef({refText: ''}, p.voice, file, mine));
  }
  /** 试听结果行：「Vivian · 中文 · 用时 1.6 秒 · 音频约 3.9 秒」 */
  function quickSummary(form, pick, elapsed) {
    // 内置音色只写「中文女声」：录音语言与念的语言不必并列，免得读成「英语 · 中文」
    const b = form.ref && builtinRef(form.ref.builtin);
    const quick = form.mode === 'describe' && DESCRIBE_VOICES.find((x) => x.instruct === form.instruct);
    const described = form.mode === 'describe' && builtinRef(form.builtin);
    const voice = form.mode === 'preset' ? form.preset
      : form.mode === 'describe' ? (described ? described.label : quick ? quick.label : '自己描述')
      : b ? b.label : form.ref ? form.ref.name : '默认音色';
    const custom = pick && String(pick.custom || '').trim();
    const code = pick && pick.lang;
    const kind = SAMPLE_KINDS.find((k) => k.k === (pick && pick.kind));
    // 台词不是那句介绍时把它写出来；语气不是默认那档时跟在音色后面——结果行得说清
    // 这一段是用什么语气念的哪一句。
    const said = code ? (kind && kind.k !== 'intro' ? `${langLabel(code)} · ${kind.label}` : langLabel(code)) : '';
    const tone = form.tone && INSTRUCT_TONES.concat(EMOTION_TONES).find((t) => t.k === form.tone);
    const parts = [tone ? `${voice} · ${tone.label}` : voice, custom ? '自定义文本' : said];
    if (typeof elapsed === 'number') parts.push(`用时 ${elapsed.toFixed(1)} 秒`);
    parts.push(`音频约 ${estimateDuration(form.text).toFixed(1)} 秒`);
    return parts.filter(Boolean).join(' · ');
  }
  /** 试听结果的身份：同一身份的结果就是「现在这组选择」念出来的。选择一变，旧结果就只是上一次的，
   *  面板要说清楚、并让用户自己点「生成试听」——芯片只改选择，不触发合成。 */
  function quickKey(form) {
    const r = form.ref;
    return JSON.stringify([form.engine, form.mode, form.text, form.preset || '', r ? (r.my ? 'my:' + r.my : r.builtin || r.name) : '', form.instruct || '', form.builtin || '', form.tone || '',
      form.mode === 'describe' && describeByVocab(form.engine) ? omniInstruct(form.omni) : '', knobArgs(form.engine, form.knobs).map((a) => a.k + '=' + a.v).join(',')]);
  }
  /** 生成表单校验。返回错误列表（空即可跑）——按钮不置灰，按下再说清哪里缺。 */
  function validate(f) {
    const errs = [];
    const text = String(f.text || '').trim();
    if (!text) errs.push('先写要合成的文字');
    if (text.length > 2000) errs.push('一次最多 2000 字，超出的分两次');
    // 「克隆声音」这一档是用户自己点的，当然要有录音；引擎缺不缺默认音色已经无关了
    if (f.mode === 'clone' && !f.ref) errs.push('克隆声音要先给参考音频');
    if (f.mode === 'describe') {
      // OmniVoice 看挑了哪几项，不看残留的 instruct（从别的引擎切过来时可能还留着一句自由描述）
      if (describeByVocab(f.engine)) { const p = omniProblem(f.omni, f.lang); if (p) errs.push(p); }
      else if (!String(f.instruct || '').trim()) errs.push('先用一句话描述想要的声音');
    }
    const ref = refProblem(f);
    if (ref) errs.push(ref);
    if (hasEmotion(f.engine) && f.emotion === 'ref2' && !f.emoRef) errs.push('情绪选了另给一段音频，先把那段音频选上');
    return errs;
  }
  /** 按句号 / 问号 / 感叹号 / 换行切段，n/N 的 N 就是它。 */
  function segments(text) {
    return String(text || '').split(/(?<=[。！？!?])\s*|(?<=\.)\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  }
  /** 合成时长估算（秒）——素材卡上的时长与「压到原句」的比对都读它 */
  function estimateDuration(text) {
    const t = bare(text).trim();
    if (!t) return 0;
    const cjk = (t.match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length;
    const latinWords = (t.replace(/[぀-ヿ㐀-鿿가-힯]/g, ' ').match(/[A-Za-z0-9']+/g) || []).length;
    const pauses = (t.match(/[，,。.!！?？;；]/g) || []).length;
    return +(cjk / CJK_CPS + latinWords / LATIN_WPS + pauses * 0.18).toFixed(1);
  }
  /** 单段生成的阶段：加载模型 → 合成第 n/N 段 → 完成。pct 0–100。
   *  云端（第三参给 API 提供方名）没有权重可加载：连接 → 发送第 n/N 段 → 完成，段间等的是网络不是显存。 */
  const GEN_STAGES = ['加载模型', '合成', '完成'];
  const CLOUD_STAGES = ['连接', '发送', '完成'];
  const genStages = (provider) => (provider ? CLOUD_STAGES : GEN_STAGES);
  function genPhase(pct, n, provider) {
    const N = Math.max(1, n || 1);
    if (pct >= 100) return {cur: 2, label: '完成', activity: provider ? '拼接各段 · 写 WAV' : '写 WAV · 48 kHz'};
    if (pct < 12) return provider ? {cur: 0, label: `连接 ${provider}`, activity: `连接 ${provider}`} : {cur: 0, label: '加载模型', activity: '读权重到显存'};
    const k = Math.min(N, 1 + Math.floor(((pct - 12) / 88) * N));
    return provider ? {cur: 1, label: `发送第 ${k}/${N} 段`, activity: `发送第 ${k}/${N} 段 · 等回包`}
      : {cur: 1, label: `合成第 ${k}/${N} 段`, activity: `合成第 ${k}/${N} 段`};
  }
  /** 任务记录里的 sub 行 */
  function genSub(f) {
    const eng = engineOf(f.engine);
    if (eng.cloud) {
      const C = CLOUD();
      const model = String(f.cloudModel || eng.models.preset).split('/').pop();
      return `${eng.name} · ${model} · ${C.voiceLabel(eng.provider, f.cloudVoice, f.voices || [], {lang: f.lang})} · ${segments(f.text).length} 段`;
    }
    const voice = f.mode === 'describe' ? '描述 · ' + (describeText(f) || '一句话造声音')
      : cloneOnly(f.engine) || f.mode === 'clone' ? '克隆 · ' + (f.ref ? f.ref.name : '参考音频')
        : '预设 · ' + (f.preset || PRESETS[0].id);
    return `${eng.family || eng.name} · ${voice} · ${segments(f.text).length} 段`;
  }
  /** 生成结果落成素材卡的记录（进 sources.audio，来源章「TTS」） */
  function asSource(f, seq, elapsed) {
    const dur = estimateDuration(f.text);
    const eng = engineOf(f.engine);
    const mm = Math.floor(dur / 60), ss = Math.round(dur % 60);
    const khz = eng.cloud ? `${Math.round((CLOUD().capabilities(eng.provider).rate || 24000) / 1000)} kHz` : '48 kHz';
    return {
      id: 'tts' + seq, name: `tts-${seq}.wav`,
      meta: `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')} · ${khz} · ${eng.family || eng.name} · ${elapsed}`,
      dur, badge: 'TTS', tts: Object.assign({}, f),
    };
  }

  /* ---------- 语速库（§17.3 / 配音设计稿 §10） ----------
     每只 TTS 模型 × 每种语言一条：一分钟念多少字（中日韩按字）或多少词（英文等按词），
     给一个范围（p10 / 中位 / p90）。Qwen3-TTS 与 IndexTTS2 官方都没有公布语速，
     种子值来自我们自己的测量；之后每合成一句就更新一次。App 与 CLI 共用一份文件：
       macOS  ~/Library/Application Support/BaoCut/tts-pace.json
       Windows %LOCALAPPDATA%\bcut\tts-pace.json
     原型这里只演示：种子表 + 更新函数 + 用它预测语速与装得下多少字。 */
  const PACE_FILE = 'tts-pace.json';
  const PACE_PATH = '~/Library/Application Support/BaoCut/tts-pace.json';
  const PACE_KEEP = 50;             // 每条最多留 50 个最近样本算分位
  const PACE_WARMUP = 5;            // 样本不足 5 个时与种子按样本数加权
  const CJK_LANGS = {zh: 1, ja: 1, ko: 1};
  function paceUnit(lang) { return CJK_LANGS[langCode(lang)] ? 'char' : 'word'; }
  const unitName = (u) => (u === 'char' ? '字' : '词');
  const seed = (unit, p10, median, p90) => ({unit, perMin: {p10, median, p90}, samples: 0, source: 'seed', recent: []});
  const PACE_SEED = {
    'qwen3-tts-0.6b-customvoice': {zh: seed('char', 230, 268, 310), ja: seed('char', 250, 290, 340), ko: seed('char', 200, 240, 280), en: seed('word', 130, 150, 172)},
    'qwen3-tts-0.6b-base':        {zh: seed('char', 225, 262, 305), ja: seed('char', 245, 285, 335), ko: seed('char', 195, 235, 275), en: seed('word', 128, 148, 170)},
    'indextts2':                  {zh: seed('char', 220, 255, 295), en: seed('word', 125, 145, 165)},
    'index-tts2.5':               {zh: seed('char', 252, 269, 306), en: seed('word', 138, 174, 206)},
    'gpt-sovits-v2':              {zh: seed('char', 196, 228, 286), en: seed('word', 161, 189, 225)},
    /* Qwen3-TTS 1.7B（三只）、VoxCPM2、OmniVoice 还没有实测种子：`paceFor` 落到按单位的 DEFAULT_PACE，
       跑过几次配音后由 `paceUpdate` 按实测补上——不凭感觉先写一行。 */
  };
  const DEFAULT_PACE = {char: seed('char', 220, 260, 300), word: seed('word', 120, 145, 170)};
  /** 中日韩句子里一串拉丁字母按音节折成几个「字」（配音设计稿 §10，与 `bcut_lang::pace::latin_units` 同一条规则）：
   *  大小写交界处切段（ChatGPT → Chat + GPT），全大写且 ≤ 4 个字母或没有元音的段逐字母（AI 2 · GPU 3），
   *  其余按元音组数、词尾不发音的 e 不算、至少 1（Transformer 3 · Claude 1 · Google 2） */
  function latinUnits(run) {
    return (String(run).replace(/[^A-Za-z]/g, '').match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g) || []).reduce((n, part) => {
      if (part === part.toUpperCase() && (part.length <= 4 || !/[AEIOUY]/.test(part))) return n + part.length;
      const w = part.toLowerCase();
      const groups = (w.match(/[aeiouy]+/g) || []).length;
      return n + Math.max(1, groups - (groups > 1 && /[^el]e$/.test(w) ? 1 : 0));
    }, 0);
  }
  /** 数一段文字的单位：中日韩按字（汉字 / 假名 / 谚文 / 数字各一，英文按音节折算，标点空白不计），其余按词；
   *  `<字|读音>` 注记先去掉，只数表面文字 */
  function countUnits(text, lang) {
    const t = bare(text);
    if (paceUnit(lang) === 'char') {
      return (t.match(/[A-Za-z]+(?:['’][A-Za-z]+)*|[぀-ヿ㐀-鿿가-힯0-9]/g) || [])
        .reduce((n, m) => n + (/[A-Za-z]/.test(m) ? latinUnits(m) : 1), 0);
    }
    return (t.match(/[A-Za-z0-9À-ÿ']+/g) || []).length;
  }
  /** 取某只模型某种语言的语速：库里有测量值用测量值，没有回种子，种子也没有按单位给默认 */
  function paceFor(lib, model, lang) {
    const code = langCode(lang);
    const hit = lib && lib[model] && lib[model][code];
    if (hit) return hit;
    const s = PACE_SEED[model] && PACE_SEED[model][code];
    return s || DEFAULT_PACE[paceUnit(code)];
  }
  const quantile = (arr, q) => {
    const a = arr.slice().sort((x, y) => x - y);
    if (!a.length) return 0;
    const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  };
  /** 一次合成结束后更新：sample = {units, seconds}。返回新库，不改入参。
   *  最近 PACE_KEEP 个样本重算 p10 / 中位 / p90；头几次与种子按样本数加权，免得一句话把范围带偏。 */
  function paceUpdate(lib, model, lang, sample, now) {
    if (!sample || !(sample.seconds > 0) || !(sample.units > 0)) return lib || {};
    const code = langCode(lang);
    const cur = paceFor(lib, model, code);
    const x = +((sample.units / sample.seconds) * 60).toFixed(1);
    const recent = (cur.recent || []).concat([x]).slice(-PACE_KEEP);
    const w = Math.min(1, recent.length / PACE_WARMUP);
    const base = (PACE_SEED[model] && PACE_SEED[model][code]) || DEFAULT_PACE[cur.unit];
    const mix = (q, b) => Math.round(quantile(recent, q) * w + b * (1 - w));
    const entry = {unit: cur.unit, perMin: {p10: mix(0.1, base.perMin.p10), median: mix(0.5, base.perMin.median), p90: mix(0.9, base.perMin.p90)},
      samples: (cur.samples || 0) + 1, source: 'measured', recent, updatedAt: now || ''};
    const out = Object.assign({}, lib || {});
    out[model] = Object.assign({}, out[model] || {}, {[code]: entry});
    return out;
  }
  /** 设置页那一行：`中文 ≈ 268 字/分（230–310 · 种子值）` / `（… · 12 次生成）` */
  function paceLine(pace, lang) {
    const L = LANGS.concat(DUB_LANGS).find((l) => l.code === langCode(lang)) || {name: lang};
    return `${L.name} ≈ ${pace.perMin.median} ${unitName(pace.unit)}/分（${pace.perMin.p10}–${pace.perMin.p90} · ${pace.samples ? pace.samples + ' 次生成' : '种子值'}）`;
  }
  /** 用语速库预测一句要念多久（秒）与相对槽位的语速 */
  function predictRate(text, slotDur, pace, lang) {
    const units = countUnits(text, lang);
    const secs = units / (pace.perMin.median / 60);
    return {units, secs: +secs.toFixed(2), rate: +(secs / Math.max(0.1, slotDur)).toFixed(2)};
  }
  /** 这一槽位按中位语速 1.0× 装得下多少字 / 词 */
  function budgetUnits(slotDur, pace) { return Math.max(1, Math.floor((slotDur * pace.perMin.median) / 60)); }
  /** 一句最多能占到哪：到下一句开口前留 GAP，最后一句就是自己的槽位 */
  function limitOf(cues, i) {
    const c = cues[i], next = cues[i + 1];
    const slot = c.end - c.start;
    return next ? Math.max(slot, next.start - c.start - GAP) : slot;
  }
  /** 「按时长整理译文」的计划（§15.4 可选步骤）：每句一行
   *  {id, start, end, sp, source, text, units, budget, rate, level}
   *  level：ok ≤ 1.0 · tight ≤ MAX_RATE（不用改）· over > MAX_RATE（要缩写）· retranslate > RETRANS_RATE（建议重译） */
  function fitPlan(cues, o) {
    const opt = o || {};
    const pace = opt.pace || paceFor(opt.lib, opt.model, opt.lang);
    const list = cues || [];
    const script = opt.script || {};
    const rows = list.map((c, i) => {
      const text = bare(script[c.id] != null ? script[c.id] : (c.trans || ''));   // 注记不上对比页，只看字
      const limit = limitOf(list, i);
      const p = predictRate(text, limit, pace, opt.lang);
      const level = p.rate > RETRANS_RATE ? 'retranslate' : p.rate > MAX_RATE ? 'over' : p.rate > 1 ? 'tight' : 'ok';
      return {id: c.id, start: c.start, end: c.end, limit: +limit.toFixed(2), sp: c.sp, source: c.text || '', text,
        units: p.units, budget: budgetUnits(limit, pace), rate: p.rate, level};
    });
    const n = (lv) => rows.filter((r) => r.level === lv).length;
    return {rows, pace, unit: pace.unit, total: rows.length, ok: n('ok') + n('tight'), over: n('over'), retranslate: n('retranslate')};
  }
  /** 演示用的 LLM 整理结果：把超出预算的句缩到预算内——中日韩按字截、其余按词截，
   *  结果确定、看得出变短了；产品里这一步是真调 LLM，提示词见配音设计稿 §11。 */
  function demoRewrite(row, lang, pace) {
    if (!row || (row.level !== 'over' && row.level !== 'retranslate')) return null;
    // 演示版「LLM 缩写」：先去口头填充词与破折号后的补充，还装不下再按预算裁到句号
    let text;
    if (paceUnit(lang) === 'char') {
      text = String(row.text).replace(/(嗯|就是说|就是|那个|然后|其实|对，|呃)/g, '').replace(/——.*$/, '').trim();
      if (countUnits(text, lang) > row.budget) text = text.slice(0, Math.max(2, row.budget)).replace(/[，、,。.\s]+$/, '');
      if (!/[。！？]$/.test(text)) text += '。';
    } else {
      text = String(row.text).replace(/^(?:(?:uh|um|so|well|like|right|okay|yeah|and)[,]?\s+)+/i, '').replace(/\s+—.*$/, '').trim();
      text = text.charAt(0).toUpperCase() + text.slice(1);
      if (countUnits(text, lang) > row.budget) text = text.split(/\s+/).slice(0, Math.max(3, row.budget)).join(' ').replace(/[,;:\s]+$/, '');
      if (!/[.!?]$/.test(text)) text += '.';
    }
    const p = pace ? predictRate(text, row.limit, pace, lang) : {units: countUnits(text, lang), rate: 1};
    return {id: row.id, text, kind: row.level === 'retranslate' ? 'retranslate' : 'shorten', units: p.units, rate: p.rate};
  }
  /** 计划里的一行换上新文字后重算（人工校对编辑走这里） */
  function replanRow(row, text, pace, lang) {
    const p = predictRate(text, row.limit, pace, lang);
    const level = p.rate > RETRANS_RATE ? 'retranslate' : p.rate > MAX_RATE ? 'over' : p.rate > 1 ? 'tight' : 'ok';
    return Object.assign({}, row, {text, units: p.units, rate: p.rate, level});
  }

  /* ---------- 翻译配音 ---------- */
  /* 阶段表：翻译只在目标语言还没译文时出现，分离只在开了「分离背景声」时出现。
     权重按出现的阶段归一到 100。 */
  const STAGE_DEFS = [
    {key: 'translate', label: '翻译字幕', w: 20},
    {key: 'separate', label: '分离人声与背景', w: 30},
    {key: 'synth', label: '逐句合成', w: 55},
    {key: 'align', label: '时间对齐', w: 10},
    {key: 'write', label: '写入时间轴', w: 5},
  ];
  const DUB_STAGES = STAGE_DEFS.filter((s) => s.key !== 'translate').map((s) => s.label);
  function dubStageDefs(o) {
    return STAGE_DEFS.filter((s) => (s.key === 'translate' ? !!(o && o.translate) : s.key === 'separate' ? !(o && o.separate === false) : true));
  }
  function dubStages(o) { return dubStageDefs(o).map((s) => s.label); }
  /** 分离要跑几窗 */
  function sepWindows(duration) {
    return Math.max(1, Math.ceil((duration || 0) / SEP_WINDOW));
  }
  /** 配音进度 → 阶段与活动行；`cur` 指向 `dubStages(o)` 里的下标。 */
  function dubPhase(pct, o) {
    const opt = o || {};
    const n = Math.max(1, opt.sentences || 1);
    const wins = sepWindows(opt.duration);
    const defs = dubStageDefs(opt);
    const total = defs.reduce((a, s) => a + s.w, 0);
    const trackName = '配音' + (opt.langName ? ' · ' + opt.langName : '');
    const done = {cur: defs.length - 1, key: 'write', label: '写入时间轴', activity: `写「${trackName}」轨${opt.separate === false ? '' : '与「背景声」轨'}`};
    if (pct >= 100) return done;
    let acc = 0;
    for (let i = 0; i < defs.length; i++) {
      const w = (defs[i].w / total) * 100;
      if (pct < acc + w) {
        const frac = (pct - acc) / w;
        const k = (m) => Math.min(m, 1 + Math.floor(frac * m));
        const key = defs[i].key;
        if (key === 'translate') return {cur: i, key, label: `翻译第 ${k(n)}/${n} 句`, activity: `翻成${opt.langName || '目标语言'} · 第 ${k(n)}/${n} 句`};
        if (key === 'separate') return {cur: i, key, label: `分离 ${k(wins)}/${wins} 窗`, activity: `${opt.sepAt ? '在 ' + opt.sepAt + ' 上 · ' : ''}HTDemucs-FT · 第 ${k(wins)}/${wins} 窗 · 每窗 ${SEP_WINDOW} s`};
        if (key === 'synth') {
          const sp = opt.speakerAt ? opt.speakerAt(k(n) - 1) : '';
          return {cur: i, key, label: `合成第 ${k(n)}/${n} 句`, activity: `合成第 ${k(n)}/${n} 句${sp ? ' · ' + sp : ''}`};
        }
        if (key === 'align') return {cur: i, key, label: '时间对齐', activity: '按原句槽位压缩 / 借空档 · 记录每句语速'};
        return done;
      }
      acc += w;
    }
    return done;
  }
  /** 一句合成音对齐到原句槽位。`limitDur` 是这一句最多能占到的长度（到下一句开口为止，默认等于槽位）。
   *  返回 {rate, dur, overrun, fast, cut}：overrun = 超出了原句槽位（借了空档或盖到下一句），
   *  fast = 语速快过 MAX_RATE，cut = 被截断（只有 truncate 策略会）。 */
  function fitSentence(synthDur, slotDur, policy, limitDur) {
    const s = Math.max(0.1, synthDur || 0.1);
    const slot = Math.max(0.1, slotDur || 0.1);
    const limit = Math.max(slot, limitDur || slot);
    const out = (rate, dur, cut) => ({rate: +rate.toFixed(2), dur: +dur.toFixed(2), overrun: dur > slot + 0.05, fast: rate > MAX_RATE + 1e-9, cut: !!cut});
    if (policy === 'fixed' || policy === 'overrun') return out(1, s, false);
    if (s <= slot) return out(1, s, false);
    if (policy === 'truncate') {
      const rate = Math.min(MAX_RATE, s / slot);
      const dur = s / rate;
      return out(rate, Math.min(dur, slot), dur > slot + 0.05);
    }
    // compress：先压进原句槽位；1.35× 压不进就借下一句前的空档；空档也不够就继续加速——不截
    const inSlot = s / slot;
    if (inSlot <= MAX_RATE) return out(inSlot, slot, false);
    const rate = Math.max(MAX_RATE, s / limit);
    return out(rate, s / rate, false);
  }
  /** 说话人 → 时间轴块的色相名（S2 token 族）。按说话人表顺序轮转。 */
  const SPEAKER_HUES = ['blue', 'green', 'orange', 'purple', 'magenta', 'indigo'];
  function speakerHue(index) {
    return SPEAKER_HUES[((index % SPEAKER_HUES.length) + SPEAKER_HUES.length) % SPEAKER_HUES.length];
  }
  /** 配音轨 id：一种语言一条，重跑与重试都写回同一条（不再一次 run 一条）。 */
  function dubTrackId(lang) { return 'dub:' + (langCode(lang) || 'und'); }
  /** 由字幕 cue 派生配音块：一句一块，时长按 fit 策略；`failed` 是没合成出来的句 id 集合；
   *  `script` 是「按时长整理」后的配音稿（稀疏：只有被改过的句），没改的句念译文。
   *  配音稿里的句可以带 `<字|读音>` 注记（注音步写的）：块上只存表面文字，注记进 `readings`，
   *  这只引擎（`opt.engine`）没按注音念的进 `readingsDropped`。 */
  function dubBlocks(cues, o) {
    const opt = o || {};
    const order = opt.speakerOrder || [];
    const failed = opt.failed || {};
    const policy = opt.fit || 'compress';
    const script = opt.script || {};
    const list = cues || [];
    return list.map((c, i) => {
      const slot = c.end - c.start;
      const limit = limitOf(list, i);
      const raw = script[c.id] != null ? String(script[c.id]) : ((c.trans && String(c.trans)) || c.text || '');
      const rd = RD ? RD.forEngine(raw, opt.engine) : {text: raw, readings: [], dropped: []};
      const text = rd.text;
      const synth = opt.synthDur ? opt.synthDur(c, i, text) : estimateDuration(text);
      let f = fitSentence(synth, slot, policy, limit);
      /* 能按目标时长合成的引擎（OmniVoice）：「压到下一句前」策略下，要压的那句（自然时长超过原句）
         把算好的目标长度直接交给引擎，出来就是这么长，不再事后变速——`rate` 仍记隐含的语速
         （自然时长 / 目标时长）。装得下的句照自然语速念，不拉长。
         「压缩并截断」要守 1.35× 的上限、截尾，照旧走事后处理；目标超过引擎上限（60 秒）的那句也退回普通做法。
         隐含语速快过 MAX_RATE 的也退回：实测按 1.5× 以上的目标长度合成会吞字（目标 4 秒念 6 秒的句丢了第一个分句），
         事后加速至少不丢字。 */
      let timed = false;
      const cap = opt.engine ? (engineOf(opt.engine).duration || 0) : 0;
      if (cap && policy === 'compress' && Math.max(0.1, synth) > slot) {
        const target = f.dur;
        const rate = Math.max(0.1, synth) / target;
        if (target <= cap && rate <= MAX_RATE + 1e-9) {
          f = {rate: +rate.toFixed(2), dur: +target.toFixed(2), overrun: target > slot + 0.05, fast: false, cut: false};
          timed = true;
        }
      }
      let spIdx = order.indexOf(c.sp);
      if (spIdx < 0) spIdx = 0;
      return {id: c.id, start: c.start, end: +(c.start + f.dur).toFixed(2), slotEnd: c.end, limitEnd: +(c.start + limit).toFixed(2),
        sp: c.sp, hue: speakerHue(spIdx), text, synth: +Math.max(0.1, synth).toFixed(2), rate: f.rate, overrun: f.overrun,
        fast: f.fast, cut: f.cut, status: failed[c.id] ? 'failed' : 'done', ...(timed ? {timed: true} : {}),
        ...(rd.readings.length ? {readings: rd.readings, readingsDropped: rd.dropped} : {})};
    });
  }
  /** 手动拉伸一块：把块拉到 newDur 秒，语速 = 合成时长 / 新时长，夹在 MANUAL_RATE 内。
   *  只改这一块的 rate / end，不动原句槽位，也不动别的块；拉过下一句开口就 overrun。 */
  function stretchBlock(b, newDur) {
    const synth = b.synth || (b.end - b.start) * (b.rate || 1);
    const want = Math.max(0.1, newDur || 0.1);
    const rate = Math.min(MANUAL_RATE.max, Math.max(MANUAL_RATE.min, synth / want));
    const dur = synth / rate;
    return Object.assign({}, b, {rate: +rate.toFixed(2), end: +(b.start + dur).toFixed(2), fast: rate > MAX_RATE + 1e-9,
      overrun: dur > (b.slotEnd - b.start) + 0.05, cut: false, manual: true});
  }
  /** 块上的语速角标：1.0× 不写；快过上限写「1.62× · 过快」 */
  function rateLabel(b) {
    if (!b || Math.abs((b.rate || 1) - 1) < 0.005) return '';
    return b.rate.toFixed(2) + '×' + (b.fast ? ' · 过快' : '');
  }
  /** 音源开关（行头 ⋯、播放条的音源按钮、配音收据共用）：听 `lang` 的配音 / 听原声 / 两者都听。
   *  一次翻原声轨与各语言配音组（配音行 + 各自的背景声行）的停用位——各行的喇叭仍可单独拧，这里只是常用组合：
   *  - dub：只开这一种语言的组（配音 + 它的背景声）；原声静音（选了「压低」则留着压低）；
   *  - original：所有组全关（原声本身就带背景，再叠一层会重）；
   *  - both：原声 + 这一种语言的配音，这组的背景声关（理由同上）。
   *  `langs` 是时间轴上现有的配音语言；返回 {muted, dubOff: {lang: bool}, bedOff: {lang: bool}, bedMuted, dubMuted}
   *  （`bedMuted` / `dubMuted` 是 `lang` 那一组的，给只认一条的旧读者）。 */
  function switchSource(target, o) {
    const opt = o || {};
    const duck = opt.original === 'duck';
    const langs = opt.langs && opt.langs.length ? opt.langs : (opt.lang ? [opt.lang] : []);
    const dubOff = {};
    const bedOff = {};
    langs.forEach((l) => {
      dubOff[l] = target === 'original' || l !== opt.lang;
      bedOff[l] = target !== 'dub' || l !== opt.lang;
    });
    const muted = target === 'dub' ? !duck : false;
    return {muted, dubOff, bedOff, bedMuted: target !== 'dub', dubMuted: target === 'original'};
  }
  /** 从停用位反推 `lang` 这条现在在听什么：'dub' | 'original' | 'both' | 'none'。
   *  `f` = {muted, dubOff, lang, ducked}；老调用给 {muted, dubMuted} 也认。 */
  function sourceOf(f) {
    const orig = !f.muted;
    const dub = f.dubOff ? !f.dubOff[f.lang] : !f.dubMuted;
    if (dub && (!orig || f.ducked)) return 'dub';
    if (orig && !dub) return 'original';
    return orig && dub ? 'both' : 'none';
  }
  /** 播放条音源按钮的字：「配音 · English」「原声」「两者 · English」，都没开写「静音」 */
  function sourceLabel(src, langName) {
    if (src === 'dub') return '配音 · ' + (langName || '');
    if (src === 'both') return '两者 · ' + (langName || '');
    return src === 'original' ? '原声' : '静音';
  }
  /** 时间轴上现在在听哪一种语言的配音：没关的里取最后配的那条，全关了返回 null */
  function activeDubLang(dubs, dubOff) {
    // 旁白组（role: narration）不是「另一种语言的配音」，不进音源切换
    const on = (dubs || []).filter((d) => d.role !== 'narration' && !(dubOff || {})[d.lang]);
    return on.length ? on[on.length - 1].lang : null;
  }
  /** 「删除之前的全部配音」这一格（§15.6）：时间轴上已有配音时才出现。同语言重跑本来就
   *  写回同一条轨；勾上它，别的语言的配音轨与背景声轨也在同一次写入里拿掉（能撤销）。
   *  返回 {show, others: [langName], hint}。 */
  function clearPrevInfo(dubs, lang, on) {
    const list = dubs || [];
    const same = list.some((d) => langCode(d.lang) === langCode(lang));
    const others = list.filter((d) => langCode(d.lang) !== langCode(lang)).map((d) => d.langName || d.lang);
    if (!list.length) return {show: false, others, hint: ''};
    const tail = same ? '同语言的那条本来就会被替换' : '';
    const hint = on
      ? `会一并移除 ${list.length} 组配音${list.some((d) => d.bed) ? '（连同各自的背景声）' : ''} · 能撤销`
      : others.length ? `保留 ${others.join('、')} 的配音，播放条上能切换${tail ? ' · ' + tail : ''}` : tail;
    return {show: true, others, hint};
  }
  /** 演示用的确定性失败集：每 23 句坏 1 句（62 句 → 3 句），不随机 */
  function demoFailures(cues) {
    const out = {};
    (cues || []).forEach((c, i) => { if (i % 23 === 7) out[c.id] = true; });
    return out;
  }
  function failedOf(blocks) {
    return (blocks || []).filter((b) => b.status === 'failed');
  }
  function fastOf(blocks) {
    return (blocks || []).filter((b) => b.status !== 'failed' && b.fast);
  }
  function retry(blocks, ids) {
    const set = {};
    (ids || []).forEach((id) => { set[id] = true; });
    return (blocks || []).map((b) => (set[b.id] ? Object.assign({}, b, {status: 'done'}) : b));
  }
  /** 收据：`已应用 · 配音 59/62 句 · 3 句过快 · 背景声已分离 · 1 分 48 秒 · Qwen3-TTS` */
  function dubReceipt(r) {
    const total = (r.blocks || []).length;
    const bad = failedOf(r.blocks).length;
    const fast = fastOf(r.blocks).length;
    const eng = ENGINES.find((e) => e.id === r.engine) || ENGINES[0];
    const parts = ['已应用', bad ? `配音 ${total - bad}/${total} 句` : `配音 ${total} 句`];
    if (fast) parts.push(`${fast} 句过快`);
    if (r.separate !== false) parts.push('背景声已分离');
    if (r.elapsed) parts.push(r.elapsed);
    parts.push(eng.family || eng.name);
    return parts.join(' · ');
  }
  function dubSub(r, langName) {
    const eng = ENGINES.find((e) => e.id === r.engine) || ENGINES[0];
    const st = STRATEGY.find((s) => s.id === r.strategy) || STRATEGY[0];
    return `${langName} · ${eng.family || eng.name} · ${st.name}${r.separate !== false ? ' · 分离背景' : ''}`;
  }
  /** 撤销配音会拿走什么 */
  const DUB_UNDO = '这次配出的「配音」轨会被移除（没有别的配音了就连同「背景声」轨），原声恢复到配音前的音量；这次顺手删掉的旧配音会放回来。译文与整理过的配音稿一个字不动。';

  const BC_TTS = {
    MODELS, ENGINES, PRESETS, EMOTIONS, LANGS, DUB_LANGS, FIT, ORIGINAL, STRATEGY,
    MAX_RATE, RETRANS_RATE, MANUAL_RATE, GAP, SEP_WINDOW, BED_TRACK_ID,
    LOCAL_KNOBS, knobsOf, knobValue, setKnob, knobArgs, knobLine, DURATION_MAX, durationMax,
    OMNI_DESIGN, OMNI_PRESETS, omniCats, omniItemLabel, omniFit, omniToggle, omniCount, omniInstruct, omniLabel, omniProblem, omniLangNote, describeText,
    engineOf, allEngines, LANG_SHORT, VOICE_MODES, modelFor, referenceWindows, voiceModes, cloneOnly, hasDescribe, describeByVocab, hasStyle, styleOn, refRequired, builtinKind, hasEmotion, engineName, engineFamily, formLangs, GSV_REF, refProblem, refTextRequired, BUILTIN_REFS, QUICK_BUILTINS, builtinRef, defaultBuiltin, moreBuiltins, REF_CREDIT, refSources, refDefault, refSourceOf, pickRef, modelBrief, SAMPLE_LINES, SAMPLE_KINDS, sampleLangs, sampleKinds, sampleLine, langLabel, quickTones, quickTone, QUICK_PRESETS, quickVoices, quickDefaults, quickForm, quickSummary, quickKey, quickSlow, DESCRIBE_VOICES, engineSpeaks, ttsLangs, dubLangMarks, fallbackLang, REF_WINDOW, referenceWindow, referenceLine, validate, validatePreview, segments, estimateDuration, GEN_STAGES, genStages, genPhase, genSub, asSource,
    PACE_FILE, PACE_PATH, PACE_SEED, paceUnit, unitName, latinUnits, countUnits, paceFor, paceUpdate, paceLine, predictRate, budgetUnits,
    limitOf, fitPlan, demoRewrite, replanRow,
    DUB_STAGES, dubStages, sepWindows, dubPhase, fitSentence, speakerHue, dubTrackId, dubBlocks, stretchBlock, rateLabel,
    switchSource, sourceOf, sourceLabel, activeDubLang, clearPrevInfo, demoFailures, failedOf, fastOf, retry, dubReceipt, dubSub, DUB_UNDO,
  };
  if (typeof window !== 'undefined') Object.assign(window, {BC_TTS});
  if (typeof module !== 'undefined' && module.exports) module.exports = BC_TTS;
})();
