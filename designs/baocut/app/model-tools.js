/* 「工具」页的纯模型 —— §17.5（2026-09-16），目录按 product-design §2.7 分成语音与字幕 / 文字与图片 / 视频文件三组（2026-10-06）。
   工具不经过会话、不启动 Agent，直接做一件确定的事：生成语音用本机 TTS 模型，视频压缩 / 合并用本机 ffmpeg。只调用模型或固定媒体处理流程，不依赖 Agent、不进入 Agent loop。远端算力是常驻服务，2026-09-17 搬到侧栏「服务」（§17.6，model-services.js）。这里只算：工具目录与卡片状态行、生成语音工作台的「模型能做什么」
   （音色方式、能力标签、语言表、文字语种检查）、表单校验、生成记录的命名与排队。
   引擎、模型、预设音色、参考音频的真相都在 model-tts.js（BC_TTS），这里只组合不复制。 */
(function () {
  const TTS = () => window.BC_TTS;
  const C = () => window.BC_CLOUD_TTS;   // 云端 API 提供方（2026-09-24 云端语音合成设计稿）：引擎 `cloud:<provider>`
  const RD = () => window.BC_READINGS;
  const bare = (text) => (RD() ? RD().stripReadings(text) : String(text || ''));
  const VID = () => window.BC_VIDEO;

  /* ---------- 工具目录（product-design §2.7、architecture §7.9「工具」） ----------
     工具按处理的对象分三组：语音与字幕 / 文字与图片 / 视频文件（§2.7 表一）。结果缺省是 Space 里的条目，保存到默认保存位置；
     只有选了 Space 里可编辑的视频（`movie`）或改选「新建视频」时，结果才是一部视频。
     每个工具声明它收哪几种输入（`inputs`）：file 本机文件 / space Space 条目 / link 链接 / text 文字，各自的结果 `output`：video / artifact。
     - space 输入带 `kinds`：收哪几种 Space 条目（model-space.js 的 KINDS）；其中 `movie` 是写进视频，结果按 `video` 算；
       `attach: true` = 只作附加材料（文本生成附上文档或字幕），不在来源切换里单列；`needs`：movie 要求已有的东西（'transcript' = 转录过）。
     - file 输入的 `accept`：收的扩展名；`label`：来源切换上的字（缺省取 INPUTS）。
     `artifacts`：从文件 / Space 媒体 / 链接开始时产出的条目种类（转录是文档 + 字幕两条）；`targets`：结果落在哪的几种选法，第一项是缺省。
     目录卡、侧栏、来源切换、Space 选择器（model-tool-space-input.js）都从这份声明派生，组件里不另写。
     `planned` = 还没做、卡片置灰标「即将推出」，点不进去；顺序就是页面上的顺序。 */
  const INPUTS = {
    file: {k: 'file', label: '本机文件'},
    space: {k: 'space', label: 'Space'},
    link: {k: 'link', label: '链接'},
    text: {k: 'text', label: '文字'},
  };
  const OUTPUTS = {video: '视频', artifact: 'Space 里的条目'};
  const ARTIFACTS = {audio: '音频', image: '图片', doc: '文档', final: '视频文件', subtitle: '字幕'};
  const MEDIA_ACCEPT = ['.mp4', '.mov', '.mkv', '.webm', '.mp3', '.wav', '.m4a', '.aac', '.flac'];
  const VIDEO_ACCEPT = ['.mp4', '.mov', '.mkv', '.webm', '.avi'];
  const GROUPS = [
    {k: 'speech', label: '语音与字幕', desc: '转录、翻译字幕与配音、把文字念出来。结果是文档、字幕与音频条目；选 Space 里可编辑的视频时写进它。', tools: [
      {id: 'transcribe', name: '转录', icon: 'Transcript', navIcon: 'Transcript', output: 'artifact', artifact: 'doc', artifacts: ['doc', 'subtitle'],
       desc: '把视频或音频转成一份文稿和一份字幕；选可编辑的视频时写进它，并建立字幕层',
       inputs: [{kind: 'file', output: 'artifact', accept: MEDIA_ACCEPT}, {kind: 'space', kinds: ['final', 'audio', 'movie'], output: 'artifact'},
         {kind: 'link', output: 'artifact'}],
       targets: [{k: 'none', label: '只生成文稿和字幕'}, {k: 'create', label: '新建视频并放进项目'}]},
      {id: 'translate', name: '翻译字幕', icon: 'translate', navIcon: 'Translate', output: 'artifact', artifact: 'subtitle',
       desc: '把字幕翻译成另一种语言；选转录过的视频时新增译文与字幕层，可以双语显示，原文不动',
       inputs: [{kind: 'space', kinds: ['movie', 'subtitle'], needs: 'transcript', output: 'artifact'},
         {kind: 'file', label: '本机字幕文件', accept: ['.srt', '.vtt'], output: 'artifact'}]},
      {id: 'dub', name: '翻译配音', icon: 'Microphone', navIcon: 'Microphone', output: 'video',
       desc: '用译文给转录过的视频配一组新的声音，原声可以压低、静音或保留',
       inputs: [{kind: 'space', kinds: ['movie'], needs: 'transcript', output: 'video'}]},
      {id: 'tts', name: '生成语音', icon: 'wave', navIcon: 'AudioWave', output: 'artifact', artifact: 'audio',
       desc: '把文字或 Space 里的文档、字幕念出来；可选预设音色、克隆一段录音或描述一个声音',
       inputs: [{kind: 'text', output: 'artifact'}, {kind: 'space', kinds: ['doc', 'subtitle'], output: 'artifact'}]},
    ]},
    {k: 'text-image', label: '文字与图片', desc: '直接调用文本模型与图像模型。结果是文档与图片条目。', tools: [
      {id: 'text', name: '文本生成', icon: 'text', navIcon: 'Text', output: 'artifact', artifact: 'doc',
       desc: '输入要求，直接调用文本模型生成文案、脚本或摘要；可以附上 Space 里的文档或字幕作为材料',
       inputs: [{kind: 'text', output: 'artifact'}, {kind: 'space', kinds: ['doc', 'subtitle'], attach: true, output: 'artifact'}]},
      {id: 'image', name: '生成图片', icon: 'image', navIcon: 'Image', output: 'artifact', artifact: 'image',
       desc: '写一句描述，用云端或本机图像模型画一张图；可带参考图、选画幅与张数',
       inputs: [{kind: 'text', output: 'artifact'}]},
    ]},
    {k: 'video-file', label: '视频文件', desc: '下载、压缩、合并视频与提取音频，用本机的 yt-dlp 与 ffmpeg。结果是视频文件与音频条目。', tools: [
      {id: 'link', name: '下载视频', icon: 'Download', navIcon: 'Download', output: 'artifact', artifact: 'final',
       desc: '粘贴链接，下载视频到本机；可使用浏览器 Cookie，下载后可转录成文稿和字幕',
       inputs: [{kind: 'link', output: 'artifact'}], targets: []},
      {id: 'compress', name: '压缩视频', icon: 'film', navIcon: 'Video', output: 'artifact', artifact: 'final',
       desc: '按目标体积或画质重新编码，发消息、传网盘前先压一压',
       inputs: [{kind: 'file', output: 'artifact', accept: VIDEO_ACCEPT}, {kind: 'space', kinds: ['final'], output: 'artifact'}]},
      {id: 'merge', name: '合并视频', icon: 'layers', navIcon: 'Layers', output: 'artifact', artifact: 'final',
       desc: '把几段视频按顺序首尾接成一个文件',
       inputs: [{kind: 'file', output: 'artifact', accept: VIDEO_ACCEPT}, {kind: 'space', kinds: ['final'], output: 'artifact'}]},
      {id: 'extract', name: '提取音频', icon: 'wave', navIcon: 'AudioWave', output: 'artifact', artifact: 'audio',
       desc: '去掉画面，只留音轨；常见的音频编码原样复制，不重新编码',
       inputs: [{kind: 'file', output: 'artifact', accept: VIDEO_ACCEPT}, {kind: 'space', kinds: ['final'], output: 'artifact'}]},
    ]},
  ];
  const TOOLS = GROUPS.reduce((all, g) => all.concat(g.tools.map((t) => Object.assign({group: g.k}, t))), []);
  const toolById = (id) => TOOLS.find((t) => t.id === id) || null;
  /** 路由里的工具 id → 能打开的工具；未知或未推出的回到目录（null） */
  function openable(id) {
    const t = toolById(id);
    return t && !t.planned ? t : null;
  }
  /** 输入来源的选项（界面的来源切换）：`[{k, label, output, needs, accept, kinds, attach}]`，按声明的顺序。
   *  `attach` 的项（附加材料）也在里面，来源切换自己跳过它。 */
  function inputOptions(id) {
    const t = toolById(id);
    return t ? t.inputs.map((i) => ({k: i.kind, label: i.label || INPUTS[i.kind].label, output: i.output, needs: i.needs || null,
      accept: i.accept || null, kinds: i.kinds ? i.kinds.slice() : null, attach: !!i.attach})) : [];
  }
  /** 来源切换上真正能切的几项（不含附加材料） */
  const sourceOptions = (id) => inputOptions(id).filter((o) => !o.attach);
  /** 结果落在哪的选项（转录：只生成文稿和字幕 / 新建视频），第一项是缺省；没有这一问的工具 → [] */
  function targetOptions(id) {
    const t = toolById(id);
    return t && t.targets ? t.targets.map((x) => Object.assign({}, x)) : [];
  }
  /** 这个工具从这种输入开始时，结果是什么：'video' / 'artifact' / null（不收这种输入）。
   *  `entryKind`：space 输入选中的条目种类，`movie` 是写进视频。 */
  function outputOf(id, kind, entryKind) {
    const t = toolById(id);
    const i = t && t.inputs.find((x) => x.kind === kind);
    if (!i) return null;
    if (kind === 'space' && entryKind === 'movie' && i.kinds.indexOf('movie') >= 0) return 'video';
    return i.output;
  }
  /** 产出条目的说法：「文档与字幕条目」「音频条目」 */
  const artifactText = (t) => `${(t.artifacts || [t.artifact]).map((a) => ARTIFACTS[a] || '产物').join('与')}条目`;
  /** 卡片上「结果」那一句：缺省产出什么条目；能写进视频、能改选新建视频的另说一句 */
  function resultLine(id) {
    const t = toolById(id);
    if (!t) return '';
    const space = t.inputs.find((i) => i.kind === 'space' && !i.attach);
    const intoMovie = !!(space && space.kinds.indexOf('movie') >= 0);
    if (t.output === 'video') return '结果：写进你选的视频';
    const parts = [`结果：Space 里的${artifactText(t)}`];
    if ((t.targets || []).some((x) => x.k === 'create')) parts.push('也可以新建视频');
    if (intoMovie) parts.push('选可编辑的视频时写进它');
    return parts.join('；');
  }

  /* ---------- 生成语音：引擎与能力 ---------- */
  /* 语言自称（`简体中文` / `English`）从共用目录取（model-languages.js）：
     工具页不另带一份语言表，否则同一门语言在两处叫两个名字。 */
  const CATALOG = (typeof window !== 'undefined' && window.BC_LANGUAGES)
    || (typeof require === 'function' ? require('./model-languages.js') : null);
  const langName = (code) => CATALOG.native(code);
  /* 采样率取引擎原生值（bcut tts `--out`：16-bit PCM 单声道） */
  const RATES = {'qwen3': 24000, 'qwen3-1.7b': 24000, 'indextts2': 22050, 'indextts25': 22050, 'gptsovits': 32000,
    'voxcpm2': 48000, 'omnivoice': 24000};
  /* 语言 Picker 先列几种、其余收进「更多语言…」：VoxCPM2 31 种、OmniVoice 上百种，一屏列不下 */
  const LANG_FIRST = 12;
  const MAX_CHARS = 2000;

  const engines = () => TTS().ENGINES;
  const isCloud = (engine) => !!TTS().engineOf(engine).cloud;
  /** 本地引擎 + 已连接的云端 API 提供方（`saved` = 已连密钥的提供方 id 数组） */
  const allEngines = (saved) => TTS().allEngines(saved);
  /** 这只引擎的音色方式：preset 预设 / clone 参考音频 / describe 描述 */
  function voiceModes(engine) {
    return TTS().voiceModes(engine);
  }
  /** 表单 → 要用的模型 id */
  function modelOf(f) {
    const e = TTS().engineOf(f.engine);
    if (e.cloud) return f.cloudModel && C().providerOf(f.cloudModel) === e.provider ? f.cloudModel : e.models.preset;
    return TTS().modelFor(f.engine, f.mode);
  }
  /** 一只引擎涉及的全部模型（Qwen3-TTS 两档都按 Base / CustomVoice 分开装） */
  function modelsOf(engine) {
    return voiceModes(engine).map((m) => modelOf({engine, mode: m})).filter((id, i, a) => a.indexOf(id) === i);
  }
  /** 语言简写：「中 / 英」或「中 / 英 / 日 / 韩 等 10 种」 */
  function langsShort(engine) {
    const e = TTS().engineOf(engine);
    if (e.cloud) return C().langsShort(e.provider);
    const short = TTS().engineOf(engine).langs.map((c) => TTS().LANG_SHORT[c] || c);
    return short.length > 5 ? `${short.slice(0, 4).join(' / ')} 等 ${short.length} 种` : short.join(' / ');
  }
  /** 模型卡：一句话 + 能力标签。标签只写「能拿它做什么」，tone 给出「要你多做一步」的那几条。 */
  function engineCard(engine, connected) {
    const e = TTS().engineOf(engine);
    if (e.cloud) return C().card(e.provider, connected);
    const tags = [];
    let line;
    if (e.models.preset) {
      line = e.models.describe ? '9 个预设音色直接念，也能克隆一段录音，或只凭一句描述造一个新声音' : '9 个预设音色直接念，也能克隆一段录音';
      tags.push({label: '预设音色'}, {label: '克隆'}, {label: '风格指令'});
      if (e.models.describe) tags.push({label: '描述声音'});
    } else if (e.vocab) {
      line = '克隆一段录音，或挑性别、年龄、音高造一个新声音';
      tags.push({label: '克隆'}, {label: '描述声音'}, {label: '按时长念'});
    } else if (e.style) {
      line = '克隆一段录音；给出录音原文最像，也能用一句话指定风格';
      tags.push({label: '需要参考音频', tone: 'notice'}, {label: '风格指令'});
    } else {
      line = e.emotion ? '克隆一段录音，情绪可调' : '克隆一段录音；给出录音原文会更像';
      tags.push({label: '需要参考音频', tone: 'notice'});
      if (e.emotion) tags.push({label: '情绪'});
    }
    tags.push({label: langsShort(engine)});
    if (e.slow) tags.push({label: '较慢', tone: 'notice'});
    if (e.nonCommercial) tags.push({label: '仅限非商用', tone: 'notice'});
    return {id: e.id, name: e.name, line, tags};
  }
  /** 语言 Picker：自动 + 这只引擎会念的 */
  function langOptions(engine, all, model) {
    const e = TTS().engineOf(engine);
    if (e.cloud) return C().langOptions(e.provider, model ? (C().parse(model) || {}).model : null, all);
    const list = all || e.langs.length <= LANG_FIRST ? e.langs : e.langs.slice(0, LANG_FIRST);
    return [{code: 'auto', name: '自动'}].concat(list.map((c) => ({code: c, name: langName(c)})));
  }
  /** 按文字的书写系统猜语言：假名 → ja，谚文 → ko，阿拉伯字母 → ar，汉字 → zh，拉丁字母 → en；空 → null */
  function detectLang(text) {
    const t = String(text || '');
    if (/[぀-ヿ]/.test(t)) return 'ja';
    if (/[가-힯]/.test(t)) return 'ko';
    if (/[؀-ۿ]/.test(t)) return 'ar';
    if (/[㐀-鿿]/.test(t)) return 'zh';
    if (/[A-Za-z]/.test(t)) return 'en';
    return null;
  }
  /** 会念这种语言的引擎名，给「换一只」的提示用 */
  function enginesFor(lang) {
    return engines().filter((e) => e.langs.indexOf(lang) >= 0).map((e) => e.name);
  }
  /** 「自动」时文字语种不在引擎的语言表里 → 一句话；否则 null */
  function langProblem(f) {
    if (f.lang && f.lang !== 'auto') return null;
    const lang = detectLang(f.text);
    if (!lang || TTS().engineSpeaks(f.engine, lang)) return null;
    const alt = enginesFor(lang);
    return `${TTS().engineName(f.engine)} 不会念${langName(lang)}${alt.length ? `，换 ${alt.join(' 或 ')}` : ''}`;
  }

  /* ---------- 念法：一句风格指令 ---------- */
  /* 「风格」这一栏原本只是个空输入框，要用户自己想一句话。这里给六张现成的念法卡：
     点一下把 `style` 填成那句指令，文字框还空着就顺手填一段示例，按下去立刻能听。
     指令原文就是 `bcut tts --style` 的参数，只有 Qwen3 两档吃它。 */
  const VIBES = [
    {k: 'radio', name: '深夜电台', style: '像深夜电台一样，慢一点，声音压低'},
    {k: 'launch', name: '产品发布', style: '产品发布会，热情一点，重点处加重'},
    {k: 'bedtime', name: '睡前故事', style: '轻声讲睡前故事，放慢语速，语气温柔'},
    {k: 'news', name: '新闻播报', style: '新闻播报，吐字清楚，节奏平稳'},
    {k: 'teach', name: '教学讲解', style: '像讲课一样解释，口语一点，关键处停一下'},
    {k: 'vlog', name: '活力解说', style: '轻快有活力，语速快一点，带点笑意'},
  ];
  /** 当前 `style` 正好是某张念法卡的指令 → 那张卡；自己写的一句 → null */
  function vibeOf(style) {
    return VIBES.find((v) => v.style === String(style || '')) || null;
  }
  /** 点一张念法卡：同一张再点一次清空；文字框空着就带一段示例进去。 */
  function pickVibe(f, k) {
    const v = VIBES.find((x) => x.k === k);
    if (!v) return {};
    if (f.style === v.style) return {style: ''};
    const patch = {style: v.style};
    if (!String(f.text || '').trim()) patch.text = sampleText(f);
    return patch;
  }
  /** 「换一个」：随机挑一张与当前不同的念法卡（`rnd` 便于单测注入）。 */
  function rollVibe(f, rnd) {
    const others = VIBES.filter((v) => v.style !== f.style);
    const v = others[Math.floor((rnd || Math.random)() * others.length)] || VIBES[0];
    return pickVibe(Object.assign({}, f, {style: ''}), v.k);
  }
  /** 「随机音色」：随机挑一个与当前不同的预设音色。 */
  function rollPreset(cur, rnd) {
    const others = TTS().PRESETS.filter((p) => p.id !== cur);
    return (others[Math.floor((rnd || Math.random)() * others.length)] || TTS().PRESETS[0]).id;
  }

  /* ---------- 表单 ---------- */
  function blank() {
    return {text: '', engine: 'qwen3', mode: 'preset', preset: 'Serena', ref: null, refText: '',
      lang: 'auto', emotion: 'none', emoRef: null, emoLevel: 60, style: '', instruct: TTS().DESCRIBE_VOICES[0].instruct, seed: false,
      /* 本地旋钮（没碰过的键不在里面 = 不传）与 OmniVoice 的词表挑选（从一组现成挑法起步） */
      knobs: {}, omni: Object.assign({}, TTS().OMNI_PRESETS[0].sel),
      /* 云端（§2.2）：模型在 API 提供方内挑、音色走共享选择器的值；旋钮按能力表出现（语速区间各家不同） */
      cloudModel: null, cloudVoice: {kind: 'default'}, speed: 1, pitch: 0, volume: 1, stability: 0.5, similarity: 0.75, styleStrength: 0, cloudEmotion: 'none'};
  }
  /** 换引擎：音色方式不合法就落到它的第一种；语言不在新表里退回「自动」；
   *  不带参考也能念——每只引擎都有按语言挑的默认音色（2026-09-21）。 */
  function switchEngine(f, engine) {
    const modes = voiceModes(engine);
    const mode = modes.indexOf(f.mode) >= 0 ? f.mode : modes[0];
    const lang = langOptions(engine, true).some((l) => l.code === f.lang) ? f.lang : 'auto';
    // 旋钮按引擎各有区间，换引擎就回到「按模型默认」；词表挑选只留新语言下还生效的项
    const next = Object.assign({}, f, {engine, mode, lang, knobs: {}, omni: TTS().omniFit(f.omni, lang)});
    if (!TTS().hasEmotion(engine)) Object.assign(next, {emotion: 'none', emoRef: null});
    const e = TTS().engineOf(engine);
    if (e.cloud) {
      /* 换 API 提供方：模型落到它的缺省、音色退回默认、语速回到 1（各家区间不同，旧值可能越界）、风格指令只在收的模型上保留 */
      const keep = f.cloudModel && C().providerOf(f.cloudModel) === e.provider;
      Object.assign(next, {mode: 'preset', cloudModel: keep ? f.cloudModel : e.models.preset, cloudVoice: keep ? (f.cloudVoice || {kind: 'default'}) : {kind: 'default'},
        speed: keep ? f.speed : 1, cloudEmotion: keep ? f.cloudEmotion : 'none', style: TTS().hasStyle(engine) ? f.style : ''});
    }
    return next;
  }
  /** 云端引擎内换模型：语言不在新模型的表里退回「自动」 */
  function switchCloudModel(f, model) {
    const next = Object.assign({}, f, {cloudModel: model});
    if (!langOptions(f.engine, true, model).some((l) => l.code === f.lang)) next.lang = 'auto';
    return next;
  }
  /** 打开工作台时先落到一只已经装好的模型：默认那只（Qwen3-TTS 0.6B 预设音色）装了就用它，
   *  否则按引擎次序找第一只装好的音色方式。一个都没装时还是默认那只，由下载卡接手。 */
  function preferredForm(installed, cloudDefault) {
    const base = blank();
    if (cloudDefault && installed(cloudDefault) && !cloudDefault.startsWith('cloud:')) {
      for (const e of engines()) {
        for (const mode of voiceModes(e.id)) {
          if (modelOf({engine: e.id, mode}) === cloudDefault) {
            return Object.assign(switchEngine(base, e.id), {mode});
          }
        }
      }
    }
    /* 设置 › 云端模型 › 语音合成默认选了某只云端模型（不是「每次选择」）且那家还连着：工作台直接开在它上 */
    if (cloudDefault && installed(cloudDefault)) {
      const e = TTS().engineOf(C().engineId(C().providerOf(cloudDefault)));
      if (e.cloud) return switchCloudModel(switchEngine(base, e.id), cloudDefault);
    }
    if (installed(modelOf(base))) return base;
    for (const e of engines()) {
      for (const mode of voiceModes(e.id)) {
        if (installed(modelOf({engine: e.id, mode}))) return switchEngine(Object.assign({}, base, {mode}), e.id);
      }
    }
    return base;
  }
  /** 选中的模型没装时，指一只已经装好的替代：先同一种音色方式换引擎，再退而求其次任意一只。
   *  返回 {engine, mode, name, switched}（`switched` = 连音色方式也换了）或 null（全都没装）。 */
  function installedAlternative(f, installed) {
    if (installed(modelOf(f))) return null;
    const hit = (engine, mode) => ({engine, mode, name: TTS().engineName(engine), switched: mode !== f.mode});
    const same = engines().find((e) => e.id !== f.engine && voiceModes(e.id).indexOf(f.mode) >= 0
      && installed(modelOf({engine: e.id, mode: f.mode})));
    if (same) return hit(same.id, f.mode);
    for (const e of engines()) {
      for (const mode of voiceModes(e.id)) {
        if (installed(modelOf({engine: e.id, mode}))) return hit(e.id, mode);
      }
    }
    return null;
  }

  /** 生成前的校验：返回错误列表（空即可生成）。按钮不置灰，按下再说清缺什么。 */
  function validate(f, opt) {
    const errs = [];
    const text = String(f.text || '').trim();
    if (!text) errs.push('先写要念的文字');
    if (isCloud(f.engine)) {
      /* 云端：字数上限按模型（能力表 max_chars）、我的声音在这家可不可用、密钥连没连，都在 model-cloud-tts.js */
      C().validate(f, (opt && opt.voices) || [], opt).forEach((e) => errs.push(e));
      if (text) { const lang = langProblem(f); if (lang) errs.push(lang); }
      return errs;
    }
    if (text.length > MAX_CHARS) errs.push(`一次最多 ${MAX_CHARS} 字，超出的分两次生成`);
    if (f.mode === 'describe') {
      if (TTS().describeByVocab(f.engine)) { const p = TTS().omniProblem(f.omni, f.lang); if (p) errs.push(p); }
      else if (!String(f.instruct || '').trim()) errs.push('先用一句话描述想要的声音');
    } else if (f.mode === 'clone') {
      // 不给参考不是错：落到按语言挑的默认音色。半步（选了「我的音频」还没给文件）才拦
      if (!f.ref && f.refPicking) errs.push('先选一段参考音频，或换回内置音色');
      const ref = TTS().refProblem(f);
      if (ref) errs.push(ref);
    }
    if (TTS().hasEmotion(f.engine) && f.emotion === 'ref2' && !f.emoRef) errs.push('情绪选了另给一段音频，先把那段音频选上');
    if (text) {
      const lang = langProblem(f);
      if (lang) errs.push(lang);
    }
    return errs;
  }
  /** 字数行：「128 / 2000 字 · 3 段 · 约 12.4 秒」 */
  function textStats(text, max) {
    const t = bare(text).trim();                   // `<字|读音>` 注记不算字数
    const cap = String(max || MAX_CHARS);
    if (!t) return `0 / ${cap} 字`;
    return `${t.length} / ${cap} 字 · ${TTS().segments(t).length} 段 · 约 ${TTS().estimateDuration(t).toFixed(1)} 秒`;
  }
  /** 这份表单一次能收的字数：云端按模型，本地 2000 */
  function maxChars(f) {
    const e = TTS().engineOf(f.engine);
    return e.cloud ? C().capabilities(e.provider, (C().parse(modelOf(f)) || {}).model).maxChars : MAX_CHARS;
  }
  /** 「填一段示例」：按选中的语言，自动时取引擎会念的第一种 */
  function sampleText(f) {
    const code = f.lang && f.lang !== 'auto' ? f.lang : TTS().engineOf(f.engine).langs[0];
    return TTS().sampleLine(code, 'intro').text;
  }
  /** 音色的短名：Serena / 中文女声 / my-voice.wav / 默认音色 / 温暖女声 / 自己描述 */
  function voiceLabel(f, voices) {
    const e = TTS().engineOf(f.engine);
    if (e.cloud) return C().voiceLabel(e.provider, f.cloudVoice, voices || [], {lang: f.lang !== 'auto' ? f.lang : detectLang(f.text)});
    if (f.mode === 'preset') return f.preset;
    if (f.mode === 'describe') {
      if (TTS().describeByVocab(f.engine)) return TTS().omniLabel(f.omni) || '描述的声音';
      const v = TTS().DESCRIBE_VOICES.find((x) => x.instruct === f.instruct);
      return v ? v.label : '描述的声音';
    }
    if (!f.ref) return `默认音色 · ${TTS().defaultBuiltin(f.lang, f.text).label}`;
    const b = TTS().builtinRef(f.ref.builtin);
    return b ? b.label : f.ref.name;
  }

  /** 「交给 Agent」的提示词（§17.5，2026-09-24）：把表单折成一句人话，Agent 自己标读音、再调 BaoCut 合成。
   *  文字含中文才要它标读音；风格为空、语言为「自动」的都不写；文字为空时留一个占位，让人知道该填在哪。 */
  function agentPrompt(f) {
    const text = bare(f.text).trim();
    const e = TTS().engineOf(f.engine);
    const modelName = e.cloud ? `${e.name} ${(C().parse(modelOf(f)) || {}).model}（云端）` : TTS().MODELS[modelOf(f)].name;
    const parts = [`模型 ${modelName}`, `音色 ${voiceLabel(f, f.voices)}`];
    // 描述造声：写的那句（或词表拼出来的那串）就是声音本身，得原样交代
    const said = !e.cloud && f.mode === 'describe' ? TTS().describeText(f) : '';
    if (said && !TTS().DESCRIBE_VOICES.some((x) => x.instruct === said)) parts.push(`声音描述「${said}」`);
    if (f.style && f.style.trim() && TTS().styleOn(f.engine, f.mode)) parts.push(`风格「${f.style.trim()}」`);
    if (f.lang && f.lang !== 'auto') parts.push(`语言 ${langName(f.lang)}`);
    // 旋钮只写用户动过的（没动过的不传，Agent 也别自作主张加）
    if (!e.cloud && TTS().knobArgs(f.engine, f.knobs).length) parts.push(`参数 ${TTS().knobLine(f.engine, f.knobs)}`);
    const readings = RD() && RD().hasHan(text) ? '先按上下文标好多音字读音（<字|读音> 语法），再' : '';
    return `用 BaoCut 生成语音：${parts.join('，')}。${readings}合成成 WAV 给我试听；不要改我的文字。要念的文字：\n\n${text || '（把要念的文字放在这里）'}`;
  }

  /* ---------- 生成记录 ---------- */
  const pad = (n) => String(n).padStart(3, '0');
  /** 一条生成记录。状态 queued → running → done / error；文件名按序号 `语音-001.wav`。 */
  function makeRecord(f, seq, voices) {
    const e = TTS().engineOf(f.engine);
    const lang = f.lang !== 'auto' ? f.lang : detectLang(f.text);
    const prov = e.cloud ? C().providerById(e.provider) : null;
    return {
      provider: prov ? prov.name : null, chars: prov ? C().chars(bare(f.text)) : 0,
      id: 'g' + seq, seq, name: `语音-${pad(seq)}.wav`, status: 'queued', pct: 0, taskId: null,
      // 带注记的文字（按过「注音」就把读音渲进去）与去注记的表面文字各存一份；卡片上显示 surface
      text: (RD() ? RD().formText(f) : String(f.text)).trim(), surface: bare(f.text).trim(), voice: voiceLabel(f, voices), engine: e.id,
      engineName: prov ? `${e.name} · ${(C().parse(modelOf(f)) || {}).model}` : e.name, model: modelOf(f),
      lang: lang ? langName(lang) : '', dur: TTS().estimateDuration(f.text), rate: prov ? prov.rate : (RATES[e.id] || 24000),
      form: Object.assign({}, f),
    };
  }
  /** 记录的元数据行：「00:07 · 24 kHz · Qwen3-TTS 0.6B · Serena · 中文」 */
  function recordMeta(r) {
    const mm = Math.floor(r.dur / 60), ss = Math.round(r.dur % 60);
    const khz = (r.rate / 1000).toFixed(r.rate % 1000 ? 2 : 0).replace(/0$/, '');
    return [`${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, `${khz} kHz`, r.engineName, r.voice, r.lang, r.provider ? `${r.chars} 字` : ''].filter(Boolean).join(' · ');
  }
  /** 本机一次只跑一条：没有在跑的就把最早排队的那条交出来，否则 null */
  function nextQueued(list) {
    if (list.some((r) => r.status === 'running')) return null;
    const q = list.filter((r) => r.status === 'queued');
    return q.length ? q.reduce((a, b) => (a.seq < b.seq ? a : b)) : null;
  }
  /** 排队的记录前面还有几条（在跑的也算） */
  function aheadOf(list, id) {
    const me = list.find((r) => r.id === id);
    if (!me) return 0;
    return list.filter((r) => (r.status === 'running' || r.status === 'queued') && r.seq < me.seq).length;
  }
  /** 压缩 / 合并两张卡共用的状态行：这份 ffmpeg 行不行（真相在 BC_VIDEO） */
  function videoStatus(env) {
    return VID().ffmpegStatus(env);
  }

  /** 生成图片卡的状态行（真相在 model-cloud-image.js 的 engines）：几家云端已连、本机装没装、Codex 开没开 */
  function imageStatus(engines) {
    return window.BC_CLOUD_IMAGE.toolStatus(engines);
  }

  /** 生成语音卡的状态行：已装几只模型 */
  function ttsStatus(installed, saved) {
    const all = engines().reduce((ids, e) => ids.concat(modelsOf(e.id)), []);
    const n = all.filter((id) => installed(id)).length;
    const cloud = C() ? C().engines(saved).length : 0;
    const local = n ? `已装 ${n} / ${all.length} 个语音模型` : `${all.length} 个语音模型可下载`;
    return {text: cloud ? `${local} · ${cloud} 家云端已连接` : local, on: n > 0 || cloud > 0};
  }

  window.BC_TOOLS = {
    INPUTS, OUTPUTS, ARTIFACTS, MEDIA_ACCEPT, VIDEO_ACCEPT, GROUPS, TOOLS, toolById, openable, inputOptions, sourceOptions, targetOptions, outputOf,
    artifactText, resultLine, imageStatus,
    langName, RATES, MAX_CHARS, isCloud, allEngines, voiceModes, modelOf, modelsOf, langsShort, engineCard, langOptions,
    VIBES, vibeOf, pickVibe, rollVibe, rollPreset, preferredForm, installedAlternative,
    detectLang, enginesFor, langProblem, blank, switchEngine, switchCloudModel, validate, textStats, maxChars, sampleText, voiceLabel,
    makeRecord, recordMeta, nextQueued, aheadOf, ttsStatus, videoStatus, agentPrompt,
  };
})();
