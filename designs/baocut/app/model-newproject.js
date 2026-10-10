/* Home 起始页的纯模型（product-design §3.2.1）。
   页面以 Agent 输入框为中心：说一句话、附上材料（PDF、图片，也可以是视频或音频）就能开始，
   做哪一类由 `route` 从这句话和材料里看出来，不要求先选。输入框下面只有两样可选的起点：
   「快捷开始」（`homeStarters`：点一下把一句提示词放进输入框）与模板（model-home-templates.js）。
   这里算：目标目录、快捷开始的条目与提示词、路线、一条目标会跑哪几步（谁来跑）、AI 闸门
   （没有可用的 AI 时不让一条走不完的流程起跑）、交给 Agent 的那段话，以及「上次怎么做的」记忆。
   原先排在输入框下面的固定流程表单已经退场；为它服务的几个函数（`flowGroups`、`cta`、`chainOf` 等）暂时留着。 */
(function () {
  /* Shorts（2026-09-27）：与「做哪一类」正交的格式开关，数字与措辞都在 model-shorts.js。 */
  const SH = () => (typeof window !== 'undefined' && window.BC_SHORTS) || (typeof require === 'function' ? require('./model-shorts.js') : null);
  /* 待填项（template-spec §5.5）：输入框里没填的 `{{label}}` 交给 Agent 时写成 `[label]`。 */
  const SLOTS = () => (typeof window !== 'undefined' && window.BC_PROMPT_SLOTS) || (typeof require === 'function' ? require('./model-prompt-slots.js') : null);
  const ENTRIES = [
    {k: 'media', icon: 'film',  title: '用视频或音频', desc: '加字幕、翻译、剪口播，或把音频做成视频'},
    {k: 'agent', icon: 'agent', title: '让 Agent 制作', desc: '不需要素材：一句话、PDF 或图片就能做成视频', ai: true},
    {k: 'blank', icon: 'blank', title: '空白视频',     desc: '不转录、不排队，立即可用'},
  ];

  /* ai: 需要 LLM 或 Agent；agentOnly: 只能交给编码 Agent（直接调模型做不了）。 */
  const GOALS = [
    {k: 'sub',   entry: 'media', icon: 'captions',  hue: 'blue',    title: '加字幕',       desc: '识别说话内容，生成可编辑的字幕'},
    {k: 'a2v',   entry: 'media', icon: 'audio',     hue: 'magenta', title: '音频转视频',   desc: '给纯音频配上背景、声波与字幕'},
    {k: 'trans', entry: 'media', icon: 'translate', hue: 'green',   title: '转录并翻译',   desc: '转录完自动润色、翻译、对齐时间轴', ai: true},
    {k: 'clean', entry: 'media', icon: 'mic',       hue: 'orange',  title: '剪口播',       desc: '转录完自动找出口癖、长停顿与坏拍', ai: true},
    {k: 'ask',   entry: 'media', icon: 'agent',     hue: 'purple',  title: '交给 Agent',   desc: '用一句话交代组合活', ai: true, agentOnly: true},
    {k: 'anim',  entry: 'agent', icon: 'anim',       hue: 'blue',    title: '动画视频',     desc: '产品介绍、知识讲解、数据故事', ai: true, agentOnly: true,
      skill: 'baocut', hint: '讲什么、给谁看、大概多长',
      examples: ['把这份 PDF 做成一条 60 秒的产品介绍动画', '用三个数据讲清楚今年的增长，配上动态图表']},
    {k: 'board', entry: 'agent', icon: 'whiteboard', hue: 'orange',  title: '白板教学动画', desc: '一段文字或一段音频，手绘逐笔画出来，笔迹跟着旁白走', ai: true, agentOnly: true,
      skill: 'baocut', hint: '要讲清楚的一个概念，或一份讲义',
      examples: ['用手绘白板讲清楚复利是怎么滚起来的', '把这张流程图一步一步画出来并配上讲解']},
    {k: 'math',  entry: 'agent', icon: 'math',       hue: 'green',   title: '数学教学动画', desc: '公式、图形与连续变换的推导过程', ai: true, agentOnly: true,
      skill: 'baocut', hint: '一道题、一个定理，或一页教材',
      examples: ['讲解导数的几何意义：割线怎么变成切线', '一步步证明勾股定理，图形要跟着动']},
    /* 贴纸动画（2026-09-25）：skill 的片型卡「贴纸拼贴」（references/video/genres.md），认它的原词就是「贴纸动画」。
       desc / examples 里不写「手绘」「白板」这类别的类型的关键词，免得框下猜错。 */
    {k: 'sticker', entry: 'agent', icon: 'sticker', hue: 'magenta', title: '贴纸动画', desc: '插画贴纸一张张贴上，贴好还轻轻摆', ai: true, agentOnly: true,
      skill: 'baocut', hint: '讲什么，或一份旁白稿',
      examples: ['用一组贴纸讲一只乌龟慢慢长大的故事', '把这篇读书笔记做成剪贴簿风格的短片']},
    {k: 'free',  entry: 'agent', icon: 'sparkle',    hue: 'purple',  title: '自由发挥',     desc: '不限类型，说清楚要什么', ai: true, agentOnly: true,
      hint: '想做什么样的视频',
      examples: ['做一条 30 秒的竖屏倒计时开场', '把这几张截图串成一条功能更新预告']},
  ];

  const RATIOS = ['16:9', '9:16', '1:1'];
  const RECENT_MAX = 5;

  const goal = (k) => (k === 'blank' ? BLANK : GOALS.find((g) => g.k === k) || GOALS[0]);
  const goalsOf = (entry) => GOALS.filter((g) => g.entry === entry);

  const BLANK = {k: 'blank', entry: 'blank', icon: 'blank', hue: 'gray', title: '空白视频', desc: '不转录、不排队，立即可用'};

  /** Agent 框下面的固定流程，两组：不需要 AI 的 / 转录后还要 AI 接着做的。
      「交给 Agent」不在这里——带着视频说一句话，走的就是页顶那只框。 */
  function flowGroups() {
    const gs = goalsOf('media').filter((g) => !g.agentOnly);
    return [
      {k: 'local', label: '不需要 AI', note: '只用本机语音模型，装好就能用', items: gs.filter((g) => !g.ai).concat([BLANK])},
      {k: 'ai',    label: '需要 AI 的固定流程', note: '转录完自动接着做，一次跑完', items: gs.filter((g) => g.ai)},
    ];
  }

  /** Agent 框下的「做哪一类」：可选，不选就由这句话决定。 */
  const kinds = () => goalsOf('agent').filter((g) => g.k !== 'free');
  /* 时长换成秒：Shorts 的两档预设（`s` / `m`，model-shorts.js）与模板清单的 `<秒数>s`（5–600 秒，步长 5）。
     起始页没有画幅与时长设置（product-design §3.2.1）：Agent 从那句话里看出来，没说的按内容决定。 */
  const lengthSeconds = k => {
    if (k === 's') return 30;
    if (k === 'm') return 60;
    if (k === 'l') return 180;
    const seconds = typeof k === 'string' && /^\d+s$/.test(k) ? +k.slice(0, -1) : 0;
    return seconds >= 5 && seconds <= 600 && seconds % 5 === 0 ? seconds : null;
  };
  const lengthLabel = k => {
    const seconds = lengthSeconds(k);
    if (!seconds) return null;
    const minutes = Math.floor(seconds / 60), rest = seconds % 60;
    return '约 ' + (minutes ? minutes + ' 分钟' : '') + (rest ? (minutes ? ' ' : '') + rest + ' 秒' : '');
  };
  /** 按 Shorts 做时跟在那句话后面的那一行（画幅锁 9:16、时长只剩两档）；不按 Shorts 做时为空。 */
  const specLine = (o) => (o && o.shorts ? SH().promptLine(lengthLabel(SH().clampLength(o.length))) : '');

  /* ---------- 路线：从一句话和材料里看出要走哪条 ----------
     带了视频或音频 → 先建项转录，再按这句话继续（ask）；用户点过类型 → 听用户的；
     否则按关键词猜，猜不出就是自由发挥。猜的结果显示在框下，随时能改。 */
  const HINTS = [
    ['sticker', /贴纸|剪贴簿|拼贴|sticker|collage|scrapbook/i],   // 排第一：「手绘贴纸」要落在贴纸，不落白板
    ['board', /白板|手绘|逐笔|板书|whiteboard/i],
    ['math',  /数学|公式|定理|证明|导数|积分|函数|几何|方程|勾股|math/i],
    ['anim',  /动画|动效|图表|数据故事|产品介绍|讲解|explainer|motion/i],
  ];
  const isMedia = (f) => !!f && f.kind === 'media';
  function route(text, files, picked) {
    const media = (files || []).find(isMedia) || null;
    const sc = scene(picked);
    if (media) return {goal: 'ask', media: media.name, by: 'media', scene: sc ? sc.k : null};
    if (sc && sc.media) return {goal: 'ask', media: null, by: 'scene', scene: sc.k};
    if (picked && goal(picked).entry === 'agent') return {goal: picked, media: null, by: 'pick', scene: sc ? sc.k : null};
    const t = String(text || '');
    const hit = HINTS.find(([, re]) => re.test(t));
    return {goal: hit ? hit[0] : 'free', media: null, by: hit ? 'guess' : 'none', scene: null};
  }

  /* ---------- 常用场景：点一下，替用户把那句「触发对应 skill 的话」写进输入框 ----------
     那句话**直接写进 textarea**，用户接着就能改（换一门语言、加一句要求），不用多点一步。
     框里只记一件事：`auto` = 上次替他写进去的那一句原文。换场景时，那一句还原样在就换掉它；
     用户动过它一个字，它就是用户写的了，谁也不再碰——只在后面另起一行补新的。
     `media`: 这个场景处理的是一条视频或音频，没附素材不能起跑。
     做新视频的四个场景：框里已经有话 → 补在后面「把上面的内容做成…」；框是空的 → 写个开头让用户接着说。 */
  const make = (what, tail) => (o) => (o && o.after ? `请把上面的内容做成一条${what}${tail || ''}。` : `请做一条${what}${tail || ''}，内容是：`);
  const SCENES = [
    {k: 'trans', media: true,  skill: 'baocut',
      say: (o) => `请转录以下内容并翻译字幕，${into((o && o.targetName) || 'English')}。`},
    {k: 'clean', media: true,  skill: 'baocut',
      say: () => '请转录以下内容，再找出口癖、长停顿和说错重来的地方剪掉，应用之前先让我看一遍。'},
    {k: 'sub',   media: true,  skill: 'baocut',
      say: () => '请转录以下内容并生成字幕。'},
    {k: 'anim',  media: false, skill: 'baocut', say: make('动画视频')},
    {k: 'board', media: false, skill: 'baocut', say: make('白板手绘教学动画')},
    {k: 'math',  media: false, skill: 'baocut', say: make('数学教学动画', '，公式和图形要跟着推导动起来')},
    {k: 'sticker', media: false, skill: 'baocut', say: make('贴纸动画', '，插画贴纸配着旁白一张张贴上去')},
  ].map((x) => ({...x, title: goal(x.k).title}));
  /** Home 起始页交给 Agent 的那段话：用户自己的话在前，挂了场景模板就标一行「模板：标题」（`template`：{title}，
      见 model-home-templates.js），按 Shorts 做时最后是 Shorts 那一行。模板不代替用户输入。
      原型只标注模板；真实实现里客户端只传模板 id 与 version，由 Runtime 读 prompt.md、在前面拼上简报引导前言
      再交给智能体（template-spec §5.2）。作品示例不走这里：它的提示词已经是输入框里的文字（§5.1）。
      没填的占位符 `{{label}}` 写成 `[label]`（template-spec §5.5），不拦发送，Agent 会先问。 */
  function homePrompt(text, template, options = {}) {
    const parts = [SLOTS().forAgent(String(text || '')).trim() || (!template && options.attachments ? '根据我附上的材料制作一条视频。' : ''),
      template ? `模板：${template.title}` : '', specLine(options)];
    return parts.filter(Boolean).join('\n');
  }
  /* ---------- 快捷开始：点一下，把一句提示词放进输入框 ----------
     处理已有视频或音频的几件常见事。条目对应 GOALS 里的媒体目标（图标与标题取自那里），但不展开表单、
     也不直接发送：那句话进了输入框就是用户自己的话，可以改；素材照常从输入框的「+」或拖放加。
     带着素材发出去时路线一律是 `ask`（`route`：先建视频并转录，Agent 等转录完按这句话动手）。
     措辞避开 HINTS 里的词（动画、讲解、图表…），免得没附素材时被猜成某一类制作。 */
  /* 素材可以是文件，也可以是一条链接（视频网站的页面地址由下载工具取下来，product-design §2.7「下载视频」），
     所以提示里两样都说。翻译成哪门语言没有缺省：上次填过就沿用（`o.targetName`，记在 prefs.newProject），
     没填过留一个待填项（template-spec §5.5），不填也能发送，交给 Agent 的是 `[目标语言]`，由它先问。 */
  const TARGET_SLOT = '目标语言';
  const TRANS_TEMPLATE = `转录这个视频，并翻译成{{${TARGET_SLOT}}}，做成双语字幕。`;
  const STARTERS = [
    {goal: 'sub',   needs: '视频', link: '视频链接', say: () => '给这个视频加上字幕。'},
    {goal: 'trans', needs: '视频', link: '视频链接', say: (o) => (o && o.targetName ? `转录这个视频，并${into(o.targetName)}，做成双语字幕。` : TRANS_TEMPLATE)},
    {goal: 'clean', needs: '视频', link: '视频链接', say: () => '转录这个视频，找出口癖、长停顿和说错重来的地方，剪掉之前先让我看一遍。'},
    {goal: 'a2v',   needs: '音频', link: '链接', say: () => '把这段音频做成视频，配上背景、声波和字幕。'},
  ];
  /** 起始页「快捷开始」那一行：[{k, goal, icon, hue, title, prompt, tip}]（hue 是卡片插画的色系）。`o.targetName`：上次翻译成的语言，没有就留待填项。 */
  function homeStarters(o) {
    return STARTERS.map((x) => {
      const g = goal(x.goal);
      return {k: g.k, goal: g.k, icon: g.icon, hue: g.hue, title: g.title, prompt: x.say(o), tip: `填入提示词，再把${x.needs}拖进输入框，或贴上${x.link}`};
    });
  }
  /** 话里的第一条网页链接（http / https）；没有返回 null。Home 据此不先建空白视频，直接交给 Agent 去下载。 */
  const LINK_RE = /https?:\/\/[^\s，。、；）)」]+/i;
  /** 这句话要处理一条现成的视频或音频（「给这个视频加上字幕」「把这段音频做成视频」）：Home 没附素材也不先建空白视频，
      由会话里的 Agent 来要。认不出的说法按做新视频处理（照旧先建空白视频）。 */
  const SOURCE_RE = /[这那](个|段|条|部|支)?(视频|音频|录音|播客|片子)|\b(this|that)\s+(video|audio|recording|clip|podcast)\b/i;
  function wantsSource(text) { return SOURCE_RE.test(String(text || '')); }
  function linkIn(text) {
    const m = LINK_RE.exec(String(text || ''));
    return m ? m[0] : null;
  }
  /** 发送的那句话里「转录并翻译」的目标语言填成了什么（记下来下次沿用）；那句话已经改得认不出、或还没填，返回 null。 */
  function starterTarget(text) {
    const P = SLOTS();
    return P ? P.filled(TRANS_TEMPLATE, TARGET_SLOT, text) : null;
  }
  /** 别处带着目标来（`newProject({entry: 'media', goal})`）时要填的那一条；没有对应条目返回 null。 */
  function starter(goalKey, o) { return homeStarters(o).find((x) => x.goal === goalKey) || null; }
  function scene(k) { return SCENES.find((x) => x.k === k) || null; }
  function sceneText(k, o) { const sc = scene(k); return sc ? sc.say(o) : ''; }
  /** 自动写进去的那一句还原样在不在；在就给出它在框里的区间（画底色用）。 */
  function autoRange(text, auto) {
    if (!auto) return null;
    const i = String(text || '').lastIndexOf(auto);
    return i < 0 ? null : [i, i + auto.length];
  }
  /** 用户每改一次字都过一遍：那一句被动过，就不再算自动添加的。 */
  const syncAuto = (text, auto) => (autoRange(text, auto) ? auto : null);
  /** 去掉自动写进去的那一句（连同它前面我们自己加的那个换行）；用户的字一个不动。 */
  function stripAuto(text, auto) {
    const t = String(text || ''), r = autoRange(t, auto);
    if (!r) return t;
    const from = r[0] > 0 && t[r[0] - 1] === '\n' ? r[0] - 1 : r[0];
    return t.slice(0, from) + t.slice(r[1]);
  }
  /** 点场景磁贴。`cur` = {text, auto, scene}；回一份新的。同一张再点 = 撤掉；别的 = 换过去。 */
  function applyScene(cur, k, o) {
    const base = stripAuto(cur.text, cur.auto);
    if (cur.scene === k || !scene(k)) return {text: cur.scene === k ? base : cur.text, auto: cur.scene === k ? null : cur.auto, scene: cur.scene === k ? null : cur.scene};
    const say = sceneText(k, {...o, after: !!base.trim()});
    return {text: base && !base.endsWith('\n') ? `${base}\n${say}` : base + say, auto: say, scene: k};
  }
  /** 框下那一句：看出来的是什么、凭什么。`o.shorts`：做新视频且按 Shorts 做时，句尾补一句（内容路线不变）。 */
  function routeNote(r, o) {
    if (!r) return '';
    const note = routeNoteBase(r);
    /* 带着视频打开 Shorts（§7 二期入口）：同一句话，Agent 转录完切成几支竖屏新项目 */
    if (o && o.shortsCut && r.by === 'media') return `先给「${r.media}」建视频并转录，Agent 挑出有看点的段落，一支切成一部 9:16 新视频，并记下来源片段`;
    return o && o.shorts && (r.by === 'pick' || r.by === 'guess' || r.by === 'none') ? `${note}；按 Shorts 做` : note;
  }
  function routeNoteBase(r) {
    if (r.by === 'scene') return `「${scene(r.scene).title}」要一条视频或音频：点「+」附上，或直接拖进框里`;
    if (r.by === 'media') return `先给「${r.media}」建视频并转录，Agent 等转录完再按这句话动手`;
    const g = goal(r.goal);
    if (r.by === 'pick') return `按「${g.title}」来做`;
    if (r.by === 'guess') return `看起来是「${g.title}」，Agent 会用对应的制作 skill`;
    return '没指定类型，Agent 会按这句话自己挑做法';
  }

  /* 语言名拼进中文句子：西文名两侧留空（「翻译成 English」「English 字幕」），中文名紧贴。 */
  const latin = (s) => /^[\x20-\x7e]/.test(String(s || ''));
  const into = (name) => `翻译成${latin(name) ? ' ' : ''}${name}`;
  const pad = (name) => `${name}${latin(name) ? ' ' : ''}`;

  /* ---------- 流程：这条目标会跑哪几步、谁来跑 ---------- */
  /** `by`: 'app' 即时完成 / 'local' 本机语音模型 / 'ai' 需要 Agent 或 LLM / 'you' 停下来等用户。 */
  function pipeline(goalKey, o) {
    const opt = o || {};
    const g = goal(goalKey);
    const steps = [];
    if (g.entry === 'agent') {
      if (opt.shorts) return SH().pipeline(opt);
      if (opt.attachments) steps.push({k: 'read', label: '读你给的材料', by: 'ai'});
      steps.push({k: 'script', label: '写脚本与分镜', by: 'ai'});
      steps.push({k: 'build', label: '制作画面', by: 'ai'});
      steps.push({k: 'review', label: '你来看成片', by: 'you'});
      return steps;
    }
    if (opt.url) steps.push({k: 'download', label: '下载视频', by: 'app'});
    if (opt.tpl) steps.push({k: 'tpl', label: '套用模板', by: 'app'});
    if (goalKey === 'a2v') steps.push({k: 'canvas', label: '铺背景与声波', by: 'app'});
    if (goalKey !== 'a2v' || opt.subs !== false) steps.push({k: 'transcribe', label: '转录', by: 'local'});
    if (goalKey === 'trans') {
      steps.push({k: 'polish', label: '润色原文', by: 'ai'});
      steps.push({k: 'translate', label: into(opt.targetName || '目标语言'), by: 'ai'});
      steps.push({k: 'align', label: '对齐时间轴', by: 'ai'});
    } else if (goalKey === 'clean') {
      steps.push({k: 'cleanup', label: '找可剪的口', by: 'ai'});
      steps.push(opt.review === false ? {k: 'apply', label: '应用剪口', by: 'app'} : {k: 'review', label: '你来审阅', by: 'you'});
    } else if (goalKey === 'ask') {
      // 带着视频打开 Shorts：转录之后换成切片版的六步（BC_SHORTS.cutPipeline，§7）
      if (opt.shortsCut) return steps.concat(SH().cutPipeline());
      steps.push({k: 'agent', label: 'Agent 按你的话继续', by: 'ai'});
    }
    return steps;
  }

  /* ---------- AI 闸门 ----------
     需要 AI 的目标，没有可用的执行者就不让起跑——否则转录完流程停在半路，用户回来看到的
     是一份没翻译的字幕。`runner` 是 model-agent.js::resolveRunner 的返回，`avail` 是 agentAvailability。 */
  function aiGate(goalKey, runner, avail) {
    const g = goal(goalKey);
    if (!g.ai) return {ok: true, need: false};
    const a = avail || {state: 'missing'};
    if (g.agentOnly) {
      return a.ready ? {ok: true, need: true, by: 'agent'}
        : {ok: false, need: true, why: a.state === 'off' ? 'agent-off' : 'agent-missing'};
    }
    if (runner && runner.ready) return {ok: true, need: true, by: runner.kind};
    if (!runner) return {ok: false, need: true, why: 'none'};
    return {ok: false, need: true, why: runner.kind === 'agent' ? (a.state === 'off' ? 'agent-off' : 'agent-missing') : 'key-missing'};
  }

  /** 闸门没过时的引导：一句话 + 去处。`fallback` 是不用 AI 也能先做的那一个目标。 */
  function gateGuide(goalKey, gate) {
    if (!gate || gate.ok) return null;
    const g = goal(goalKey);
    const fallback = g.entry === 'media' ? 'sub' : null;
    const base = {
      'agent-off':     {title: '已安装的编码 Agent 都停用了', fix: '启用 Agent', route: {r: 'settings', sec: 'agent'}, enable: true},
      'agent-missing': {title: '这一项要交给编码 Agent', fix: '连接 Agent', route: {r: 'settings', sec: 'agent'}},
      'key-missing':   {title: '选中的模型还没连接密钥', fix: '连接云端模型', route: {r: 'settings', sec: 'cloud'}},
      'none':          {title: '还没有可用的 AI', fix: '连接 Agent', route: {r: 'settings', sec: 'agent'}},
    }[gate.why];
    const body = gate.why === 'agent-off'
      ? '这台电脑上装过编码 Agent，只是在设置里停用了。启用一个，这里就能直接开始。'
      : g.agentOnly
      ? '装 Claude Code 或 Codex CLI 并用你自己的订阅登录，回到这里就能直接开始。'
      : `「${g.title}」在转录之后要交给 AI 接着做。先连上一个，才能保证开始后一次跑完。`;
    return {...base, body, fallback};
  }

  /** 一次跑完的那句承诺：谁来做决定了措辞；剪口播默认停在审阅。 */
  function oneShotNote(goalKey, runner, o) {
    const g = goal(goalKey);
    if (!g.ai) return g.k === 'a2v' ? '建好视频画面就在，字幕转录完自动上画面。' : '视频一建好就能进编辑器，字幕转录完自动出现。';
    if (g.entry === 'agent') return 'Agent 在这部视频的会话里制作，写入视频前会按访问模式问你。';
    if (g.k === 'ask') return '转录在后台跑，Agent 会等它完成再动手；写入视频前会按访问模式问你。';
    const agent = runner && runner.kind === 'agent';
    const tail = g.k === 'clean' && !(o && o.review === false) ? '分析完停在审阅，剪哪里由你定。' : '中途不再问你。';
    return `开始后一次跑完：转录结束自动交给${agent ? ' Agent' : '模型'}，${agent ? '这条流程要写的内容已预先允许，' : ''}${tail}`;
  }

  /** 主按钮：按钮上写结果。 */
  function cta(goalKey, o) {
    const opt = o || {};
    const g = goal(goalKey);
    if (g.entry === 'blank' || goalKey === 'blank') return '创建空白视频';
    if (g.entry === 'agent') return '交给 Agent 制作';
    const pre = opt.url ? '下载并' : '';
    if (goalKey === 'sub') return `${pre}生成字幕`;
    if (goalKey === 'a2v') return `${pre}做成视频`;
    if (goalKey === 'trans') return `${pre}转录并${into(opt.targetName || '目标语言')}`;
    if (goalKey === 'clean') return `${pre}转录并找可剪的口`;
    return `${pre}建视频并交给 Agent`;
  }

  /** 起跑条件：有话或有材料就能发（哪怕只是普通聊天，缺素材交给 Agent 自己去要）；
      三样都没有才拦。`prompt` 是框里能当交代用的话（含点磁贴时替他写的那一句），
      `own` 是用户自己写的那部分——**没素材时只认 `own`**，不然点一张磁贴就算「说过话」了。
      固定流程那一栏两样都不传，所以那里素材仍然是硬条件。 */
  function canStart(goalKey, o) {
    const opt = o || {};
    const g = goal(goalKey);
    if (goalKey === 'blank') return {ok: true};
    if (opt.gate && !opt.gate.ok) return {ok: false, why: '先连接 AI'};
    if (g.entry === 'agent') return opt.prompt || opt.attachments ? {ok: true} : {ok: false, why: '先说一句要做什么，或附上材料'};
    if (!opt.media) return (opt.own !== undefined ? opt.own : opt.prompt) || opt.attachments ? {ok: true} : {ok: false, why: '先选一个视频或音频'};
    if (goalKey === 'ask' && !opt.prompt) return {ok: false, why: '再说一句要对这条素材做什么'};
    if (goalKey === 'trans' && opt.sameLang) return {ok: false, why: '目标语言和原文相同'};
    return {ok: true};
  }

  /** 后续链：转录完成后自动起的那一条任务（一次跑完靠它）。没有后续返回 null。 */
  function chainOf(goalKey, o) {
    const opt = o || {};
    if (goalKey === 'trans') return {kind: 'translate', title: into(opt.targetName || ''), phases: ['润色原文', '翻译', '对齐时间轴'],
      doneToast: `翻译完成 · ${pad(opt.targetName || '译文')}字幕已上画面`};
    if (goalKey === 'clean') return {kind: 'cleanup', title: '找可剪的口', phases: ['读文稿', '找可剪的口'],
      doneToast: opt.review === false ? '剪口已应用 · 可在粗剪视图撤销' : '可剪的口找好了 · 打开粗剪视图审阅'};
    return null;
  }

  /* ---------- 记忆：上次怎么做的 ----------
     存在 prefs.newProject：{entry, goal, agentGoal, target, targets[], targetName, dir, tpl, ratio, bilingual, shorts}。`ratio` 只是空白视频的画幅。
     入口默认是 agent（页顶的框一直在）；`entry` 记的是上次用的哪条路，决定进页时下面展不展开固定流程。
     `targets` 是最近翻过的语言（去重、最多 5 门、最近的在前）。 */
  function seed(mem) {
    const m = mem || {};
    const entry = ENTRIES.some((e) => e.k === m.entry) ? m.entry : 'agent';
    const mediaGoal = goalsOf('media').some((g) => g.k === m.goal) ? m.goal : 'sub';
    const agentGoal = scene(m.agentGoal) ? m.agentGoal : null;
    return {
      entry, goal: mediaGoal, agentGoal,
      target: m.target || 'en', bilingual: m.bilingual !== false,
      /* 快捷开始「转录并翻译」上次填的目标语言（原话，不是语言代码）；没填过是 null，提示词里留待填项。 */
      targetName: typeof m.targetName === 'string' && m.targetName.trim() ? m.targetName.trim() : null,
      /* 起始页上次选的项目（目录 id）；null = 不用项目。目录还在不在由页面对照项目列表判断。 */
      dir: typeof m.dir === 'string' && m.dir ? m.dir : null,
      tpl: m.tpl || null, ratio: RATIOS.includes(m.ratio) ? m.ratio : '16:9',
      shorts: m.shorts === true ? true : null,   // 亲手打开过就接着开；没拨过是 null，按那句话猜
    };
  }

  function remember(mem, run) {
    const m = {...(mem || {})};
    const r = run || {};
    if (r.entry) m.entry = r.entry;
    if (r.entry === 'media' && r.goal) m.goal = r.goal;
    if (r.entry === 'agent') {
      m.agentGoal = r.picked || null;          // 只记用户亲手点的类型；猜出来的不记
      /* Shorts 开关只记亲手拨的：开了记住，关了忘掉（下次仍按那句话猜）；猜出来的不记。 */
      if (r.shorts === true) m.shorts = true;
      else if (r.shorts === false) delete m.shorts;
    }
    if (r.goal === 'trans' && r.target) {
      m.target = r.target;
      m.bilingual = r.bilingual !== false;
      m.targets = [r.target].concat((m.targets || []).filter((c) => c !== r.target)).slice(0, RECENT_MAX);
    }
    if (r.targetName) m.targetName = String(r.targetName).trim();
    /* 起始页的项目选择：选了哪个记哪个，选「不用项目」记 null。 */
    if ('dir' in r) m.dir = r.dir || null;
    if ('tpl' in r) m.tpl = r.tpl || null;
    if (r.ratio && r.entry === 'blank') m.ratio = r.ratio;
    return m;
  }

  /** 目标语言下拉：最近用过的置顶一组，其余照目录顺序。 */
  function targetGroups(mem, langs) {
    const recent = ((mem && mem.targets) || []).map((c) => (langs || []).find((l) => l.code === c)).filter(Boolean);
    const rest = (langs || []).filter((l) => !recent.includes(l));
    return {recent, rest};
  }

  /** 模板下拉的置顶项：上次用的那一款（还在目录里才算）。 */
  function lastTemplate(mem, list) {
    return (mem && mem.tpl && (list || []).find((t) => t.id === mem.tpl)) || null;
  }

  /** 旧入口（六类型 ptype）落到新页的哪个入口与目标。 */
  function presetOf(ptype) {
    if (ptype === 'blank') return {entry: 'blank'};
    if (ptype === 'tpl') return {entry: 'media', goal: 'sub', pickTpl: true};
    if (ptype === 'ask') return {entry: 'agent', media: true};
    const g = GOALS.find((x) => x.k === ptype);
    return g ? {entry: g.entry, goal: g.k} : {entry: 'agent'};
  }

  const API = {homePrompt, homeStarters, starter, starterTarget, linkIn, wantsSource, lengthLabel, lengthSeconds, ENTRIES, GOALS, RATIOS, RECENT_MAX, goal, goalsOf, flowGroups, kinds, SCENES, scene, sceneText, autoRange, syncAuto, stripAuto, applyScene, specLine, route, routeNote, BLANK, pipeline, aiGate, gateGuide,
    oneShotNote, cta, canStart, chainOf, seed, remember, targetGroups, lastTemplate, presetOf};
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') Object.assign(window, {BC_NEW: API});
})();
