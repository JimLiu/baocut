/* Home 模板库（模板包格式与使用语义见 docs/spec/template-spec.md；界面见 product-design §3.2.1）。
   模板是「视频制作模板」，形态接近 skill：以一段提示词为主，可以带素材。分两类（规范 §1.2）：
   - scene 场景模板：创作方向 + 默认画幅、时长。选用后挂在输入框上，发送后智能体先和用户确认简报（§5.2）。
   - example 作品示例：一条完整的提示词。选用即把全文放进输入框，不挂模板、不走简报（§5.1）。
   内置模板的内容来自仓库顶层 templates/，由 build/home-templates.mjs 生成进 model-home-templates-data.js
   （window.BC_HOME_TEMPLATE_DATA）；本文件只留逻辑。社区模板的来源还没定（规范 §8），这里另写几个
   **演示用**的社区模板，用来表达「社区投稿」与「带素材的要先下载到本机」。
   - `assets` / `size`：演示社区模板自带素材的数量与体积（MB）。带素材的社区模板用之前先下载到本机；
     只有提示词的不用下载。内置模板现在都不带素材。
   - `tone` / `fig` / `kicker`：占位封面的画法（规范 §3.3 的 cover.tone / figure / kicker）。 */
(function () {
  const W = typeof window !== 'undefined' ? window : {};
  const DATA = W.BC_HOME_TEMPLATE_DATA || (typeof require === 'function' ? require('./model-home-templates-data.js') : []);
  /* 待填项（template-spec §5.5）：brief / prompt.md 里的 `{{label}}`。 */
  const SLOTS = W.BC_PROMPT_SLOTS || (typeof require === 'function' ? require('./model-prompt-slots.js') : null);
  /* 规范 §3.2 的分类表：键是协议的一部分，显示名由界面给。 */
  const CATEGORIES = [
    {k: 'all', label: '全部'}, {k: 'marketing', label: '营销推广'}, {k: 'product-launch', label: '产品发布'},
    {k: 'explainer', label: '知识讲解'}, {k: 'news-data', label: '资讯与数据'}, {k: 'editing', label: '剪辑整理'},
    {k: 'creative-short', label: '创意短片'}, {k: 'motion-design', label: '动效设计'},
  ];
  const SOURCES = [{k: 'all', label: '全部来源'}, {k: 'official', label: '官方'}, {k: 'community', label: '社区'}];
  const TYPES = [{k: 'all', label: '全部'}, {k: 'scene', label: '场景模板'}, {k: 'example', label: '作品示例'}];
  const ASSET_KINDS = [{k: 'image', label: '图片'}, {k: 'svg', label: 'SVG'}, {k: 'audio', label: '音频'}];
  const PER_PAGE = 9;
  const SHELF_MAX = 8;
  /* 起始页模板网格的默认八个（四列两行）：六个场景模板 + 两个作品示例，两类混排，七个分类都有。 */
  const SHELF_DEFAULT = ['promo-ad', 'knowledge-explainer', 'data-story', 'typography-motion',
    'launch-film', 'vlog-edit', 'story-short', 'ai-news-take'];
  /* 选用场景模板后、详情里那句说明（规范 §5.2 的简报四项）。 */
  const BRIEF_NOTE = '选用后会先和你确认主题、目标、受众和材料，再开始制作。';

  /** 生成的清单数据 → 界面用的形状。时长是 Home 时长滑杆的写法（'90s'，见 BC_NEW.lengthSeconds），缺省 = 自动（null）。
      brief：场景模板选用时填进输入框的那句话（带 `{{label}}`）；fields：待填项 [{label, hint, example}]；
      skills：给智能体的做法提示。sample 是算出来的「可以这样说」：brief 的占位符换成 example（场景模板），作品示例为空串。 */
  function fromManifest(m) {
    return withSample({k: m.id, kind: m.kind, cat: m.category, source: m.source, author: m.author, title: m.title, summary: m.summary,
      description: m.description, brief: m.brief || null, fields: m.fields || [], skills: m.skills || [],
      ratio: m.ratio || null, length: m.durationSeconds ? m.durationSeconds + 's' : null,
      tags: m.tags || [], tone: m.cover.tone || 'blue', fig: m.cover.figure || 'bars', kicker: m.cover.kicker || '', beats: m.beats, body: m.prompt});
  }
  function withSample(t) { return {...t, sample: t.kind === 'scene' && t.brief ? SLOTS.example(t.brief, t.fields) : ''}; }

  /* 演示用的社区模板（手写，不是真投稿）：两个带素材、要先下载的场景模板，一个只有提示词的作品示例。 */
  const COMMUNITY_DEMO = [
    {k: 'demo-recipe-steps', kind: 'scene', cat: 'explainer', source: 'community', author: '示例作者 C', title: '菜谱步骤',
      summary: '先列食材，再按步骤演示，最后给出成品与小贴士。', description: '俯拍感的插画加步骤编号，适合把一道家常菜讲清楚。模板自带食材插画与步骤图标。',
      brief: '教大家做{{菜名}}，适合{{谁来做}}。手头的材料：{{手头的材料}}。',
      fields: [{label: '菜名', hint: '做哪道菜', example: '一道十分钟就能上桌的番茄炒蛋'}, {label: '谁来做', hint: '新手还是有经验的人', example: '刚学做饭的新手'},
        {label: '手头的材料', hint: '附上的照片或视频；没有可以写「没有」', example: '没有'}],
      skills: [], ratio: '1:1', length: '60s', tags: ['菜谱', '步骤'], tone: 'orange', fig: 'ring', kicker: 'RECIPE',
      beats: ['今天做什么', '准备食材', '三步做完', '成品与小贴士'], assets: {image: 6, svg: 4}, size: 8,
      body: '你要做一条菜谱步骤视频，让观众照着就能做出这道菜。\n\n## 结构\n\n1. 开头：成品画面与菜名。\n2. 食材：逐项列出用量。\n3. 步骤：每步一个画面，编号清楚。\n4. 结尾：成品与一条小贴士。\n\n## 画面与声音\n\n- 优先用模板自带的食材插画与步骤图标，不够再补。\n- 旁白、字幕与画面文字使用简报里确认的语言。'},
    {k: 'demo-travel-journal', kind: 'scene', cat: 'editing', source: 'community', author: '示例作者 B', title: '旅行手账',
      summary: '按天整理一趟旅行，照片像贴进手账一样一页页翻过。', description: '牛皮纸底、胶带与邮戳贴纸、手写字。用你的旅行照片与短视频，按天排成一本手账。模板自带纸张、贴纸与一段背景音乐。',
      brief: '把我在{{去了哪里}}玩{{几天}}拍的照片做成一本旅行手账，最难忘的是{{最难忘的一刻}}。',
      fields: [{label: '去了哪里', example: '海边'}, {label: '几天', hint: '按天翻页', example: '五天'}, {label: '最难忘的一刻', hint: '单独一页', example: '看日出'}],
      skills: [], ratio: '9:16', length: '60s', tags: ['旅行', 'Vlog'], tone: 'brown', fig: 'cards', kicker: 'DAY 1',
      beats: ['去了哪里', '第一天', '最难忘的一刻', '带回来的东西'], assets: {image: 16, svg: 8, audio: 1}, size: 32,
      body: '你要把一趟旅行做成手账风格的短片。\n\n## 结构\n\n1. 封面：去了哪里、几天。\n2. 按天翻页，每天两三张照片配一句话。\n3. 最难忘的一刻单独一页。\n4. 结尾：带回来的东西。\n\n## 画面与声音\n\n- 用模板自带的纸张与贴纸装点照片，背景音乐用模板自带的那段。\n- 画面文字使用简报里确认的语言。'},
    {k: 'demo-quote-cards', kind: 'example', cat: 'motion-design', source: 'community', author: '示例作者 E', title: '金句卡片',
      summary: '把几句话做成一张张卡片，配上轻快的翻转转场。', description: '大字居中、留白多，卡片翻转着一张张出现。适合把读书笔记或演讲里的几句话做成短片。',
      fields: [{label: '几句话', hint: '每句一张卡', example: '三句读书笔记'}, {label: '出处', hint: '书名、演讲或作者', example: '作者与书名'},
        {label: '语言', example: '中文'}],
      skills: [], ratio: '1:1', length: null, tags: ['卡片', '排版'], tone: 'purple', fig: 'cards', kicker: '“ ”',
      beats: ['第一句', '第二句', '第三句', '出处与署名'],
      body: '把{{几句话}}做成一条方形的金句卡片短片：每句一张卡，大字居中，留白多，卡片翻转着出现，最后一张写出处与署名：{{出处}}。\n\n配一段轻快的背景音乐。画面文字用{{语言}}。'},
  ].map(withSample);

  const TEMPLATES = DATA.map(fromManifest).concat(COMMUNITY_DEMO);
  const isExample = (t) => !!t && t.kind === 'example';

  const lengthLabel = (k) => { const N = W.BC_NEW; return N ? N.lengthLabel(k) : null; };
  function get(k) { return TEMPLATES.find((t) => t.k === k) || null; }
  function category(k) { return CATEGORIES.find((c) => c.k === k) || null; }
  function typeLabel(t) { return isExample(t) ? '作品示例' : '场景模板'; }

  /** 起始页模板网格摆的模板：最近用过的在前，不够八个用默认的补齐；认不出的键丢掉。 */
  function shelf(recent) {
    const keys = (Array.isArray(recent) ? recent : []).concat(SHELF_DEFAULT).filter((k, i, all) => get(k) && all.indexOf(k) === i);
    return keys.slice(0, SHELF_MAX).map(get);
  }
  /** 选了一个模板之后网格的键：已经在网格里的不挪位置（卡片不乱跳），从模板库里挑的新面孔排到最前、挤掉最后一个。 */
  function shelfAfterPick(recent, k) {
    const keys = shelf(recent).map((t) => t.k);
    if (!get(k) || keys.includes(k)) return keys;
    return [k].concat(keys).slice(0, SHELF_MAX);
  }

  /** 模板库里的筛选：类型、分类、来源，加一句搜索词（名字、一句话介绍、标签、作者里有就算）。 */
  function find(query, filter) {
    const f = filter || {};
    const q = String(query || '').trim().toLowerCase();
    const on = (v, want) => !want || want === 'all' || v === want;
    return TEMPLATES.filter((t) => on(t.kind, f.kind) && on(t.cat, f.category) && on(t.source, f.source)
      && (!q || [t.title, t.summary, t.author || ''].concat(t.tags).some((x) => x.toLowerCase().includes(q))));
  }
  /** 分页：页码从 1 起，越界的收回到有效范围；空列表也算一页。 */
  function pageOf(list, page, per) {
    const size = per || PER_PAGE;
    const pages = Math.max(1, Math.ceil(list.length / size));
    const p = Math.min(pages, Math.max(1, Math.round(Number(page)) || 1));
    return {items: list.slice((p - 1) * size, p * size), page: p, pages, total: list.length};
  }

  /** 画幅与时长，一小段：「9:16 · 约 30 秒」「16:9 · 时长自动」「画幅与时长自动」。 */
  function spec(t) {
    const len = lengthLabel(t.length);
    if (!t.ratio && !len) return '画幅与时长自动';
    return [t.ratio || '画幅自动', len || '时长自动'].join(' · ');
  }
  /** 详情里那一行：场景模板写「默认」（Runtime 随模板段交给 Agent），作品示例没写的说明交给 Agent。 */
  function specLine(t) {
    if (!isExample(t)) return `默认 ${spec(t)}，要改就在消息里说`;
    return t.ratio || t.length ? spec(t) : '画幅与时长自动，由 Agent 按内容决定';
  }
  /** 卡片上那行小字：「9:16 · 约 30 秒 · 官方」「画幅与时长自动 · 官方」。 */
  function meta(t) { return [spec(t), t.source === 'official' ? '官方' : '社区'].join(' · '); }
  /** 详情里的出处：「官方 · 场景模板 · 营销推广」「社区 · 示例作者 B · 作品示例 · 动效设计」。 */
  function byline(t) { return [t.source === 'official' ? '官方' : '社区', t.source === 'official' ? null : t.author, typeLabel(t), (category(t.cat) || {}).label].filter(Boolean).join(' · '); }
  function assetCount(t) { return ASSET_KINDS.reduce((n, kind) => n + ((t.assets || {})[kind.k] || 0), 0); }
  /** 自带素材的清单：[{k, label, count}]，没有的种类不列。 */
  function assetList(t) { return ASSET_KINDS.map((kind) => ({...kind, count: (t.assets || {})[kind.k] || 0})).filter((a) => a.count); }
  /** 「图片 6 · SVG 4 · 8 MB」；只有提示词的模板返回空串。 */
  function assetSummary(t) {
    const list = assetList(t);
    return list.length ? list.map((a) => `${a.label} ${a.count}`).concat(`${t.size} MB`).join(' · ') : '';
  }
  /** 用之前要不要先下载：带素材、来自社区（内置的随应用带着）、也还没下载过。只有提示词的不用下载。 */
  function needsDownload(t, downloaded) { return !!t && assetCount(t) > 0 && t.source !== 'official' && !(downloaded || []).includes(t.k); }
  /** 这个模板在本机的状态，一句话。 */
  function stateLabel(t, downloaded) {
    if (!assetCount(t)) return '只有提示词，不用下载';
    return needsDownload(t, downloaded) ? `素材在网上，用之前先下载到本机（${t.size} MB）` : t.source === 'official' ? '素材随应用自带' : '素材已下载到本机';
  }
  /** 模板的提示词正文（prompt.md 全文）。场景模板发送时只带模板标识，正文与简报前言由 Runtime 拼（规范 §5.2）；
      作品示例的正文原样放进输入框（§5.1）。 */
  function prompt(t) { return t ? t.body : ''; }
  /** 详情「需要你补充」：[{label, hint, example}]。场景模板按 fields 列（不在 brief 里的不列）；作品示例按正文里出现的顺序列。 */
  function slotFields(t) {
    if (!t) return [];
    const order = SLOTS.labels(isExample(t) ? t.body : t.brief || '');
    return order.map((label) => (t.fields || []).find((f) => f.label === label) || {label, hint: null, example: null});
  }
  /** 详情里的「做法：…」一行；没有 skills 返回空串。 */
  function skillLine(t) { return t && t.skills && t.skills.length ? '做法：' + t.skills.join('、') : ''; }
  /* 记忆（prefs.homeTemplates）：{recent[], downloaded[]}。recent 是起始页网格的键；downloaded 是已下载到本机的模板。 */
  function downloaded(mem) { return ((mem && mem.downloaded) || []).filter((k) => get(k)); }
  function remember(mem, run) {
    const m = {recent: shelf(mem && mem.recent).map((t) => t.k), downloaded: downloaded(mem)};
    const r = run || {};
    if (r.pick) m.recent = shelfAfterPick(m.recent, r.pick);
    if (r.downloaded && get(r.downloaded) && !m.downloaded.includes(r.downloaded)) m.downloaded = m.downloaded.concat(r.downloaded);
    return m;
  }

  const api = {TEMPLATES, CATEGORIES, SOURCES, TYPES, PER_PAGE, SHELF_MAX, SHELF_DEFAULT, BRIEF_NOTE, get, isExample, typeLabel, shelf, shelfAfterPick, find, pageOf,
    spec, specLine, meta, byline, assetCount, assetList, assetSummary, needsDownload, stateLabel, prompt, slotFields, skillLine, downloaded, remember};
  if (typeof window !== 'undefined') window.BC_HOME_TEMPLATES = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
