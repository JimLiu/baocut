/* BaoCut 原型 — Agent 会话的纯层（第 109 轮；第 110 轮加侧栏二级 / @ 引用 / 工具设置态）
   window.BC_AGENT。无 React、无 DOM，node --test 直接 require。

   这一层回答的是「算出来的东西」：会话怎么排序 / 分桶、标题从第一句话怎么截、
   编辑器里各处入口把「意图」翻成什么提示词、一句话落到哪一类计划、一条命令
   是否已被用户的「总是允许」规则放行、首页就绪清单怎么判。
   「状态怎么变」（会话追加消息、放行、撤销）归 store.jsx。

   Agent 本身**不是 BaoCut 自带的模型**：它是装在本机的 Claude Code / Codex CLI
   （用户自己的订阅），App 以子进程驱动它的 stdio，通过 baocut skill 调 `bcut`
   操作项目（docs/design/product/product-design.md §17.2）。所以这里没有任何「回答」逻辑——
   `planFor` 只是演示脚本的选择器，不是模型。 */
(function () {
  /* ---------- 时间标签 ---------- */
  function agoLabel(min) {
    const m = Math.max(0, Math.round(min || 0));
    if (m < 1) return '刚刚';
    if (m < 60) return `${m} 分钟前`;
    if (m < 60 * 24) return `${Math.floor(m / 60)} 小时前`;
    if (m < 60 * 48) return '昨天';
    return `${Math.floor(m / (60 * 24))} 天前`;
  }

  /** 会话分桶：今天 / 昨天 / 更早（按「多少分钟前」算，演示数据不带绝对时间）。 */
  function bucket(min) {
    const m = Math.max(0, min || 0);
    if (m < 60 * 24) return '今天';
    if (m < 60 * 48) return '昨天';
    return '更早';
  }

  /* ---------- 标题 ---------- */
  /** 第一句话就是标题：去掉换行与多余空白，超长截到 max 个字加省略号。
      空串给「新会话」——列表里不能出现空行。 */
  function sessionTitle(text, max) {
    const lim = max || 28;
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return '新会话';
    // 只取第一句：句号 / 问号 / 感叹号（中英）之后的都不进标题
    const first = t.split(/(?<=[。？！?!])/)[0].trim();
    return first.length > lim ? first.slice(0, lim - 1) + '…' : first;
  }

  /* ---------- 排序与分组 ---------- */
  const RANK = {running: 0, waiting: 1, idle: 2, done: 3};
  /** 在跑的永远在最上（它们需要盯着），其余按最近活动排。稳定排序：同分保持原序。 */
  function sortSessions(list) {
    return (list || []).map((s, i) => ({s, i}))
      .sort((a, b) => {
        const ra = RANK[a.s.status] == null ? 9 : RANK[a.s.status];
        const rb = RANK[b.s.status] == null ? 9 : RANK[b.s.status];
        if (ra !== rb) return ra - rb;
        const d = (a.s.ago || 0) - (b.s.ago || 0);
        return d !== 0 ? d : a.i - b.i;
      })
      .map((x) => x.s);
  }

  function groupSessions(list) {
    const order = ['今天', '昨天', '更早'];
    const map = {};
    sortSessions(list).forEach((s) => {
      const k = bucket(s.ago);
      (map[k] = map[k] || []).push(s);
    });
    return order.filter((k) => map[k]).map((k) => ({label: k, items: map[k]}));
  }

  /* ---------- harness ---------- */
  /** 挑一个能用的 harness：偏好项装着就用它，否则第一个装着的，一个都没有就 null。
      「一个都没有」是诚实的不可用，不是错误——调用方要把它画成置灰 + 说明。 */
  function pickHarness(list, preferredId) {
    // 设置里关掉的编码 Agent（enabled:false）不参与挑选——关掉就是「别用它」
    // 2026-09-18：装着却用不了的（`blocked`：跑不起来 / 版本过旧 / 登录过期，见 model-agent-setup.js::blocked）同样跳过
    const found = (list || []).filter((h) => h.found && h.enabled !== false && h.blocked !== true);
    if (!found.length) return null;
    return found.find((h) => h.id === preferredId) || found.find((h) => h.dflt) || found[0];
  }

  /** 一条会话「跑在哪」的短句；CLI 确认过的 activeModel 优先于用户的默认选择。 */
  /* composer 脚注随选中的编码 Agent 变（第 111 轮补丁）：名字 + 订阅名（account 的第一段，
     去掉「已登录」这类状态词）。没探到 / 没启用的仍写它的名字——脚注说的是「会在哪里跑」。 */
  function composerFoot(h, mode) {
    const name = (h && h.name) || 'Claude Code';
    const acct = String((h && h.account) || '').split(' · ')[0].trim();
    const sub = acct ? `用你的 ${acct}` : '用你自己的订阅';
    return `在本机 ${name} 里运行，${sub}；${modeFoot(mode)}Enter 发送，Shift+Enter 换行，@ 引用参考，/ 调用工具。`;
  }

  function harnessLabel(h, modelId, activeModel) {
    if (!h) return '未连接';
    const id = activeModel || modelId;
    const m = (h.models || []).find((x) => x.id === id);
    return `${h.name} · ${id ? (m ? m.name : id) : 'Agent 默认模型'}`;
  }

  /* 输入区窄的时候（product-design §3.2.3）：Agent 只剩图标，模型只留级别名、不要版本号。
     去掉末尾的 `[1m]`、`(1M context)` 这类标注，带大写的词按连字符拆开（`GPT-6.1-Sol`），再去掉带数字的词和打头的厂商名（后面还有词时）；
     认不出的（剩下不是一两个词、原名超过四个词、或是全小写的一整个 id）原样返回，由样式截断。
     App 端同一条规则在 packages/ui model/agent-choice.ts `compactModelLabel`。 */
  const MODEL_BRAND_WORDS = ['claude', 'gpt', 'gemini', 'grok', 'kimi', 'codex'];
  function compactModelLabel(label) {
    const full = String(label || '').trim();
    const bare = full.replace(/(\s*(\[[^\]]*\]|\([^)]*\)))+$/, '').trim();
    const words = bare.split(/\s+/).flatMap((w) => (/[A-Z]/.test(w) ? w.split('-') : [w])).filter(Boolean);
    if (!words.length || words.length > 4) return full;
    if (words.length === 1) return /\d/.test(words[0]) ? full : words[0];
    const kept = words.filter((w) => !/\d/.test(w));
    const named = kept.length > 1 && MODEL_BRAND_WORDS.includes(kept[0].toLowerCase()) ? kept.slice(1) : kept;
    if (!named.length || named.length > 2 || named.some((w) => !/^\p{L}[\p{L}'’.-]*$/u.test(w))) return full;
    return named.join(' ');
  }
  /** 窄的时候 chip 上的字样：「Agent 默认模型」写「默认」，其余取级别名。 */
  function harnessShort(h, modelId, activeModel) {
    if (!h) return '未连接';
    const id = activeModel || modelId;
    if (!id) return '默认';
    const m = (h.models || []).find((x) => x.id === id);
    return compactModelLabel(m ? m.name : id);
  }

  /* ---------- 编辑器入口 → 提示词 ----------
     入口把**意图**递过来（要做什么、范围、语言），这里翻成一句人话——用户在
     composer 里看到的是可以改的草稿，不是一串参数。项目名进句子是为了对话里
     能看出在说哪一个；真产品里 App 还会另附一行项目包路径（§17.2）。 */
  const INTENTS = {
    translate:   (o) => `把${o.p}的字幕翻译成${o.lang || '英语'}，逐句对齐时间码。翻完告诉我哪几句需要人工核对。`,
    /* 第 196 轮：过期的两种来源——原文改过、原文被剪切（剪口播剪掉了半句）。工具页把两个数递进来，
       没递就是老句式。整句被剪的译文不用译，随句一起剪掉。 */
    stale:       (o) => {
      const why = [o.edited ? `${o.edited} 句原文改过` : '', o.cut ? `${o.cut} 句原文被剪切` : ''].filter(Boolean).join('、');
      return `${o.p}有几句译文过期了${why ? `（${why}）` : '：原文改过'}，只重译这些句子，${o.cut ? '被剪切的按剪后的原文重译、整句剪掉的随句一起剪掉，' : ''}其余一个字不动。`;
    },
    polish:      (o) => `润色${o.p}的${o.scope || '全篇'}文稿：修错字、补标点、按话题分段，不改写我的表达。`,
    chapters:    (o) => `给${o.p}按话题分出章节，每章起一个短标题。`,
    speakers:    (o) => `识别${o.p}里${o.scope || '全篇'}的说话人，先把结果列给我确认再写进视频。`,
    retranscribe:(o) => `用另一个语音模型重新转录${o.p}的${o.scope || '全篇'}，范围之外一个字不动。`,
    cleanup:     (o) => `找出${o.p}${o.scope || '全篇'}里的口癖、长停顿和重复起句，先列出来，我确认后再剪。`,
    /* 剪成短视频（§15.12）：只找候选，创建项目等人在 AI 工具里挑完再做 */
    shortscut:   (o) => `从${o.p}${o.scope ? `的${o.scope}` : ''}里挑几段能单独成立的话，各剪成一支竖屏短视频。先把候选列给我挑，我确认后再创建视频。`,
    /* AI 工具重设计（§15.11）：写作两件给读的人，发布三件给发视频的人；篇幅、风格、语言、视角由工具页折进 extra。 */
    summary:     (o) => `从${o.p}的文稿提炼一份带时间码的要点总结。`,
    blog:        (o) => `把${o.p}改写成一篇可发布的博客。`,
    title:       (o) => `给${o.p}起 ${o.count || 6} 个候选标题，角度各不相同，每个写一行理由，挑一个推荐。`,
    desc:        (o) => `给${o.p}写一份发布用的简介，带章节时间码和一行标签。`,
    cover:       (o) => `给${o.p}做 ${o.count || 3} 张封面候选：先挑关键帧，每张走一条底图路线，做完逐张登记进候选库，缩小了检查一遍再给我看。`,
    export:      (o) => `把${o.p}导出成烧录字幕的 MP4，再单独导一份双语 SRT。`,
  };

  /** `extra` 是工具页设置态折进来的附加要求（第 111 轮）：勾选项、自定义指令、
      双语显示之类——一句一条，接在意图句后面；空的跳过。 */
  function intentPrompt(intent, proj) {
    const it = intent || {};
    const p = proj && proj.title ? `「${proj.title}」` : '这部视频';
    const f = INTENTS[it.kind];
    const extra = (it.extra || []).map((x) => String(x || '').trim()).filter(Boolean);
    const tail = extra.length ? extra.map((x) => (/[。！？]$/.test(x) ? x : x + '。')).join('') : '';
    if (!f) return ((it.text || '') + tail).trim();
    return f({p, lang: it.lang, scope: it.scope, edited: it.edited, cut: it.cut, count: it.count}) + tail;
  }

  /* ---------- 演示脚本：一句话落到哪一类计划 ----------
     真产品里没有这张表——计划是 agent 自己想的。原型要能演「读项目 → 规划 →
     问一次写入 → 执行 → 收据」这一整条，所以按关键词挑一份脚本。
     `write` 为 null 的计划不写项目（只回答 / 只列出建议），因此没有放行卡。 */
  const PLANS = [
    /* 剪成短视频排在最前：这句意图里的「剪成」会被 cleanup 的「剪」先抢走（§15.12）。
       这份计划只写候选库，不创建项目——挑哪几段、起止落在哪一句是人在 AI 工具里定的。 */
    {kind: 'shortscut', re: /短视频|候选库|shorts/i,
     summary: '我先读一遍文稿和章节，找几段不靠前文也听得懂的话，把起止对到句子边界上。找到的先写进候选库，你在右侧的「剪成短视频」面板里挑、调起止，确认了才创建视频——我不会直接建。',
     reads: ['bcut project info', 'transcript.json · 62 句 · 4 章 · 3 位说话人'],
     write: {cmd: 'bcut shorts find project.bcut --count 3 --spare 2', why: '只写候选库（shorts/candidates.json），不创建视频，也不动时间轴和文稿。'},
     step: {verb: '从', count: 62, unit: '句文稿里找候选片段', llm: true},
     task: {kind: 'shorts-cut', title: '剪成短视频 · 找片段'},
     receipt: '已写入候选库 · 5 段候选 · 7.2s',
     close: '找好了：5 段候选，先替你选了把握大的 3 段。在「剪成短视频」面板里挑——可以改标题、一句一句挪起止、自己再加一段，确认后才会创建视频。',
     open: {tool: 'shortscut', label: '剪成短视频'}},
    /* 过期译文排在最前：这句意图里有「剪切」也有「译文」，落到 translate / cleanup 都不对（第 196 轮）。 */
    {kind: 'stale', re: /过期|重译|被剪切|剪后/,
     summary: '我先对一遍原文与译文：哪些句子原文改过、哪些句子的原文被剪掉了半句。只重译这几句，按剪后的原文译；整句剪掉的译文随句一起剪，其余一个字不动。写入前会先问你。',
     reads: ['bcut project info', 'transcript.json · 62 cues · 已有 English', 'ai/reviews/cleanup.json · 已剪 9 处'],
     write: {cmd: 'bcut translate project.bcut --lang en --only-stale --after-cut', why: '只重写这几句的 trans[en] 与 transAlign[en]，其余译文与原文一个字不动；可整条撤销。'},
     step: {verb: '重译', count: 7, unit: '句过期译文', llm: true},
     task: {kind: 'stale', title: '刷新过期译文', undoBody: '这几句译文会回到刷新前的样子。原文与剪辑不受影响。'},
     receipt: '已应用 · 重译 3 句改过原文的译文、4 句原文被剪切的译文 · 5.3s',
     close: '刷新完了：7 句——3 句因为你改了原文，4 句因为剪口播剪掉了半句，都按现在的原文重译了。整句被剪掉的没有，所以一句都没删。'},
    /* 配音排在翻译前面：「翻译配音」里的「翻译」会被 translate 先抢走。 */
    {kind: 'dub', re: /配音/,
     summary: '我先读译文和每位说话人的声音，再逐句合成配音并对一遍时长。超出原句时长的那几句先列给你，你定了怎么处理我才写进视频。',
     reads: ['bcut project info', 'transcript.json · 62 句 · 已有 English', '本机语音合成模型 · 已安装'],
     write: {cmd: 'bcut dub project.bcut --lang en', why: '会新增一组 English 配音轨；原声与已有配音不动，可整条撤销。'},
     step: {verb: '配音', count: 62, unit: '句', llm: false, engine: '本机语音合成模型'},
     task: {kind: 'agent-dub', title: '翻译配音 · English', undoBody: '这一组配音会被移除。原声、译文与其他配音不受影响。'},
     receipt: '已应用 · 配音 62 句 · 48s',
     close: '配好了，有几句比原句长。在「翻译配音」面板里看时长对比，逐句决定压语速还是改译文。',
     open: {tool: 'dub', label: '翻译配音'}},
    {kind: 'translate', re: /翻译|译成|译文|english|英文|英语|日文|日语|韩文|韩语/i,
     summary: '我先读一遍文稿和已有的译文，再用 bcut translate 逐句翻译并按词级时间对齐。写入视频前会先问你。',
     reads: ['bcut project info', 'transcript.json · 62 cues · 3 位说话人 · 已有 English / 日本語'],
     write: {cmd: 'bcut translate project.bcut --lang en', why: '会写入 transcript.json 的 trans[en] 与 transAlign[en]；原文一个字不动，可整条撤销。'},
     step: {verb: '翻译', count: 42, unit: '句', llm: true},
     task: {kind: 'translate', title: '翻译 · 中 → English', target: 'en', undoBody: '这一门语言的译文会被移除。原文一个字不动。'},
     receipt: '已应用 · 翻译 42 句 · 拆分对齐 68 块 · 31.4s',
     close: '翻完了。有 3 句译文停留时间比原文长，我在翻译面板里标成了黏结——建议你看一眼再导出。'},
    /* 裁剪排在找可剪的口前面：「裁剪」里的「剪」会被 cleanup 先抢走。 */
    {kind: 'crop', re: /智能裁剪|裁剪|画幅/,
     summary: '我先逐镜头找出画面里的重点（发言人、白板），给每个镜头排一份新画幅的构图。构图先给你复核，你确认了才生成新画幅的视频。',
     reads: ['bcut project info', '原片 · 1920×1080 · 3 分 26 秒'],
     write: {cmd: 'bcut crop project.bcut --ratio 9:16 --review', why: '只写构图方案（crop/plan.json），不动原片和时间轴；你复核后才生成。'},
     step: {verb: '分析', count: 206, unit: '秒画面里的重点', llm: false, engine: '本机视觉模型'},
     task: {kind: 'agent-crop', title: '智能裁剪 · 9:16', undoBody: '这份构图方案会被移除。原片与时间轴不受影响。'},
     receipt: '已写入构图方案 · 等你复核 · 14s',
     close: '排好了，有几处拿不准跟谁，我标了出来。在「智能裁剪」面板里逐镜头复核，确认后才生成新画幅。',
     open: {tool: 'crop', label: '智能裁剪'}},
    {kind: 'cleanup', re: /口癖|停顿|剪掉|剪|重复|空拍|嗯|啊/,
     summary: '我先扫一遍词级时间：口癖、≥0.8s 的长停顿、重复起句。结果先以划线形态进粗剪审阅，你逐条决定留还是剪——我不会直接动时间轴。',
     reads: ['bcut project info', 'transcript.json · 词级时间 · 3 分 26 秒'],
     write: {cmd: 'bcut cleanup project.bcut --review', why: '只写剪辑**建议**（review 覆盖层），不改 clip；你在编辑器里逐条接受后才生效。'},
     step: {verb: '扫描', count: 206, unit: '秒的词级时间', llm: true},
     task: {kind: 'cleanup', title: '找可剪的口', undoBody: '剪辑建议会被移除。已经接受的剪辑不受影响。'},
     receipt: '已应用 · 写入 9 处剪辑建议 · 共 12.1s · 6.7s',
     close: '列好了：9 处，合计 12.1s——口癖 3、重复起句 3、长停顿 3，每章都有。到文稿的剪辑模式里逐条看，划线是建议、点一下接受或忽略；也可以在那儿一键全部接受。'},
    /* 起标题排在章节前面：chapters 的「标题」只该接「给每章起标题」这一类。 */
    {kind: 'title', re: /起标题|视频标题|候选标题/,
     summary: '我先读一遍文稿，从几个不同的角度各起一个标题，每个写一行理由。标题不写进视频，你挑一个选用。',
     reads: ['bcut project info', 'transcript.json · 42 段 · 4 章'], write: null,
     close: '起了 6 个候选，各带一行理由。在「起标题」面板里挑一个选用，随时可以换。',
     open: {tool: 'title', label: '起标题'}},
    {kind: 'chapters', re: /章节|分章|标题|起名|命名/,
     summary: '章节是按段落话题聚合出来的。我先读段落结构，如果还没润色分段就先跑一遍润色，再生成章节标题。',
     reads: ['bcut project info', 'transcript.json · 9 段 · 4 章'],
     write: {cmd: 'bcut chapters project.bcut', why: '会替换 transcript.json 的章节表（保 id 与边界，只改标题与分组）；可整条撤销。'},
     step: {verb: '重写', count: 4, unit: '个章节标题', llm: true},
     task: {kind: 'chapters', title: '生成章节', undoBody: '生成的章节会被移除，文稿回到没有章节的状态。段落本身不动。'},
     receipt: '已应用 · 4 章 → 4 章、重写 4 个标题 · 8.1s',
     close: '四章标题都换短了：开场 / 为什么本地 / 渲染怎么做 / 下一步。点章节头可以直接改。'},
    {kind: 'polish', re: /润色|错字|标点|分段|整理文稿/,
     summary: '润色只修可以确定是笔误的地方：错字、标点、分段，不改写你的话。我会逐段给 diff。',
     reads: ['bcut project info', 'transcript.json · 62 cues'],
     write: {cmd: 'bcut polish project.bcut', why: '会改 transcript.json 的 cue 文本与段落表；词级时间不动，可整条撤销。'},
     step: {verb: '润色', count: 42, unit: '段', llm: true},
     task: {kind: 'polish', title: '润色文稿', undoBody: '润色改过的错字、标点与分段会全部还原。词级时间不受影响。'},
     receipt: '已应用 · 润色 42 段、重新分段 · 12.4s',
     close: '改了 17 处：3 处错字（definately → 还）、9 处标点、5 处分段。文稿里已经是改后的样子，不满意可以整条撤销。'},
    {kind: 'speakers', re: /说话人|谁在说|分角色/,
     summary: '识别说话人是唯一一个**应用前要你确认**的活：我先跑声纹聚类，把结果列给你，你确认后才写进视频。',
     reads: ['bcut project info', '本机声纹模型 · 已安装'],
     write: {cmd: 'bcut speakers project.bcut --apply', why: '会给每条 cue 写上说话人；译文内容不变，只影响字幕行切分。可整条撤销。'},
     step: {verb: '识别', count: 62, unit: '句的说话人', llm: false, engine: '本机声纹模型'},
     task: {kind: 'speakers', title: '识别说话人', undoBody: '说话人标注会被移除。译文内容不变。'},
     receipt: '已应用 · 识别出 3 位说话人 · 9.2s',
     close: '3 位：林澈 24 句、周远 21 句、苏黎 17 句。有 2 句我不太确定（00:47、01:12），在文稿里标了问号。'},
    {kind: 'retranscribe', re: /重新转录|重转|重跑转录/,
     summary: '我换一个语音模型重跑音频，只替换这一范围的词级数据；范围之外的文稿、字幕与译文一个字不动。',
     reads: ['bcut project info', '本机语音模型 · 已安装 2 个'],
     write: {cmd: 'bcut transcribe project.bcut --redo', why: '会替换这一范围的词级数据；字幕切分与译文对齐跟着重算，改过的译文标成过期。可整条撤销。'},
     step: {verb: '重新转录', count: 42, unit: '段', llm: false, engine: '本机语音模型'},
     task: {kind: 'retranscribe', title: '重新转录', undoBody: '这一范围的词级数据会还原成重跑之前的那一份。范围之外一个字不动。'},
     receipt: '已应用 · 重新转录整篇 3 分 26 秒 · 41s',
     close: '重跑完了。有 5 句译文因为原文变了标成过期，要我顺手刷新吗？'},
    /* 写作与发布：只读文稿与画面，不写进视频，所以没有放行卡、也不落任务收据。 */
    {kind: 'summary', re: /总结|摘要|要点/,
     summary: '我先读一遍文稿和章节，再写一段正文加几条带时间的要点。不改文稿。',
     reads: ['bcut project info', 'transcript.json · 42 段 · 4 章'], write: null,
     close: '写好了：一段正文加几条带时间的要点。在「写总结」面板里看，点时间能跳到那里。',
     open: {tool: 'summary', label: '写总结'}},
    {kind: 'blog', re: /博客|文章/,
     summary: '我先读一遍文稿，再改写成一篇可以直接发的文章。不改文稿。',
     reads: ['bcut project info', 'transcript.json · 42 段 · 4 章'], write: null,
     close: '写好了，按章节分了小标题。在「写博客」面板里看，可以拷走或让我再改。',
     open: {tool: 'blog', label: '写博客'}},
    {kind: 'desc', re: /简介/,
     summary: '我先读文稿和章节，再写一份发布用的简介，带章节时间码和一行标签。不改文稿。',
     reads: ['bcut project info', 'transcript.json · 42 段 · 4 章'], write: null,
     close: '写好了：简介正文、章节时间码和一行标签。在「写简介」面板里看。',
     open: {tool: 'desc', label: '写简介'}},
    {kind: 'cover', re: /封面/,
     summary: '我先从成片里挑几张关键帧，每张走一条底图路线做成封面候选，缩小了检查一遍再给你看。封面不写进视频，你挑一张选用。',
     reads: ['bcut project info', '成片 · 3 分 26 秒 · 6 个镜头'], write: null,
     close: '做了 3 张候选。在「做封面」面板里挑一张选用，也可以指着某一张让我再改。',
     open: {tool: 'cover', label: '做封面'}},
    {kind: 'export', re: /导出|srt|mp4|成片|烧录/i,
     summary: '导出不改视频，只产出文件。我按你的字幕设置烧录，SRT 走双语内容。',
     reads: ['bcut project info', '字幕轨 · 中 + English · 3 句缺译'],
     write: {cmd: 'bcut export project.bcut --to mp4 && bcut export project.bcut --to srt --content both', why: '会写两个文件到视频的 out/ 目录。不改视频本身。'},
     step: {verb: '导出', count: 2, unit: '个文件', llm: false, engine: '本机渲染'},
     task: {kind: 'export', title: '导出 · MP4 + 双语 SRT'},
     receipt: '已完成 · kelang-ep42.zh-en.mp4 · 482 MB · kelang-ep42-both.srt',
     close: '两个文件都在 out/ 里。注意有 3 句缺译，烧录时留空了——要我先补译再重导吗？'},
  ];

  /* `open`：这一跑的结果要在哪个工具面板里看（product-design §5.10）。跑完时视频开着就直接打开那个面板；
     收尾话下面留一个同名按钮，视频没开着（Home 会话）时由它连视频一起打开。 */
  const CUSTOM = {
    kind: 'custom',
    /* 回复正文是 Markdown：加粗、行内代码、列表与围栏代码块都在这一条里，流式显示时能看到尾部补全与代码块的样子 */
    summary: [
      '我先看一下视频里有什么，再给你一个**计划**。会读这几样，都是只读：',
      '',
      '- 视频信息：时长、说话人、章节，来自 `bcut project info`',
      '- 文稿与译文：`./transcript.json`，看分段和已有的语言',
      '- 剪辑建议：`ai/reviews/cleanup.json:1-40`，有的话一起看',
      '',
      '读的时候跑的是这两条命令，不改任何文件：',
      '',
      '```sh',
      'bcut project info project.bcut',
      'bcut transcript stats project.bcut --by chapter',
      '```',
      '',
      '读完我会列出可以先做的几步，你挑一步，我再动手。',
    ].join('\n'),
    /* 读的步骤可以是字符串（老写法，按写法推类别），也可以带 kind / summary / out；有一步失败，演示失败行的样子 */
    reads: [
      {cmd: 'bcut project info project.bcut', kind: 'command', out: 'duration 206s · 3 speakers · 4 chapters · 62 cues'},
      {cmd: '读取 transcript.json', kind: 'read', summary: 'transcript.json', out: '62 句 · 4 章 · 已有 English'},
      {cmd: 'bcut transcript stats project.bcut --by chapter', kind: 'command', exitCode: 1,
       error: 'transcript stats: 未知参数 --by\n可用参数：--chapter <n>、--json'},
      {cmd: 'rg -c "嗯|就是|那个" transcript.json', kind: 'search', summary: '嗯|就是|那个', out: 'transcript.json:23'},
    ],
    write: null,
    close: '看完了：3 分 26 秒、3 位说话人、4 章、已有 English 译文。你想从哪一步开始——加字幕已经做完，我可以帮你剪口癖、翻第二门语言，或者直接导出。',
  };

  /** 按关键词挑脚本；没有项目上下文时不会有「写入」——先问清楚。 */
  /* 翻译脚本的目标语跟着话里的语言走（第 207 轮）：任务记录要带 `target`，
     字幕面板才知道这一跑压在哪门语言上（轨条尾巴 / 只看原文时的进度条都读它）。 */
  const TRANSLATE_TARGETS = [
    [/日文|日语|japanese/i, 'ja', '日本語'],
    [/韩文|韩语|korean/i, 'ko', '한국어'],
  ];
  function translateTarget(text) {
    const hit = TRANSLATE_TARGETS.find(([re]) => re.test(text));
    return hit ? {code: hit[1], name: hit[2]} : {code: 'en', name: 'English'};
  }

  /* 斜杠命令直接点名计划，不走关键词（product-design §5.10）。data.js 的 `agent.slash` 列的就是这些键。 */
  const SLASH_KINDS = {
    '/crop': 'crop', '/shorts': 'shortscut', '/polish': 'polish', '/chapters': 'chapters', '/speakers': 'speakers',
    '/retranscribe': 'retranscribe', '/clean': 'cleanup', '/translate': 'translate', '/refresh': 'stale', '/dub': 'dub',
    '/summary': 'summary', '/blog': 'blog', '/title': 'title', '/desc': 'desc', '/cover': 'cover', '/export': 'export',
  };
  function slashKind(text) {
    const m = /^\s*(\/[a-z]+)(?=\s|$)/i.exec(String(text || ''));
    return m ? SLASH_KINDS[m[1].toLowerCase()] || null : null;
  }

  /* 挂着场景模板发来的消息（Home 标了一行「模板：标题」）：先确认简报，确认之前不开始制作、不跑工具
     （template-spec §5.2 简报引导前言的语义）。真实的前言与提问由 Runtime 和智能体给出，这里只演示这一步。 */
  const TEMPLATE_LINE = /^模板：(.+)$/m;
  function briefPlan(title) {
    return {kind: 'brief', reads: [], write: null, task: null, close: null,
      summary: `这是场景模板「${title}」。开始制作前，先和你确认简报：\n\n1. 主题：这条视频讲什么\n2. 目标：希望观众看完做什么或记住什么\n3. 受众：给谁看\n4. 手头的材料：文件、链接或文字，没有也可以\n\n你已经说过的我不再问。画幅与时长先按模板的默认值，要改直接告诉我。回复确认或补充后，我再开始制作。`};
  }
  /* 话里还留着没填的待填项（快捷开始、作品示例的 `{{label}}` 发出去写成 `[label]`，template-spec §5.5）：
     先问，不猜一个值就开工——例如「转录并翻译」没写目标语言，不默认成任何一种语言（开发流程 §4）。 */
  const MISSING_RE = /\[([^[\]\n]{1,24})\]/g;
  function missingSlots(text) {
    const seen = [];
    String(text || '').replace(MISSING_RE, (_, label) => { if (!seen.includes(label)) seen.push(label); return _; });
    return seen;
  }
  function askPlan(labels) {
    return {kind: 'brief', reads: [], write: null, task: null, close: null,
      summary: `开始之前先确认一下：${labels.map((x) => `「${x}」`).join('、')}你还没写。告诉我之后我就开始；有链接或素材的话，也可以一起发给我。`};
  }
  /** 有没填的待填项就先问的那一轮；没有返回 null。模板任务走 briefPlan，不在这里。 */
  function askFor(text) {
    const t = String(text || '');
    if (TEMPLATE_LINE.test(t)) return null;
    const labels = missingSlots(t);
    return labels.length ? askPlan(labels) : null;
  }
  function planFor(text, hasProject) {
    const t = String(text || '');
    const tpl = t.match(TEMPLATE_LINE);
    if (tpl) return briefPlan(tpl[1].trim());
    const ask = askFor(t);
    if (ask) return ask;
    const named = slashKind(t);
    let hit = (named && PLANS.find((p) => p.kind === named)) || PLANS.find((p) => p.re.test(t)) || CUSTOM;
    if (hit.kind === 'translate') {
      const tg = translateTarget(t);
      hit = Object.assign({}, hit, {
        write: Object.assign({}, hit.write, {cmd: hit.write.cmd.replace(/--lang \w+/, '--lang ' + tg.code)}),
        task: Object.assign({}, hit.task, {title: '翻译 · 中 → ' + tg.name, target: tg.code}),
      });
    }
    if (!hasProject) {
      return Object.assign({}, hit, {
        write: null, task: null,
        summary: '这条会话还没选视频。把视频拖进来、贴上视频链接，或者在下面选一部视频，我就能开始。',
        close: null,
      });
    }
    return hit;
  }

  /* ---------- 放行规则 ----------
     「总是允许」记的是**命令前缀**（`bcut translate`），不是整条命令——
     同一个子命令换个参数还是同一件事。记整条会让规则永远命不中。 */
  function rulePrefix(cmd) {
    const parts = String(cmd || '').trim().split(/\s+/);
    if (!parts[0]) return '';
    return parts[0] === 'bcut' && parts[1] ? `bcut ${parts[1]}` : parts[0];
  }

  function autoAllowed(cmd, rules) {
    const pre = rulePrefix(cmd);
    return !!pre && (rules || []).indexOf(pre) >= 0;
  }

  /* ---------- 访问模式（第 121 轮） ----------
     四档粗闸：监督 → 自动接受修改 → 自动 → 完全访问。照搬 waku 的那一套：**四档永远
     全部可选**，不按 provider、不按任何开关置灰，切档也没有确认框拦一道。它与上面的
     「总是允许」规则是**两层叠加**，不是二选一：规则先读（它最窄、最好解释），命不中
     才轮到模式。四档在这份原型里必须两两可见，否则切档就只是换个字：
       监督        每一次写入都弹卡
       自动接受修改  编辑类写入自动放行（记一条「自动允许 · 编辑」），其余命令仍弹卡
       自动        全部自动放行，记「自动允许 · 访问模式」——放行的人是编码 Agent 自带的审核者
       完全访问     全部自动放行，不再问
     没有「高风险命令集」这一层：哪一步真的需要停下来，是核心层的细判据，原型只画粗口径。 */
  const MODES = ['ask', 'autoAcceptEdits', 'auto', 'fullAccess'];

  /** 没认出来的一律当「监督」——拿不准就问，不拿不准当放行。 */
  function normalizeMode(k) {
    return MODES.indexOf(k) >= 0 ? k : 'ask';
  }

  function modeRank(k) {
    return MODES.indexOf(normalizeMode(k));
  }

  /** 新会话继承哪一档：优先当前会话（你刚才就在用它），否则全局「上一次用的」种子。
      会话自己的 mode 才是真相，种子只是初值；改一条会话不会追改已开的其它会话。 */
  function nextSessionMode(cur, seed) {
    return normalizeMode((cur && cur.mode) || seed || 'ask');
  }

  /** 是不是「编辑类」写入：这份原型里 Agent 对项目的每一次写入都走 `bcut`，那就是编辑；
      其它任意命令算命令类。演示层的粗口径，不是命令风险表。 */
  function isEditWrite(cmd) {
    return rulePrefix(cmd).slice(0, 5) === 'bcut ';
  }

  /** 一次写入的裁决。`{auto:false}` 就是弹卡问你；`reason` 决定卡上记的那一行写什么。 */
  function modeGate(mode, cmd, rules) {
    if (autoAllowed(cmd, rules)) return {auto: true, reason: 'rule'};
    const m = normalizeMode(mode);
    if (m === 'ask') return {auto: false, reason: null};
    if (m === 'autoAcceptEdits') {
      return isEditWrite(cmd) ? {auto: true, reason: 'edit'} : {auto: false, reason: null};
    }
    return {auto: true, reason: 'mode'};
  }

  /** 自动放行的记录行。一家人的句式：自动允许 · <是谁放的>。 */
  function autoAllowLabel(reason, rule) {
    if (reason === 'rule') return `自动允许 · 规则 ${rule}`;
    if (reason === 'edit') return '自动允许 · 编辑';
    if (reason === 'loop') return '自动允许 · 应答环';
    return '自动允许 · 访问模式';
  }

  /** composer 脚注的中段：这一档到底会不会问你。 */
  function modeFoot(mode) {
    return {
      ask: '每次写入视频前都会先问你。',
      autoAcceptEdits: '改视频文件自动允许，其它命令仍会问你。',
      auto: '常规操作交给它自带的审核者，不再逐次问你。',
      fullAccess: '写入视频不再逐次问你。',
    }[normalizeMode(mode)];
  }

  /** 切档的 toast（waku 是默默切，我们说一声）。list 从 data 里来，模型层不存文案。 */
  function modeLabel(list, k) {
    const hit = (list || []).find((m) => m.k === normalizeMode(k));
    return hit ? hit.label : '监督';
  }

  function modeToast(list, k, status) {
    if (status === 'running' || status === 'waiting') {
      return `下一轮使用「${modeLabel(list, k)}」，本轮继续按原访问模式执行。`;
    }
    return `访问模式 · ${modeLabel(list, k)}：${modeFoot(k)}`;
  }


  /* ---------- 侧栏二级：项目 → 会话 ----------
     一条会话只绑一个项目（第 110 轮）。侧栏因此不再有独立的「会话」段，会话挂在各自项目之下，
     项目常开、默认露 3 条。`liveSessions`（在跑 / 等你）只给首页「进行中」用——
     侧栏不放这一段，免得和「后台任务」撞车。 */
  const LIVE = {running: true, waiting: true};
  function liveSessions(list) {
    return sortSessions((list || []).filter((s) => LIVE[s.status]));
  }

  /** 某个项目名下的会话，按活跃度排；n 截断（侧栏默认 3 条）。 */
  function sessionsOf(list, projectId, n) {
    const own = sortSessions((list || []).filter((s) => s.project === projectId));
    return n ? own.slice(0, n) : own;
  }

  /* 项目排序档：侧栏「项目」段的 ⋯ 与「我的项目」页的排序菜单共用，两处各记各的偏好。
     `otime` 是多少分钟前打开过、`mtime` 是多少分钟前改过、`ctime` 是多少分钟前建的，
     都是越小越新；缺 `otime` 的项目按 `mtime` 回落（刚建的项目没打开过，但刚改过）；
     缺 `ctime` 不借别的时间，沉底（App 取项目包目录的创建时间，取不到就是缺）。 */
  const TREE_SORTS = [
    {key: 'opened', label: '最近打开'},
    {key: 'edited', label: '最近编辑'},
    {key: 'created', label: '最近创建'},
    {key: 'title', label: '名称'},
  ];
  const minutes = (v) => (typeof v === 'number' && isFinite(v) ? v : Infinity);
  function sortProjects(projects, key) {
    const list = (projects || []).map((p, i) => ({p, i}));
    const by = key === 'edited' ? (x) => minutes(x.p.mtime)
      : key === 'created' ? (x) => minutes(x.p.ctime)
      : key === 'title' ? null
      : (x) => minutes(x.p.otime != null ? x.p.otime : x.p.mtime);
    list.sort((a, b) => {
      const d = by ? by(a) - by(b) : String(a.p.title || '').localeCompare(String(b.p.title || ''), 'zh-Hans-CN');
      return d || a.i - b.i;
    });
    return list.map((x) => x.p);
  }

  /** 侧栏项目树：每个项目带自己的会话与「还有几条」；未绑项目的会话单独一组。
      `sort` 选排序档（默认最近打开）；`limit` / `looseLimit` 是两段各自已经加载到的条数，
      截掉的部分记在 `hiddenRows` / `looseHidden`——`row.more` 仍只表示「这个项目还有几条会话」。 */
  function projectTree(projects, sessions, opts) {
    const o = opts || {};
    const per = o.per || 3;
    const sorted = sortProjects(projects, o.sort);
    const cap = o.limit == null ? sorted.length : Math.max(0, o.limit);
    const rows = sorted.slice(0, cap).map((p) => {
      const own = sessionsOf(sessions, p.id);
      return {project: p, sessions: own.slice(0, per), more: Math.max(0, own.length - per),
        live: own.some((s) => LIVE[s.status])};
    });
    const allLoose = sortSessions((sessions || []).filter((s) => !s.project));
    const looseCap = o.looseLimit == null ? allLoose.length : Math.max(0, o.looseLimit);
    return {rows, hiddenRows: Math.max(0, sorted.length - cap),
      loose: allLoose.slice(0, looseCap), looseHidden: Math.max(0, allLoose.length - looseCap)};
  }

  /** 「加载更多」的下一档：每点一次加 step 条，不超过总数。 */
  function loadMore(shown, step, total) {
    return Math.min(Math.max(0, total), Math.max(0, shown) + step);
  }

  /* ---------- @ 引用 ----------
     composer 里的 @ 只引入**只读参考**，写入目标永远是会话绑定的那个项目。
     候选先本项目内的对象（章节 / 说话人 / 文件 / 术语表），其他项目是最后一组。 */
  function mentionQuery(text) {
    const m = /(?:^|\s)@([^\s@]*)$/.exec(String(text || ''));
    return m ? m[1] : null;
  }

  function mentionItems(query, ctx) {
    const c = ctx || {};
    const q = String(query || '').toLowerCase();
    const hit = (label) => !q || String(label).toLowerCase().indexOf(q) >= 0;
    const groups = [];
    if (c.project) {
      const items = [];
      (c.chapters || []).forEach((ch) => items.push({id: 'ch:' + ch.id, kind: 'chapter', label: ch.title, ref: `@章节:${ch.title}`}));
      // data.js 的 speakers 是按 id 键的对象，宿主也可能直接给数组——两种都收
      const sps = Array.isArray(c.speakers) ? c.speakers : Object.values(c.speakers || {});
      sps.forEach((sp) => items.push({id: 'sp:' + sp.id, kind: 'speaker', label: sp.name, ref: `@说话人:${sp.name}`}));
      (c.langs || []).forEach((l) => items.push({id: 'lang:' + l.code, kind: 'file', label: `译文 · ${l.name}`, ref: `@译文:${l.name}`}));
      items.push({id: 'gloss', kind: 'glossary', label: '术语表', ref: '@术语表'});
      items.push({id: 'srt', kind: 'file', label: '字幕文件 · SRT', ref: '@字幕文件'});
      groups.push({group: '这部视频', items: items.filter((it) => hit(it.label))});
    }
    const others = (c.projects || []).filter((p) => !c.project || p.id !== c.project.id)
      .map((p) => ({id: 'proj:' + p.id, kind: 'project', label: p.title, ref: `@视频:${p.title}`}))
      .filter((it) => hit(it.label));
    if (others.length) groups.push({group: '其他视频（只读参考）', items: others});
    return groups.filter((g) => g.items.length);
  }

  /** 把 @ 引用插进正文：替换末尾正在输入的那个 @token。 */
  /* 斜杠命令：只认正文**开头**的 /token（后面还没敲空格）。@ 可以出现在任何位置，/ 不行——
     它是整句的动词，放中间就成了路径。 */
  function slashQuery(text) {
    const m = /^\/([^\s/]*)$/.exec(String(text || ''));
    return m ? m[1] : null;
  }
  function slashItems(query, cmds) {
    const q = String(query || '').toLowerCase();
    return (cmds || []).filter((c) => !q || c.cmd.slice(1).toLowerCase().startsWith(q) || (c.label || '').includes(query));
  }
  function applySlash(text, cmd) {
    const t = String(text || '');
    return cmd + ' ' + t.replace(/^\/[^\s/]*\s?/, '');
  }

  function applyMention(text, ref) {
    const t = String(text || '');
    const m = /(^|\s)@[^\s@]*$/.exec(t);
    if (!m) return (t ? t + ' ' : '') + ref + ' ';
    return t.slice(0, m.index) + m[1] + ref + ' ';
  }

  /* ---------- 工具设置态：一句人话说清这一步 ----------
     AI 工具页的设置态与 Agent 放行卡共用同一份描述：模型 + 范围 + 规模。
     「这一步会用 gpt-4o 翻译 42 句」——放行的是一件看得见规模的事，不是一条命令。 */
  function stepSummary(plan, o) {
    const st = plan && plan.step;
    if (!st) return '';
    const opt = o || {};
    // 第 111 轮：谁来做进句子——Agent 是「让 Claude Code · Sonnet 做」，模型是「用 gpt-4o 做」
    const who = opt.agent ? `让 ${opt.agent}` : `用 ${st.llm ? (opt.model || '默认模型') : (st.engine || '本机模型')}`;
    const pre = opt.pre ? `先${opt.pre}，再` : '';
    const scope = opt.scope ? `${opt.scope}的` : '';
    const n = opt.count != null ? opt.count : st.count;
    return `这一步会${who} ${pre}${st.verb}${scope} ${n} ${st.unit}${opt.agent ? '，写入前会先问你' : ''}`;
  }

  /* ---------- 谁来做（第 111 轮） ----------
     工具页第一行只回答一件事：这一步交给谁。两组候选——本机编码 Agent（用你的订阅，
     会话里跑、写入前会问）与直接调模型（Settings › 云端模型里的 provider，三态 + 收据）；
     本机工具（重新转录 / 识别说话人）第二组换成「直接跑 · 本机模型」。
     选项的 key 是全局记忆的那份偏好：上次选了 Agent，下一个工具页默认还是 Agent。 */
  /** 「更多」里的四家（`extra`）与用户添加的（`added`，product-design §7.6）没检测到时不进任何选择器——一串「未安装」
      只会把能用的那一行淹掉；想装它们去 设置 › Agent。常驻主列表的五家没装也照常列出，带安装提示。 */
  const listed = (h) => !!h && (h.found || (h.extra !== true && !h.added));
  function runnerOptions(o) {
    const opt = o || {};
    const agents = [];
    (opt.harnesses || []).forEach((h) => {
      if (h.enabled === false || !listed(h)) return;
      const sub = h.found ? String(h.account || '本机').split(' · ')[0] : (h.install ? `未安装 · ${h.install}` : '未安装');
      /* 第 186 轮：Agent 组两级——每家一条「Agent 默认模型」项打头（模型留空，依 CLI 配置），
         再是目录里的模型。key 沿用 `agent:<h>[:<m>]`，选谁记谁。 */
      agents.push({
        k: `agent:${h.id}`, kind: 'agent', harness: h.id, model: null,
        label: `${h.name} · Agent 默认模型`, mname: 'Agent 默认模型', msub: '按 CLI 配置选择', ready: !!h.found, sub,
      });
      (h.models || []).forEach((m) => agents.push({
        k: `agent:${h.id}:${m.id}`, kind: 'agent', harness: h.id, model: m.id,
        label: `${h.name} · ${m.name}`, mname: m.name, msub: m.dflt ? '默认' : null, ready: !!h.found, sub,
      }));
    });
    const second = opt.local
      ? [{k: 'local', kind: 'local', label: opt.local.label || '本机模型', ready: true, sub: opt.local.sub || '不出本机'}]
      : (opt.models || []).map((m) => ({
          k: `api:${m.id}`, kind: 'api', model: m.id,
          label: `${m.name} · ${m.provider}`, ready: !m.note || m.note !== '未连接 key',
          sub: m.note || 'API key',
        }));
    /* 2026-09-20：两组各带 kind / tab / desc——「用」下拉不再把两组上下摞成一长条，而是弹层顶部一枚
       两段开关（tab 是段上的字，desc 是段下那一行说明），一次只看一组。装了五六家 Agent 时，
       「直接调模型」不会再被推到看不见的地方。`group` 仍是旧的一行组头，App 侧与测试沿用。 */
    return [
      {kind: 'agent', tab: '交给 Agent', desc: '本机，用你的订阅，写入前会问你', group: 'Agent · 本机，用你的订阅，写入前会问你', items: agents},
      opt.local
        ? {kind: 'local', tab: '直接跑', desc: '本机模型 · 不出本机', group: '直接跑 · 本机模型', items: second}
        : {kind: 'api', tab: '直接调模型', desc: 'API key · 不用对话，直接出结果', group: '直接调模型 · API key', items: second},
    ];
  }

  /** 弹层顶部那枚两段开关的段（2026-09-20）：`count` 是这一组有几个可选对象——Agent 数的是**家**
      （每家一行，模型在第二级），不是 家 × 模型；本机那一组只有一项，不标数。`on` 是当前选中项所在的组；
      什么都没选时落在第一组。 */
  function runnerTabs(groups, cur) {
    const curKind = cur && cur.kind ? cur.kind : null;
    return (groups || []).map((g, i) => {
      const count = g.kind === 'agent'
        ? new Set(g.items.map((it) => it.harness)).size
        : g.kind === 'local' ? null : g.items.length;
      return {k: g.kind, label: g.tab, count, desc: g.desc, on: curKind ? curKind === g.kind : i === 0};
    });
  }

  /** 第一次打开取就绪的那个：只探到 Agent → Agent；只连了 key → API；两个都有 → API（不用对话，最快）；
      都没有 → Agent（去设置的那条路在它的行上）。 */
  function defaultRunner(groups) {
    const ag = groups[0].items, sec = groups[1].items;
    const agReady = ag.find((i) => i.ready), secReady = sec.find((i) => i.ready);
    // product-design §5.10：编辑器里的工具默认交给 Agent，直接调模型是备选
    if (agReady) return agReady.k;
    if (secReady) return secReady.k;
    return (ag[0] || sec[0] || {}).k || null;
  }

  /** 2026-09-21：「用 / AI 由谁来做」落在编码 Agent 上时，**家 · 模型一律听输入框底栏那枚
      chip 的**——新建项目页同一屏上两处不许各说各的，工具页交接出去的也是新会话默认用的
      那一家 · 那个模型。反方向由调用方负责（在下拉里选定 Agent 时，同一份选择写回
      `prefs.harness` / `prefs.agentModels`，见 tool-setup.jsx::useRunner）。
      只动 Agent：云模型 / 本机 chip 表达不了，原样不动；chip 那家不在候选里（设置里停用）也不动。 */
  function syncAgent(cur, groups, agent) {
    if (!cur || cur.kind !== 'agent' || !agent || !agent.harness) return cur;
    if (!groups[0].items.some((i) => i.harness === agent.harness)) return cur;
    return resolveRunner(`agent:${agent.harness}${agent.model ? `:${agent.model}` : ''}`, groups);
  }

  /** 工具页各有偏好（第 196 轮）：找可剪的口默认交给 Agent——它要读整篇文稿、列清单、问一次再写，
      比直接调模型多一层把关；直接调模型仍是可选项。顺序：这一页自己记过的 → 按 `prefer` 挑就绪的
      Agent → 全局记忆（走 resolveRunner 的回落）。 */
  function preferredRunner(groups, o) {
    const opt = o || {};
    const all = groups[0].items.concat(groups[1].items);
    if (opt.own && all.some((i) => i.k === opt.own)) return resolveRunner(opt.own, groups);
    if (opt.prefer === 'agent') {
      const ag = groups[0].items.find((i) => i.ready);
      if (ag) return ag;
    }
    return resolveRunner(opt.global, groups);
  }

  /** Agent 会话跑到哪一步了（第 196 轮，工具页的进度卡读这个）：`{cur, pct, note, waiting, done}`。
      `cur` 对应四段——读项目 / 等你放行 / 执行 / 写入建议；从会话消息倒推，收据一到就是完成。 */
  function sessionProgress(sess, task) {
    if (!sess) return {cur: 0, pct: 0, note: '正在打开会话…', waiting: false, done: false};
    const ms = sess.messages || [];
    const last = (fn) => ms.filter(fn).slice(-1)[0] || null;
    const receipt = last((m) => m.role === 'receipt');
    if (receipt || sess.status === 'done') return {cur: 4, pct: 100, note: receipt ? receipt.text : '已完成', waiting: false, done: true};
    const perm = last((m) => m.role === 'permission');
    const run = last((m) => m.role === 'tool' && m.taskId);
    if (run && task) return {cur: task.pct >= 90 ? 3 : 2, pct: task.pct || 0, note: run.cmd, waiting: false, done: false};
    if (perm && perm.state === 'pending') return {cur: 1, pct: null, note: perm.cmd, waiting: true, done: false};
    const read = last((m) => m.role === 'tool');
    return {cur: 0, pct: null, note: read ? read.cmd : '正在读视频…', waiting: false, done: false};
  }

  /** 把记住的 key 落到这一页的候选上：找不到同一项时按同一「种类」回落（api 记忆在本机工具页落成 local），
      种类也没有就走 defaultRunner。 */
  function resolveRunner(key, groups) {
    const all = groups[0].items.concat(groups[1].items);
    const hit = key && all.find((i) => i.k === key);
    if (hit) return hit;
    const parts = key ? String(key).split(':') : [];
    const kind = parts[0] || null;
    /* 记的模型不在目录里但这家还在：保留模型（和 App 的 resolve_runner 同口径）。 */
    if (kind === 'agent' && parts[1]) {
      const home = groups[0].items.find((i) => i.harness === parts[1]);
      if (home) return {...home, k: key, model: parts[2] || null, label: parts[2] ? `${home.label.split(' · ')[0]} · ${parts[2]}` : home.label, mname: parts[2] || home.mname, msub: parts[2] ? '当前列表未提供此模型' : home.msub};
    }
    const sameKind = kind && (kind === 'agent'
      ? groups[0].items.find((i) => i.ready) || groups[0].items[0]
      : groups[1].items.find((i) => i.ready) || groups[1].items[0]);
    return sameKind || all.find((i) => i.k === defaultRunner(groups)) || null;
  }

  /** 范围候选：整篇 + 每一章；每章的规模按时长比例折算（放行卡与工具页共用）。 */
  function scopeOptions(total, chapters, duration) {
    const dur = duration || ((chapters || []).length ? chapters[chapters.length - 1].end : 0) || 1;
    const all = [{k: 'all', label: '整篇', count: total}];
    return all.concat((chapters || []).map((ch, i) => ({
      k: ch.id, label: `第 ${i + 1} 章 · ${ch.title}`,
      count: Math.max(1, Math.round(total * ((ch.end - ch.start) / dur))),
    })));
  }

  /** 首页复合框：有文件走向导（确定性路径），只有话走 Agent。两者都有 = 带文件的会话。 */
  function startRoute(text, file) {
    const t = String(text || '').trim();
    if (file && !t) return {kind: 'wizard', file};
    if (!file && !t) return null;
    return {kind: 'agent', text: t, file: file || null};
  }

  /* ---------- 首页就绪清单 ----------
     新用户要有的三样：一个语音模型、一个 Agent harness、（可选）云端 provider。
     三条各自可点去对应设置页；全绿时整行收成一句，不再逐条列。 */
  function readiness(o) {
    const models = (o.models || []).filter((m) => m.installed);
    const h = pickHarness(o.harnesses || [], o.preferred);
    const provs = (o.providers || []).filter((p) => p.connected);
    return [
      {k: 'speech', ok: models.length > 0,
       label: models.length ? `语音模型 · ${(models.find((m) => m.dflt) || models[0]).name}` : '还没有语音模型',
       route: {r: 'settings', sec: 'local'}},
      {k: 'agent', ok: !!h,
       label: h ? `Agent · ${h.name}` : (o.harnesses || []).some((x) => x.found) ? '编码 Agent 已停用' : '没检测到 Claude Code 或 Codex',
       route: {r: 'settings', sec: 'agent'}},
      {k: 'cloud', ok: provs.length > 0, optional: true,
       label: provs.length ? `云端模型 · ${provs.length} 个 provider` : '云端模型未连接（可选）',
       route: {r: 'settings', sec: 'cloud'}},
    ];
  }

  /* ---------- 编码 Agent 可用性 · 两级选择（第 185 轮） ----------
     首页、AI 工具引导卡、「用」下拉的空组、composer 的离线条要回答的是同一个问题：
     「有没有可以交活的对象」；没有时还要分清是**一个都没装**还是**装了但都停用了**——
     前者引导去安装，后者当场就能启用，一句话不该混着说。 */
  function agentAvailability(list, preferredId) {
    const hs = list || [];
    const harness = pickHarness(hs, preferredId);
    const installed = hs.filter((h) => h.found);
    return {
      ready: !!harness,
      // attention（2026-09-18）= 装了、也没停用，但跑不起来：既不该叫用户重装，也不是「启用」能解决的
      state: harness ? 'ready' : installed.some((h) => h.blocked === true && h.enabled !== false) ? 'attention' : installed.length ? 'off' : 'missing',
      harness, installed,
    };
  }

  /** 首页形态：有可用编码 Agent = Agent 入口（复合框收文件也收话）；没有 = 只建项目 + 配置引导。 */
  function homeMode(list, preferredId) {
    return agentAvailability(list, preferredId).ready ? 'agent' : 'setup';
  }

  /** 引导卡文案：按「没装」/「都停用」两种缺席分别给标题、说明与主按钮。 */
  function setupGuide(avail) {
    const a = avail || {state: 'missing', installed: []};
    if (a.state === 'ready') return null;
    if (a.state === 'off') {
      const h = a.installed[0];
      return {
        state: 'off', harness: h,
        title: '已安装的编码 Agent 都停用了',
        body: `启用 ${a.installed.map((x) => x.name).join(' / ')} 就能用一句话交代组合活，用你自己的订阅，写入视频前会先问你。`,
        cta: `启用 ${h.name}`, ctaIcon: 'ok',
      };
    }
    if (a.state === 'attention') {
      const h = a.installed.find((x) => x.blocked === true) || a.installed[0];
      return {
        state: 'attention', harness: h,
        title: `${h.name} 需要处理一下才能继续`,
        body: '它已经装在这台电脑上，但现在用不了（登录过期、版本过旧或无法启动）。到设置里运行排查，通常一步就能修好。',
        cta: '去设置排查', ctaIcon: 'settings',
      };
    }
    return {
      state: 'missing', harness: null,
      title: '连接一个编码 Agent，就能用一句话交代活',
      body: '装 Claude Code 或 Codex CLI 并用你自己的订阅登录；之后拖文件、说一句话都在这里，写入视频前会先问你。',
      cta: '连接 Agent', ctaIcon: 'agent',
    };
  }

  /** 两级下拉的第一级：每家 provider 一行，状态决定副文案与点了去哪。 */
  function providerState(h) {
    if (!h || !h.found) return 'missing';
    if (h.enabled === false) return 'off';
    return h.blocked === true ? 'attention' : 'ready';
  }
  function providerRows(list, sel) {
    const s = sel || {};
    return (list || []).filter(listed).map((h) => {
      const state = providerState(h);
      const on = state === 'ready' && s.harness === h.id;
      const shown = on ? (s.activeModel || s.model) : null;
      const m = on ? (h.models || []).find((x) => x.id === shown) : null;
      return {
        id: h.id, name: h.name, state, on,
        sub: state === 'ready'
          ? (on ? (shown ? (m ? m.name : shown) : 'Agent 默认模型') + ' · ' : '') + String(h.account || '本机').split(' · ')[0]
          : state === 'off' ? '已在设置里停用' : state === 'attention' ? '需要处理 · 去设置排查' : (h.install ? `未安装 · ${h.install}` : '未安装'),
      };
    });
  }
  /** 第二级：这一家的模型表——「Agent 默认模型」在前；当前选中却不在目录里的模型也要露出来。
      `gate` = model-agent-setup.js::defaultModelGate(h) 的结果（2026-09-29）：CLI 配置里的默认模型这一版不认得时，
      「Agent 默认模型」那一行的副文案直说「需要升级 CLI」；这一行照样能选，BaoCut 不替你换。 */
  function modelRows(h, sel, gate) {
    if (!h) return [];
    const s = sel || {};
    const mine = s.harness === h.id;
    const active = mine && !s.model && s.activeModel;
    const activeEntry = active && (h.models || []).find((m) => m.id === active);
    const rows = [{id: null, name: 'Agent 默认模型',
      sub: gate ? `按 CLI 配置选择 · ${gate.model} 需要升级 CLI`
        : active ? `按 CLI 配置选择 · ${activeEntry ? activeEntry.name : active}` : '按 CLI 配置选择', on: mine && !s.model}];
    if (mine && s.model && !(h.models || []).some((m) => m.id === s.model)) rows.push({id: s.model, name: s.model, sub: '当前列表未提供此模型', on: true});
    (h.models || []).forEach((m) => rows.push({id: m.id, name: m.name, sub: m.dflt ? '默认' : null, on: mine && s.model === m.id}));
    return rows;
  }

  // Preserve chronological boundaries, especially permission cards and receipts.
  // 第 191 轮：紧跟在一条回答后面的工具挂到那条回答身上（`work`），画在正文下面；
  // 前面不是回答（审批之后、轮次开头）的工具才独立成一组。
  function conversationRows(messages) {
    const rows = [];
    for (const m of messages) {
      const last = rows[rows.length - 1];
      if (m.role === 'tool' && last && last.role === 'work') last.items.push(m);
      else if (m.role === 'tool' && last && last.role === 'assistant') {
        if (!last.work) rows[rows.length - 1] = {...last, work: []};
        rows[rows.length - 1].work.push(m);
      }
      else if (m.role === 'tool') rows.push({id: `work-${m.id}`, role: 'work', items: [m]});
      else rows.push(m);
    }
    return rows;
  }

  // 工具行的种类：演示数据带 kind（command / read / edit / search / other）；没有 kind 的老数据按 cmd 的写法推——「读取 …」是读文件，其余是命令。
  const WORK_KINDS = {
    command: '运行了命令', file_change: '修改了', file_read: '读取了',
    search: '搜索了', plan: '做了计划', tool: '调用了工具',
  };
  const KIND_ALIAS = {read: 'file_read', edit: 'file_change', other: 'tool'};
  function workKind(item) {
    if (item.tool) return 'tool'; // BaoCut 自己的工具（model-agent-tools.js）
    const k = KIND_ALIAS[item.kind] || item.kind;
    if (k && WORK_KINDS[k]) return k;
    return /^读取/.test(item.cmd || '') ? 'file_read' : 'command';
  }
  // 读 / 改的是哪个文件：有 summary 用它，否则取「读取 X · …」里的 X
  function workPath(item) {
    if (item.summary) return String(item.summary).trim();
    return String(item.cmd || '').replace(/^读取\s*/, '').split(' · ')[0].trim();
  }
  // 组头一句话：按种类归纳、首次出现排序（「读取了 2 个文件、运行了命令」）；文件按去重后的路径计数。没有就退回计数。
  function workSummary(items) {
    const kinds = [];
    const paths = {};
    for (const it of items) {
      const k = workKind(it);
      if (!kinds.includes(k)) kinds.push(k);
      if (k === 'file_read' || k === 'file_change') (paths[k] = paths[k] || new Set()).add(workPath(it));
    }
    if (!kinds.length) return `${items.length} 项活动`;
    return kinds.map((k) => (paths[k] ? `${WORK_KINDS[k]} ${paths[k].size} 个文件` : WORK_KINDS[k])).join('、');
  }

  window.BC_AGENT = {
    conversationRows, workKind, workSummary,
    agoLabel, bucket, sessionTitle, sortSessions, groupSessions,
    pickHarness, harnessLabel, compactModelLabel, harnessShort, composerFoot, intentPrompt, planFor, askFor, missingSlots, rulePrefix, autoAllowed, readiness,
    agentAvailability, homeMode, setupGuide, providerState, providerRows, modelRows,
    normalizeMode, modeRank, nextSessionMode, isEditWrite, modeGate,
    autoAllowLabel, modeFoot, modeLabel, modeToast, MODE_KEYS: MODES,
    liveSessions, sessionsOf, projectTree, sortProjects, loadMore, TREE_SORTS, mentionQuery, mentionItems, applyMention, slashQuery, slashItems, applySlash, slashKind, SLASH_KINDS,
    stepSummary, scopeOptions, startRoute, runnerOptions, runnerTabs, defaultRunner, resolveRunner, preferredRunner, syncAgent, sessionProgress,
    PLANS, PLAN_KINDS: PLANS.map((p) => p.kind),
  };
})();
