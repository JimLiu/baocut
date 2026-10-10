/* BaoCut 原型 — 演示数据
   ============================================================================
   window.BC_DATA。纯数据，无 React、无 DOM。

   数值不是随手编的，逐项对着 docs/design/product/product-design.md：
     §8.1  首页四张大卡 + 两张次级卡、模板行四张、最近项目六张（含媒体丢失与失败）
     §8.3  六类型向导的语言与模型词表
     §12.1 演示总时长 DUR = 206s（03:26）、pxps 默认 20
     §12.2 四章边界（有意不与 clip 边界对齐）
     §12.6 视频轨 6 段 clip
     §12.7 元素行配色与 Timing 表
   改这些数就是改规格，必须同步 docs/design/product/product-design.md 与 README 轮次日志。

   演示数据禁真实品牌名（§6 原则 5）：一律虚构名或描述性名。
   元素行配色不写 hex——第 21 轮把每一行统一到 Spectrum 的同一档
   （底 hue-200 / 选中 hue-300 / 边 hue-400 / 字 hue-1000），这里存色相名，
   由视图折算成 var(--<hue>-<stop>)，色值因此不可能漂。
   ============================================================================ */
(function () {
  const DUR = 206;

  /* ---------- 说话人 ---------- */
  const speakers = {
    s1: {id: 's1', name: '林澈', hue: 222},
    s2: {id: 's2', name: '周远', hue: 152},
    s3: {id: 's3', name: '苏黎', hue: 28},
  };

  /* 演示视频标题：模板目录 / 品牌库 / 向导缩略图里 `{title}` 的示例值（§14.5；编辑器里读项目自己的 title）。 */
  const projectTitle = '本地视频工具怎么做';

  /* ---------- 章节（§12.2，边界有意不与 clip 对齐） ---------- */
  const chapters = [
    {id: 'c1', title: '开场', start: 0, end: 22},
    {id: 'c2', title: '现场访谈', start: 22, end: 95},
    {id: 'c3', title: '产品演示', start: 95, end: 158},
    {id: 'c4', title: '观点与总结', start: 158, end: 206},
  ];

  /* ---------- 视频轨 clip（§12.6） ---------- */
  const clips = [
    {id: 'k1', start: 0,     end: 28,  src: 0},
    {id: 'k2', start: 28,    end: 45.2, src: 28},
    {id: 'k3', start: 45.2,  end: 78,  src: 45.2},
    {id: 'k4', start: 78,    end: 120, src: 78},
    {id: 'k5', start: 120,   end: 163, src: 120},
    {id: 'k6', start: 163,   end: 206, src: 163},
  ];

  /* ---------- 字幕 cue（演示 62 条） ----------
     seedCues 只提供说话人与文本（时间由 makeCues 统一铺），文本刻意留着 AI flow
     要修的毛病：口癖、重复起句、错别字——润色/分段这些 flow 得有东西可修。 */
  const S = (id, start, end, sp, text, trans) => ({id, start, end, sp, text, trans});
  const seedCues = [
    S('g1',  0,    5.4,  's1', '欢迎回到《码与远方》，我是林澈。', 'Welcome back to Code & Wander. I’m Lin Che.'),
    S('g2',  5.4,  11.2, 's1', '这一期我们请到了两位做本地视频工具的朋友。', 'This week we have two friends who build local video tools.'),
    S('g3',  11.2, 16.8, 's2', '嗯，就是，谢谢邀请，我是周远。', 'Uh, so, thanks for having me — I’m Zhou Yuan.'),
    S('g4',  16.8, 22.0, 's3', '大家好，我是苏黎，负责渲染这一块。', 'Hi everyone, I’m Su Li — I work on rendering.'),
    S('g5',  22.0, 28.6, 's1', '先从一个很实际的问题开始：为什么要做本地？', 'Let’s start with a practical question: why local?'),
    S('g6',  28.6, 35.0, 's2', '因为素材是别人的。上传这件事本身就是一个决定。', 'Because the footage isn’t ours. Uploading is itself a decision.'),
    S('g7',  35.0, 41.4, 's2', '我definately没准备好替客户做这个决定。', 'I definately wasn’t ready to make that call for a client.'),
    S('g8',  41.4, 47.2, 's3', '而且模型已经跑得动了，这一年变化很大。', 'And the models run fine now — a lot changed this year.'),
    S('g9',  47.2, 53.8, 's1', '那时候每一个小改动都要——每一个小改动都要三次签字。', 'Back then every small change needed— every small change needed three sign-offs.'),
    S('g10', 53.8, 60.2, 's2', '对，所以我们把整条链路搬到了本机。', 'Right, so we moved the whole pipeline onto the machine.'),
  ];

  // 62 条是演示口径（§8.1 「62 cues」）。文本循环 21 句，时间按确定性节奏铺满
  // 0–206s：平均 206/62 ≈ 3.32s，抖动用固定序列而不是随机（原型必须可复现）。
  const tailCues = [
    ['s1', '这一段先放个演示片段。', 'Let’s roll a demo clip here.'],
    ['s3', '渲染这边最难的是确定性。', 'The hard part on rendering is determinism.'],
    ['s3', '同一份工程，两台机器要出一模一样的帧。', 'Same project, two machines, identical frames.'],
    ['s2', '所以时间轴不能有浮点漂移。', 'So the timeline can’t carry floating-point drift.'],
    ['s1', '听起来像是把编译器那套搬过来了。', 'Sounds like you brought compiler discipline over.'],
    ['s3', '差不多，我们确实叫它编译。', 'More or less — we do call it compiling.'],
    ['s2', '字幕这一层是单独的真相源。', 'The subtitle layer is its own source of truth.'],
    ['s1', '词是真相，句子和 cue 都是投影。', 'Words are the truth; sentences and cues are projections.'],
    ['s3', '这样翻译改了原文也不会把时间轴打乱。', 'That way editing the source never scrambles the timeline.'],
    ['s2', '最后是导出，我们只重渲染改动波及的片段。', 'Finally export — we only re-render what the change touched.'],
    ['s1', '今天先聊到这里，谢谢两位。', 'That’s all for today — thanks to you both.'],
  ];
  const CUE_COUNT = 62;
  const JITTER = [0, 0.5, -0.4, 0.3, -0.6, 0.2, 0.6, -0.3, 0.4, -0.5, 0.1];

  /* ---------- 语言包（第 73 轮） ----------
     一个项目一门源语言。演示对话本来就是逐句双语的（text 中 / trans 英），所以
     英文示例项目不是另一份台词，是**同一期播客的英文版**：swap 把两列对调——
     text 变英文（词级时间戳的宿主，动效字幕踩的就是它）、trans 变中文。
     口癖 / 重复起句那些留给 AI flow 修的毛病在英文列里同样存在（definately、
     needed— needed），两个方向的演示项目都有东西可修。 */
  const LANG = {
    zh: {code: 'zh', name: '中文', abbr: '中'},
    en: {code: 'en', name: 'English', abbr: 'EN'},
  };

  function makeCues(swap) {
    const lines = seedCues.map((c) => [c.sp, c.text, c.trans]).concat(tailCues);
    const avg = DUR / CUE_COUNT;
    const out = [];
    let t = 0;
    for (let i = 0; i < CUE_COUNT; i++) {
      const [sp, a, b] = lines[i % lines.length];
      const last = i === CUE_COUNT - 1;
      const end = last ? DUR : +Math.min(DUR, t + avg + JITTER[i % JITTER.length]).toFixed(2);
      out.push(S('g' + (i + 1), +t.toFixed(2), end, sp, swap ? b : a, swap ? a : b));
      t = end;
    }
    return out;
  }
  const cues = makeCues(false);

  /* ---------- 段落（Transcript 的派生投影：按说话人连续块合并） ----------
     段落同时带 text（原文）与 trans（译文）：Transcript 的语言切换读的是这两列。
     CJK 原文直接相接、译文按词补空格——两种语言的连接符不同，不能共用一条。 */
  function makeParas(cs, srcJoin, dstJoin) {
    const out = [];
    cs.forEach((c) => {
      const last = out[out.length - 1];
      if (last && last.sp === c.sp && c.start - last.end < 1.2 && last.cueIds.length < 4) {
        last.end = c.end;
        last.cueIds.push(c.id);
        last.text += srcJoin + c.text;
        last.trans += dstJoin + c.trans;
      } else {
        out.push({id: 'p' + (out.length + 1), sp: c.sp, start: c.start, end: c.end,
          cueIds: [c.id], text: c.text, trans: c.trans});
      }
    });
    return out;
  }
  const paras = makeParas(cues, '', ' ');

  /* ---------- ASR 初始软分段（§13.1） ----------
     App v2 / Web Studio 已实现的只读状态徽章：段落来自 ASR row 的确定性聚合。
     演示项目刚转录完成、尚未润色/分段；双击改写任一段后服务端会将同一组边界
     原子提升为正式分段，徽章随下一次投影消失。source 与段数对齐 makeParas()
     的真实聚合结果。 */
  const initialSegments = {active: true, source: 'MOSS', provisional: true, paragraphs: paras.length};

  /* 文本组的成员（§13.5 / §14.2）。放在这里而不是 Text 面板里，是因为它有两个读者：
     面板的组视图与时间轴的成员行——两处各写一份，错峰值迟早对不上。
     `delay` 是预设自带的入场错峰，成员起点 = 组起点 + delay（§12.7 的 30 / 30.13 / 30.2）。 */
  const textGroup = {
    id: 'e-txt', preset: '下三分标题 · 徽标版',
    members: [
      {id: 'm1', name: '徽标', kind: 'image', icon: 'image', delay: 0,    text: 'logo-mark.png'},
      {id: 'm2', name: '标题', kind: 'text',  icon: 'text',  delay: 0.13, text: '本地优先'},
      {id: 'm3', name: '副标', kind: 'text',  icon: 'text',  delay: 0.2,  text: '的视频工具'},
    ],
  };

  /* ---------- 时间轴元素行（§12.7）----------
     hue 是 Spectrum 色相名；底 hue-200 / 选中 hue-300 / 边 hue-400 / 字 hue-1000。
     end 为 null = endAnchor「铺到视频结尾」，Timing 里显示「视频结尾」。 */
  const CNT_START = 10;              // 计时演示装置的落点，见下
  const elements = [
    {id: 'e-txt',  kind: 'textgroup', name: '文本组 · 标题',   icon: 'text',     hue: 'orange',   start: 30,   end: 38,
     place: {x: 50, y: 18, w: 60}, members: textGroup.members},
    {id: 'e-stk',  kind: 'sticker',   name: '贴纸 · 麦克风',   icon: 'star',     hue: 'purple',   start: 7.6,  end: 15.6,
     place: {x: 17, y: 62, w: 13},
     asset: 'podcast-02.svg'},
    {id: 'e-img',  kind: 'image',     name: '图片 · 产品图',   icon: 'image',    hue: 'orange',   start: 9.6,  end: 19.6,
     place: {x: 80, y: 68, w: 20},
     asset: 'cover-art.jpg',
     /* 多段关键帧夹具（G11a）：五个 y 帧 = Agent 经 `edit apply` 写的「上下浮两次」。属性页的
        「运动」只能编辑起止两帧，这一行只读回显「5 个关键帧 · 清除」；改别的属性不得弄丢它。 */
     keyframes: {y: [{t: '0%', v: 68}, {t: '25%', v: 60, ease: 'easeOutCubic'}, {t: '50%', v: 68},
       {t: '75%', v: 60, ease: 'easeOutCubic'}, {t: '100%', v: 68}]}},
    /* B-roll 视频元素（第 39.6 轮）。它与主轨的视频**同一套视觉**，只是元素标成
       B-roll（`broll: true`）——所以时间轴上它也是「上半缩略图带 + 下半自己的波形」。
       色相取黄系：视频的 hover 边是琥珀色，与图片的橙拉得开一档。 */
    {id: 'e-vid',  kind: 'video',     name: '视频 · B-roll',   icon: 'video',    hue: 'yellow',   start: 45.2, end: 78,
     place: {x: 20, y: 32, w: 22},
     asset: 'broll-desk.mov', res: '1920×1080', broll: true,
     /* 音量包络夹具（G11a）：三点 = 起头压低、中段回满、结尾再压；属性页只读回显（秒写法） */
     keyframes: {volume: [{t: 0, v: 0.3}, {t: 4, v: 1, ease: 'easeInOutSine'}, {t: 28, v: 0.5}]}},
    {id: 'e-shp',  kind: 'shape',     name: '形状 · 圆角矩形', icon: 'elements', hue: 'green',    start: 4.6,  end: 14.6,
     place: {x: 80, y: 36, w: 18}},
    {id: 'e-prg',  kind: 'progress',  name: '进度条',          icon: 'clock',    hue: 'cyan',     start: 0,    end: null,
     place: {x: 50, y: 94, w: 84}},
    {id: 'e-wav',  kind: 'wave',      name: '声波 · Trio',     icon: 'wave',     hue: 'magenta',  start: 0,    end: null,
     place: {x: 50, y: 60, w: 55}},
    /* 计时（第 88 轮）。**图标与色相都取文字那一族**（`text` ／ orange），因为它就是
       一条文字元素——内容由播放头派生而已（ADR-CT01）。橙系这里已经有文本组与图片两条，
       §12.7 早已写明「行的区分靠图标与行名，不靠色相」；把「它是文字」这件事在时间轴上
       说出来，比再挑一个没人认得的色相有用。落位取左上角：那是计时的惯用位，且十三件
       演示装置里只有这一角是空的——右上角会压在标题上（文本组 50/18 宽 60，横向占 20…80）。
       横坐标取 22 而不是贴边的 14：读数是一整串等宽数字，盒子跟着内容长（`place.w`
       在这里不夹它），太贴边就压到画面外去了。**条子被画面框裁掉那一档不靠落位躲**
       ——`stage-toolbar.jsx` 第 88 轮给条子本身补了一次贴边夹取（此前只有弹层有）。

       **时长恒取 `BC_EL.COUNT_SPAN`（10s），不是 endAnchor**：计时的时长就是它数多久，
       铺到片尾等于一条数到 3 分 26 秒的倒计时。落点 10s 是为了让默认播放头（12.4s）
       落在窗口里——半开窗口之外画的是一个破折号，那是对的语义，但不该是打开就看见的
       第一眼。 */
    /* 盒宽 18 → 30（第 89.1 轮）：容器有了宽度柄、读数有了三档对齐之后，盒子必须
       **比读数宽**这两件事才看得见——恰好贴着内容的盒子里，左中右画出来是同一张图。 */
    {id: 'e-cnt',  kind: 'counter',   name: '计时 · 倒计时',   icon: 'text',     hue: 'orange',
     start: CNT_START, end: CNT_START + window.BC_EL.COUNT_SPAN,
     place: {x: 22, y: 12, w: 30}},
    {id: 'e-ovl',  kind: 'overlay',   name: '覆盖层 · 雪花',   icon: 'sparkle',  hue: 'seafoam',  start: 0,    end: null,
     place: {x: 50, y: 50, w: 100}},
    {id: 'e-vfr',  kind: 'vframe',    name: '取景框 · 摄像机', icon: 'film',     hue: 'indigo',   start: 0,    end: null,
     place: {x: 50, y: 50, w: 100}},
    {id: 'e-tpl',  kind: 'tpl',       name: '模板', icon: 'template', hue: 'purple',   start: 0,    end: null,
     place: {x: 50, y: 92, w: 96}},
    /* 白板手绘（设计稿 docs/design/video/bcut-whiteboard-animation-design.md §6.1）：铺满画布的一张
       白纸 ＋ 内置示范笔画，80–92 s 那一段（B-roll 之后，不压默认播放头那一屏）。 */
    {id: 'e-wb',   kind: 'whiteboard', name: '白板手绘 · 示范', icon: 'whiteboard', hue: 'brown', start: 80, end: 92,
     place: {x: 50, y: 50, w: 100, h: 100}},
  ];
  /* 一行四个角色（§12.7，第 39.2 轮补上 hover 档）：
     底 / 选中底 / 边 / **hover 与选中的边** / 字。`700` 那一档是这一轮给
     artboard-tokens.css 加的——此前只有 200/300/400/1000 四档，hover 边没有可指的值。 */
  const ELEMENT_HUE_STOPS = {
    normal:   {bg: '200', sel: '300', border: '400', hover: '700', fg: '1000'},
    gray:     {bg: '100', sel: '200', border: '400', hover: '600', fg: '700'},
  };

  /* ---------- 项目（§8.1 演示七项，覆盖全部状态；两份示例一中一英） ----------
     第 118 轮起每项多出四组字段，供「我的项目」两层搜索取数（§17.3）：
       · `mtime`：多少分钟前改的。`modified` 是给人看的相对时间串，排不了序——
         搜索结果的最后一条判据要「新者靠前」，就得有个能比大小的数。
       · `otime`：多少分钟前打开过，侧栏「项目」段默认按它排（最近编辑档仍用 `mtime`）。
         有意和 `mtime` 排出不同的次序，两档切换才看得出差别。
       · `ctime`：多少分钟前建的（2026-09-26，「最近创建」档）。不小于 `mtime` / `otime`——
         先有项目才谈得上打开和修改；次序又和前两档都不同。
       · `desc` / `notes` / `url` / `source`：第一层能搜到的元信息。来源三项
         （标题 / 简介 / 上传者）只有从链接导入的项目才有。
       · `content`：第二层。文稿段落、章节、说话人、译文、画面文字，各自带时间。
         真机上这一层来自内核 `bcut project search` 的缓存索引，所以**排队中 /
         出错的项目没有 content**——还没转录出来的东西搜不到，这不是缺数据。 */
  const projects = [
    {id: 'p11', title: 'Sintel · 预告片剪辑', dir: 'd6', folder: 'Sintel预告', status: 'ready', bare: true, focus: 'movie',
     preview: {url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
       poster: 'https://media.w3.org/2010/05/sintel/poster.png',
       credit: 'Sintel © Blender Foundation · CC BY 3.0',
       source: 'https://www.w3.org/2010/05/video/mediaevents'},
     src: {name: 'sintel-trailer.mp4', path: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
       format: 'MP4 · H.264 / AAC · 24 fps', res: '854×480', state: 'ok'},
     duration: 52.208333, lang: '英语', modified: '刚刚', mtime: 0, otime: 30, ctime: 1440, hue: 28,
     desc: 'Sintel 官方预告片：直接播放远程视频，练习定位、分割与画面调整。',
     notes: 'Sintel © Blender Foundation，CC BY 3.0。视频由 W3C 托管；未改动原素材。没有预置虚构字幕。',
     toast: 'Sintel © Blender Foundation · CC BY 3.0 · W3C 视频源',
     url: 'https://media.w3.org/2010/05/sintel/trailer.mp4', content: {}, meta: {}, sample: true},
    /* 剪口播的实验项目（第 193 轮）：`entry: 'clean'` 直接开在文稿的剪辑模式，`bare`
       表示「画面上没有任何元素」——时间轴只有按 clip 拆出的源视频、字幕轨和源音频，
       没有 B-roll / 文字 / 贴纸 / 音乐，也不预埋 AI 建议：口癖、停顿要用户自己点
       「找可剪的口」跑出来。第 194 轮文稿改为单人版本，保留相同 cue id 与剪口位置。 */
    {id: 'p8', title: '口播剪辑 · 实验', dir: 'd3', folder: '发布口播', status: 'complete', entry: 'clean', bare: true,
     src: {name: 'talk-take2.mp4', path: '~/Movies/口播/talk-take2.mp4', format: 'MP4 · H.264', res: '1920×1080', state: 'ok'},
     duration: DUR, lang: '中文', model: 'moss-transcribe', modified: '刚刚', mtime: 1, otime: 90, ctime: 7200, hue: 20,
     desc: '单人中文口播：视频、单语字幕与剪口，练习去口癖、删停顿和文字剪辑。',
     notes: '先让 AI 找口癖和停顿，再在文稿里拖选补剪；看时间轴上剪掉了哪儿。',
     toast: '剪辑实验视频 · 只有源视频和文稿 · 拖选文字按 ⌫ 剪掉，或让 AI 先找口癖',
     content: {
       chapters: [{t: 0, title: '开场'}, {t: 22, title: '正文'}, {t: 158, title: '收尾'}],
       speakers: ['林澈'],
       paras: [
         {t: 4,   text: '欢迎回到科浪，这一期我们聊一个老话题的新做法：把视频工具做成本地优先的。'},
         {t: 26,  text: '先说语音识别。过去几年大家默认它是云上的事，模型太大、机器带不动，上传是唯一选择。'},
       ],
     },
     meta: {speakers: 1, chapters: 3, cues: 62}, sample: true},
    /* 转录时没建字幕的视频（2026-10-08，§12.6）：智能体从链接导入、转录（不建字幕层），接着在会话里逐句翻译（s24）。
       `captions: false`：有文稿、没有字幕轨——时间轴上是只读的「文稿」行，不是空的；字幕 Tab 的运行态头是智能体自己翻译那一版。 */
    {id: 'p13', title: '口播 · 本机优先（链接导入）', dir: 'd3', folder: '口播-链接导入', status: 'complete', entry: 'clean', bare: true, captions: false,
     src: {name: 'local-first-talk.mp4', path: '~/BaoCut/Imports/local-first-talk.mp4', format: 'MP4 · H.264', res: '1920×1080', state: 'ok'},
     duration: DUR, lang: '中文', model: 'moss-transcribe', modified: '1 分钟前', mtime: 1, otime: 2, ctime: 30, hue: 32,
     desc: '智能体从链接导入并转录的口播；转录时没建字幕，正在会话里译成英语。',
     notes: '转录时没建字幕：时间轴上是只读的文稿行，点一句落播放头。',
     toast: '链接导入的口播 · 有文稿、还没有字幕轨 · 智能体正在翻译',
     content: {}, meta: {speakers: 1, chapters: 0, cues: 62}, sample: true},
    {id: 'p1', title: '中 → EN · 科浪访谈双语版', dir: 'd1', folder: '中译英双语版', status: 'complete', entry: 'trans', bare: true,
     src: {name: 'kelang-ep42-master.mp4', path: '~/Movies/播客/kelang-ep42-master.mp4', format: 'MP4 · H.264', res: '1920×1080', bytes: 88080384, state: 'ok'},
     duration: DUR, lang: '中文', model: 'moss-transcribe', modified: '2 小时前', mtime: 120, otime: 0, ctime: 12960, hue: 252,
     desc: '中文访谈出海：中文原声与英文译文，专注双语字幕的对齐、断句和排版。',
     notes: '译文在上、原文在下；没有贴纸、装饰文字、B-roll 或配乐。',
     url: 'https://kelang.example/ep42',
     source: {title: '科浪电台 · 第 42 期', uploader: '科浪电台',
              publishedAt: '20260420', platform: 'YouTube', views: 128430, videoId: 'kL4nG2xQe0A',
              desc: '科浪电台第 42 期完整版节目简介：两位嘉宾从工具链的历史讲起，先聊为什么剪辑软件长期把语音当成音频的附属品，再逐段拆开本机转录、强制对齐、翻译与确定性导出这四步各自卡在哪里，最后回答了听众关于机器配置、隐私边界与成本的十几个提问。'},
     content: {
       chapters: [{t: 0, title: '开场'}, {t: 22, title: '现场访谈：语音识别怎么跑在本机'},
                  {t: 95, title: '产品演示'}, {t: 158, title: '观点与总结'}],
       speakers: ['林澈', '周远', '苏黎'],
       paras: [
         {t: 4,   text: '欢迎回到科浪，这一期我们聊一个老话题的新做法：把视频工具做成本地优先的。'},
         {t: 26,  text: '先说语音识别。过去几年大家默认它是云上的事，模型太大、机器带不动，上传是唯一选择。'},
         {t: 41,  text: '但小模型这两年掉得很快，一块普通的笔记本现在跑一段一小时的语音识别，比上传加排队还快。'},
         {t: 63,  text: '更重要的是语音数据不出本机。访谈、内部会议、还没发布的产品演示，这些素材本来就不该往外传。'},
         {t: 88,  text: '苏黎补充说，本地跑还有一个副作用：你可以随便重跑，不用算钱，语音模型换一个就换一个。'},
         {t: 104, text: '我们演示一下。拖进来一个文件，选中文，点开始，语音就地转成带时间戳的文稿。'},
         {t: 131, text: '文稿是可编辑的：改一个词，字幕、翻译、导出三处同时跟着变，不用回去重跑语音。'},
         {t: 141, text: '周远追问过一次成本：语音识别在本机是电费，在云上是账单，量一大就不是一个量级。'},
         {t: 152, text: '还有离线。飞机上、客户机房里、断网的展会现场，语音这一步不能是必须联网的一步。'},
         {t: 166, text: '总结一下，本地优先不是反对云，是把默认值调回来：能在本机做完的就别上传。'},
         {t: 188, text: '下期我们把语音之外的部分讲完：对齐、翻译，还有导出为什么必须是确定的。'},
       ],
       trans: [
         {t: 26,  lang: 'English', text: 'Let us start with speech recognition. For years everyone assumed it belonged in the cloud.'},
         {t: 63,  lang: 'English', text: 'More importantly, your audio never leaves the machine.'},
         {t: 26,  lang: '日本語',  text: 'まずは音声認識の話から。数年前まではクラウド前提でした。'},
       ],
     },
     /* 重新转录「取代这部视频的文稿」的影响预览读这里（product-design §5.11）：两种译文（英语审过 40 句）、
        12 处字幕 pin（手工换行 / 固定时间）、一组英语配音。句数与 meta.cues 一致。 */
     docs: {transcripts: [{id: 'p1-tx1', lang: 'zh', units: 62, edited: false}],
       translations: [{id: 'p1-tr-en', lang: 'en', from: 'p1-tx1', units: 62, reviewed: 40},
                      {id: 'p1-tr-ja', lang: 'ja', from: 'p1-tx1', units: 62, reviewed: 0}],
       dubs: [{id: 'p1-dub-en', lang: 'en', translation: 'p1-tr-en', units: 62}],
       layers: [{id: 'p1-sub-zh', lang: 'zh'}, {id: 'p1-sub-en', lang: 'en', bilingual: true}],
       pins: 12},
     meta: {speakers: 3, chapters: 4, cues: 62}, sample: true},
    /* 英文示例（第 73 轮）：同一期播客的英文版——源语言英文、译文中文，
       方向与 p1 相反。没有它，英文字幕样式（尤其动效字幕的逐词排版）在
       中文项目里永远只有译文行可看，而译文行没有词级时间戳。
       它也是搜索里唯一能出「译文命中中文」的项目——中文查询在英文原文上不命中，
       只有译文那一层会亮，这正是两层要分开显示的理由。 */
    {id: 'p7', title: 'EN → 中 · Code & Wander 双语版', dir: 'd2', folder: '英译中双语版', status: 'complete', entry: 'trans', bare: true,
     src: {name: 'code-wander-ep42-en.mp4', path: '~/Movies/播客/code-wander-ep42-en.mp4', format: 'MP4 · H.264', res: '1920×1080', state: 'ok'},
     duration: DUR, lang: '英语', model: 'whisper-large-v3', modified: '1 小时前', mtime: 60, otime: 8, ctime: 8640, hue: 96,
     /* 用户在编辑器里改过英文原文（当前文稿指纹 ≠ stages.asr）：重新转录时工具页警告，默认落点退回新建视频（product-design §5.11） */
     transcriptEdited: true,
     desc: '英文访谈汉化：英语原声与中文译文，对照英文逐词高亮和中文断句。',
     notes: '译文里的「语音」统一用这个词，不要和「音频」混着来。',
     url: 'https://codeandwander.example/42',
     source: {title: 'Code & Wander · Episode 42', desc: 'Local-first speech recognition and deterministic rendering.', uploader: 'Code & Wander'},
     content: {
       chapters: [{t: 0, title: 'Cold open'}, {t: 22, title: 'On-device speech recognition'},
                  {t: 95, title: 'Demo'}, {t: 158, title: 'Wrap-up'}],
       speakers: ['Lin', 'Zhou', 'Su'],
       paras: [
         {t: 26,  text: 'Let us start with speech recognition, which everyone assumed belonged in the cloud.'},
         {t: 63,  text: 'The audio never leaves your machine, and that matters more than the speed does.'},
         {t: 104, text: 'Drop a file in, pick a language, hit start — the transcript comes back with timestamps.'},
       ],
       trans: [
         {t: 26,  lang: '简体中文', text: '先说语音识别。过去几年大家默认它是云上的事。'},
         {t: 63,  lang: '简体中文', text: '语音数据不出本机，这件事比快不快更要紧。'},
         {t: 104, lang: '简体中文', text: '拖进来一个文件、选语言、点开始，语音就地转成带时间戳的文稿。'},
       ],
     },
     meta: {speakers: 3, chapters: 4, cues: 62}, sample: true},
    {id: 'p9', title: 'Elements · 元素实验室', dir: 'd6', folder: '元素实验室', status: 'complete', focus: 'elements',
     src: {name: 'elements-demo.mp4', path: '~/Movies/演示/elements-demo.mp4', format: 'MP4 · H.264', res: '1920×1080', state: 'ok'},
     duration: DUR, lang: '中文', modified: '刚刚', mtime: 2, otime: 240, ctime: 4380, hue: 282,
     desc: '文字、形状、贴纸、图片、视频、波形、进度条、计时器与模板的交互试验场。',
     notes: '不预置字幕与文稿。点时间轴上的元素调整样式、位置和动画。',
     toast: '元素实验室 · 点时间轴上的元素，试试样式、位置与动画',
     content: {overlay: [{t: 30, text: '本地优先的视频工具'}]}, meta: {}, sample: true},
    {id: 'p10', title: '综合制作 · 播客精剪', dir: 'd1', folder: '播客精剪', status: 'complete', entry: 'trans', focus: 'mixed',
     src: {name: 'kelang-ep42-master.mp4', path: '~/Movies/播客/kelang-ep42-master.mp4', format: 'MP4 · H.264', res: '1920×1080', bytes: 88080384, state: 'ok'},
     duration: DUR, lang: '中文', model: 'moss-transcribe', modified: '刚刚', mtime: 3, otime: 180, ctime: 5760, hue: 252,
     desc: '双语字幕、章节、B-roll、标题、贴纸和配乐，组合成一条完整节目。',
     notes: '在同一部视频里试字幕校对、翻译、剪辑和元素包装。',
     toast: '综合制作 · 双语字幕、元素、B-roll 与配乐已就位',
     /* 配乐轨（剧情短片 §5.5，2026-09-24）：`bcut score render` 按总线写出的三路 stem，各是一条
        `score:<bus>` 手动轨。演示里环境声那一路过期了（事件表在它生成之后改过），行头挂黄点；
        App 的轨菜单能重新生成这一路或全部，Web 只看状态（§22.4）。 */
     score: [{bus: 'music', stale: false},
             {bus: 'amb', stale: true, staleInputs: ['events.json']},
             {bus: 'sfx', stale: false}],
     content: {speakers: ['林澈', '周远', '苏黎'], overlay: [{t: 30, text: '本地优先的视频工具'}]},
     /* 视频里的文档事实（product-design §2.7：工具的视频选择器读 Space 目录，不打开视频）：中文文稿、英语译文、
        一组英语配音。其余视频没有这一栏，事实从记录推出来（model-tool-targets.js `facts`）。 */
     docs: {transcripts: [{id: 'p10-tx1', lang: 'zh'}], translations: [{id: 'p10-tr-en', lang: 'en', from: 'p10-tx1'}],
       dubs: [{id: 'p10-dub-en', lang: 'en', translation: 'p10-tr-en', engine: 'indextts2'}],
       layers: [{id: 'p10-sub-zh', lang: 'zh'}, {id: 'p10-sub-en', lang: 'en', bilingual: true}]},
     meta: {speakers: 3, chapters: 4, cues: 62}, sample: true},
    {id: 'p2', title: '产品发布会 · 主视频', dir: 'd3', folder: '发布会主视频', status: 'transcribing', progress: 45,
     src: {name: 'launch-keynote.mov', path: '~/Movies/发布会/launch-keynote.mov', format: 'MOV · ProRes', res: '3840×2160', bytes: 62813896704, state: 'ok'},
     duration: 3120, lang: '自动检测', model: 'moss-transcribe', modified: '12 分钟前', mtime: 12, otime: 300, ctime: 320, hue: 152,
     desc: '秋季发布会全场录像，等转录完再切片。',
     notes: '现场语音有回声，若识别不准就换一个模型重跑。',
     content: {}, meta: {}},
    {id: 'p3', title: '课程 03 · 确定性渲染', dir: 'd5', folder: '第03讲', status: 'queued', queuePos: 2,
     src: {name: 'lesson-03.mp4', path: '~/Movies/课程/lesson-03.mp4', format: 'MP4 · H.264', res: '1920×1080', state: 'ok'},
     duration: 1740, lang: '中文', model: 'qwen3-asr-1.7b', modified: '25 分钟前', mtime: 25, otime: 2880, ctime: 2900, hue: 28,
     desc: '第三讲：同一份工程在任何机器上渲染出同一帧。',
     content: {}, meta: {}},
    {id: 'p4', title: '客户访谈 · 二月', dir: 'd4', folder: '二月合并版', status: 'complete',
     src: {name: 'interview-feb.mp4', path: '/Volumes/素材盘/interview-feb.mp4', format: 'MP4 · H.264', res: '1920×1080', state: 'missing', volume: '素材盘'},
     duration: 2260, lang: '英语', model: 'whisper-large-v3', modified: '3 天前', mtime: 4320, otime: 45, ctime: 30240, hue: 200,
     desc: '二月的两场客户访谈合并版，用来抽用户原话。',
     notes: '素材盘没插时只有文稿能看；语音要重听得先接盘。',
     content: {
       chapters: [{t: 0, title: 'Warm-up'}, {t: 240, title: 'Workflow today'}],
       speakers: ['Dana', 'Ivo'],
       paras: [
         {t: 252, text: 'We record everything, but nobody goes back to listen unless there is a transcript.'},
         {t: 610, text: 'Search is the part we miss most — we cannot find the sentence we remember.'},
       ],
       trans: [{t: 610, lang: '简体中文', text: '我们最缺的是搜索：记得那句话，却找不到它在哪。'}],
     },
     meta: {speakers: 2, chapters: 6, cues: 418}},
    /* 从 p1 切出来的一支短视频（§15.12）：引用同一份原片，`origin` 记出身。起止取第 38–54 句的边界。 */
    {id: 'p5', title: '短视频切片 · 第 7 条', dir: 'd1', folder: '切片-07', status: 'complete', entry: 'trans', bare: true,
     delivery: 'shorts', ratio: '9:16',
     origin: {project: 'p1', in: cues[37].start, out: cues[53].end},
     cut: {focus: 'speaker', focusX: null, tracks: 'both', style: 'shorts'},
     src: {name: 'kelang-ep42-master.mp4', path: '~/Movies/播客/kelang-ep42-master.mp4', format: 'MP4 · H.264', res: '1920×1080', state: 'ok'},
     duration: +(cues[53].end - cues[37].start).toFixed(2), lang: '中文', model: 'moss-transcribe', modified: '上周', mtime: 10080, otime: 1440, ctime: 10200, hue: 282,
     desc: '从第 42 期里剪的竖屏切片，讲本地语音识别那一段。',
     content: {
       chapters: [{t: 0, title: '整条'}],
       speakers: ['林澈'],
       paras: [{t: 3, text: '一句话说完：语音识别现在能在自己的笔记本上跑完。'}],
       overlay: [{t: 0, text: '本机跑语音'}],
     },
     meta: {speakers: 1, chapters: 1, cues: 24}},
    /* 同一个来源的第二支：切出后在编辑器里「后面多留一句」，所以 `used` 比 `origin` 长一句；取景是居中 */
    {id: 'p12', title: '为什么要把视频工具做在本机', dir: 'd1', folder: '切片-本机', status: 'complete', entry: 'trans', bare: true,
     delivery: 'shorts', ratio: '9:16',
     origin: {project: 'p1', in: cues[4].start, out: cues[13].end},
     used: [{in: cues[4].start, out: cues[14].end}],
     cut: {focus: 'center', focusX: null, tracks: 'orig', style: 'shorts'},
     src: {name: 'kelang-ep42-master.mp4', path: '~/Movies/播客/kelang-ep42-master.mp4', format: 'MP4 · H.264', res: '1920×1080', state: 'ok'},
     duration: +(cues[14].end - cues[4].start).toFixed(2), lang: '中文', model: 'moss-transcribe', modified: '3 天前', mtime: 4320, otime: 4320, ctime: 10100, hue: 252,
     desc: '从第 42 期里剪的竖屏切片，讲为什么把视频工具做在本机。',
     content: {
       chapters: [{t: 0, title: '整条'}],
       speakers: ['林澈'],
       paras: [{t: 2, text: '视频不出这台电脑，是做这个工具的出发点。'}],
     },
     meta: {speakers: 1, chapters: 1, cues: 11}},
    {id: 'p6', title: '年度回顾 · 素材汇编', dir: 'd7', folder: '素材汇编', status: 'error', error: '模型权重缺少 forced aligner',
     src: {name: 'year-review.mov', path: '~/Movies/回顾/year-review.mov', format: 'MOV · H.264', res: '1920×1080', bytes: 6335076761, state: 'ok'},
     duration: 4820, lang: '中文', model: 'qwen3-asr-0.6b', modified: '上周', mtime: 11520, otime: 20160, ctime: 40320, hue: 350,
     desc: '一年素材的粗剪合集，转录失败了还没重跑。',
     content: {}, meta: {}},
  ];


  /* ---------- 项目（目录）与 Space 产物（2026-10-01，product-design §2.3 / §4） ----------
     三个词不混用：**项目**是一个目录，也是 Agent 的工作目录；**视频**是项目下的一个子目录，
     单个可编辑、可导出的视频（就是上面 `projects` 里的每一条，`dir` 指回所属项目、`folder` 是子目录名）；
     **成片**是视频导出的文件。会话挂在一个项目下（`sessions[].dir`，有视频的会话从视频推出来），也可以不属于任何项目。
     `mtime`：目录自己最近一次有动静是多少分钟前（只在项目里还没有视频、也没有会话时起作用）。
     `pinned`：用户置顶（Home 侧栏「置顶」段）。 */
  const agentProjects = [
    {id: 'd1', name: '科浪访谈 第 42 期', path: '~/BaoCut/科浪访谈-42/', mtime: 0},
    {id: 'd2', name: 'Code & Wander 第 42 期', path: '~/BaoCut/Code-and-Wander-42/', mtime: 8},
    {id: 'd3', name: '新品发布', path: '~/BaoCut/新品发布/', mtime: 6, pinned: true},
    {id: 'd4', name: '客户访谈', path: '~/BaoCut/客户访谈/', mtime: 45},
    {id: 'd5', name: '确定性渲染课程', path: '~/BaoCut/确定性渲染课程/', mtime: 25},
    {id: 'd6', name: '素材实验', path: '~/BaoCut/素材实验/', mtime: 0},
    {id: 'd7', name: '年度回顾', path: '~/BaoCut/年度回顾/', mtime: 11520},
    {id: 'd8', name: '产品手册动画', path: '~/BaoCut/产品手册动画/', mtime: 35},
  ];

  /* Space 里除视频之外的条目（§4.2）：成片 / 图片 / 音频 / 字幕 / 文档 / 模板。Space 本身不存东西，
     这些是各项目目录里权威记录的演示投影——`dir` / `movie` / `session` / `task` 是来源，`status` 按 §4.4：
     generating 生成中（进度读 `task` 那条任务记录，不另存）· candidate 候选 · applied 已应用 ·
     published 已发布 · stale 来源已变 · missing 缺失；没有 status 的是普通素材。
     `fav` / `trashed` 是用户的整理，`parent` + `ver` 是二次编辑另存出来的版本（原条目不动）。
     `text` 只给字幕 / 文档的查看器用。`bytes` 是文件大小（视频记在 `src.bytes`），列表的「规格」列读它，没有就不写。 */
  const spaceOutputs = [
    {id: 'o1', kind: 'final', name: '科浪 42 期 · 日本語字幕版.mp4', dir: 'd1', movie: 'p1', task: 'j3', status: 'stale',
     dur: 206, res: '1920×1080', bytes: 100663296, mtime: 60, file: '导出/kelang-ep42.mp4',
     note: '导出之后视频又改过：第 3 章的停顿正在压缩。成片仍可用，但不再代表当前的视频。'},
    {id: 'o2', kind: 'subtitle', name: '科浪 42 期 · 英文字幕.srt', dir: 'd1', movie: 'p1', session: 's2', messageId: 'm8', status: 'published',
     lines: 62, mtime: 18, file: '导出/kelang-ep42.en.srt',
     text: '1\n00:00:00,000 --> 00:00:04,800\nWelcome back to Kelang. I am Lin Che.\n\n2\n00:00:04,800 --> 00:00:10,300\nToday we have two friends who build local video tools.\n\n3\n00:00:10,300 --> 00:00:13,700\nRendering is the part I care about the most.'},
    {id: 'o15', kind: 'final', name: '科浪 42 期 · 中英双语.mp4', dir: 'd1', movie: 'p1', status: 'published',
     dur: 206, res: '1920×1080', bytes: 104857600, mtime: 30, file: '导出/kelang-ep42.zh-en.mp4'},
    {id: 'o16', kind: 'doc', name: '科浪 42 期 · 文稿.md', dir: 'd1', movie: 'p1', status: 'published',
     lines: 6, bytes: 2252, mtime: 32, file: '导出/kelang-ep42.transcript.md',
     text: '# 科浪访谈 第 42 期\n\n林澈：欢迎回到科浪，我是林澈。\n\n嘉宾：今天聊聊本机视频工具。\n\n林澈：先从渲染说起。'},
    {id: 'o3', kind: 'final', name: '第 7 条切片 · 竖版.mp4', dir: 'd1', movie: 'p5', status: 'published',
     dur: 41, res: '1080×1920', bytes: 19293798, mtime: 10080, file: '导出/shorts-07.mp4'},
    {id: 'o4', kind: 'image', name: '第 42 期封面 · 候选 A.png', dir: 'd1', movie: 'p10', session: 's6', messageId: 'm3', status: 'candidate',
     res: '1280×720', bytes: 1258291, mtime: 1500, fav: true, hue: 252, file: '素材/cover-a.png'},
    {id: 'o5', kind: 'audio', name: '片头配乐 · 30 秒.wav', dir: 'd1', movie: 'p10', status: 'applied',
     dur: 30, bytes: 5557452, mtime: 180, file: '素材/intro-30s.wav'},
    {id: 'o14', kind: 'final', name: '第 42 期 · 横版预告.mp4', dir: 'd1', movie: 'p10', status: 'published',
     dur: 58, res: '1920×1080', bytes: 25794969, mtime: 2880, fav: true, file: '导出/trailer-16x9.mp4'},
    {id: 'o12', kind: 'template', name: '访谈双语 · 横版', dir: 'd1', movie: 'p1', mtime: 4320, file: '模板/interview-bilingual/'},
    {id: 'o6', kind: 'doc', name: '章节表 · 播客体.md', dir: 'd2', movie: 'p7', session: 's3', messageId: 'm8', status: 'applied',
     lines: 4, mtime: 62, file: 'chapters.md',
     text: '# Chapters\n\n1. Cold open\n2. Why local\n3. How rendering works\n4. What is next'},
    {id: 'o7', kind: 'doc', name: '竖版预告 · 分镜草稿.md', dir: 'd3', movie: 'p2', session: 's16', messageId: 'm2', status: 'candidate',
     lines: 9, mtime: 6, file: '竖版预告/分镜草稿.md',
     text: '# 竖版预告 · 3 条\n\n1. 离线能用吗（00:21:58 起）\n2. 一小时素材十二分钟转完\n3. 中英混说按句分开\n\n每条 30 秒左右，9:16，字幕居中偏下。'},
    {id: 'o8', kind: 'audio', name: '客户访谈 · 原声精选.m4a', dir: 'd4', movie: 'p4', status: 'missing',
     dur: 184, mtime: 4320, file: '/Volumes/素材盘/精选/interview-picks.m4a', note: '在素材盘上，盘没接上。'},
    {id: 'o9', kind: 'doc', name: '手册动画 · 分镜.md', dir: 'd8', session: 's17', messageId: 'm3', status: 'candidate',
     lines: 12, mtime: 35, file: '分镜.md',
     text: '# 产品手册动画 · 40 秒\n\n镜头 1（0–6s）封面插图淡入，标题逐字出现\n镜头 2（6–14s）第 3 页插图，箭头指向接口\n镜头 3（14–24s）三步流程依次点亮\n镜头 4（24–40s）收尾：口号与联系方式'},
    {id: 'o10', kind: 'image', name: '手册插图 · 第 3 页.png', dir: 'd8', session: 's17',
     res: '1600×1200', mtime: 240, hue: 152, file: '插图/page-03.png'},
    {id: 'media-cover-a', kind: 'image', name: '封面候选 A.svg', file: '封面/候选-a.svg', dir: 'd8', session: 's17', mtime: 1, res: '960×600', previewGroup: 'camp-covers', previewSrc: 'assets/media-preview/cover-a.svg'},
    {id: 'media-cover-b', kind: 'image', name: '封面候选 B.svg', file: '封面/候选-b.svg', dir: 'd8', session: 's17', mtime: 1, res: '960×600', previewGroup: 'camp-covers', previewSrc: 'assets/media-preview/cover-b.svg'},
    {id: 'media-cover-c', kind: 'image', name: '封面候选 C.svg', file: '封面/候选-c.svg', dir: 'd8', session: 's17', mtime: 1, res: '960×600', previewGroup: 'camp-covers', previewSrc: 'assets/media-preview/cover-c.svg'},
    {id: 'media-single', kind: 'image', name: '独立图片.svg', file: '封面/独立图片.svg', dir: 'd8', session: 's17', mtime: 1, res: '960×600', previewSrc: 'assets/media-preview/cover-c.svg'},
    {id: 'media-gif', kind: 'image', name: '动效分帧.gif', file: '动效分帧.gif', dir: 'd8', session: 's17', mtime: 1, previewSrc: 'assets/media-preview/motion-study.gif'},
    {id: 'media-panorama', kind: 'image', name: '山谷全景.svg', file: '山谷全景.svg', dir: 'd8', session: 's17', mtime: 1, panorama: true, previewSrc: 'assets/media-preview/panorama.svg'},
    {id: 'media-pending', kind: 'image', name: '生成中的候选.svg', file: '封面/生成中.svg', dir: 'd8', session: 's17', mtime: 1, previewPending: true, previewGroup: 'next-covers', previewGroupLabel: '正在生成'},
    {id: 'media-previous', kind: 'image', name: '上一轮候选.svg', file: '封面/上一轮.svg', dir: 'd8', session: 's17', mtime: 2, previewGroup: 'previous-covers', previewGroupLabel: '上一轮候选', previewSrc: 'assets/media-preview/cover-c.svg'},
    {id: 'media-audio', kind: 'audio', name: 'audio_preview_demo.wav', file: '音频/audio_preview_demo.wav', dir: 'd8', session: 's17', mtime: 1, dur: 10, previewSrc: 'assets/media-preview/audio-preview-demo.wav'},
    {id: 'media-video', kind: 'final', name: '色块动效.webm', file: '导出/色块动效.webm', dir: 'd8', session: 's17', mtime: 1, res: '640×360', dur: 6, bytes: 18868, previewSrc: 'assets/media-preview/geometric-demo.webm', poster: 'assets/media-preview/video-poster.svg'},
    {id: 'fallback-text', kind: 'doc', name: '说明.abc', file: '说明.abc', dir: 'd8', session: 's17', mtime: 1, contentKind: 'text', bytes: 64, externalOpen: 'folder', text: '这是一个扩展名未知的文本文件。\nContent determines the viewer.\n日本語 العربية'},
    {id: 'fallback-noext', kind: 'doc', name: 'README', file: 'README', dir: 'd8', session: 's17', mtime: 1, contentKind: 'text', bytes: 32, externalOpen: 'folder', text: '没有扩展名，也可以查看文本内容。'},
    {id: 'fallback-binary', kind: 'doc', name: '模型.bin', file: '模型.bin', dir: 'd8', session: 's17', mtime: 1, contentKind: 'binary', bytes: 4096, externalOpen: 'folder'},
    {id: 'fallback-large', kind: 'doc', name: '日志.unknown', file: '日志.unknown', dir: 'd8', session: 's17', mtime: 1, contentKind: 'text', bytes: 2097152, externalOpen: 'folder', previewTooLarge: true},
    {id: 'fallback-missing', kind: 'doc', name: '已移走.abc', file: '已移走.abc', dir: 'd8', session: 's17', mtime: 1, status: 'missing', externalOpen: 'folder'},
    {id: 'preview-pdf', kind: 'doc', name: '制作简报.pdf', file: '制作简报.pdf', dir: 'd8', session: 's17', mtime: 1,
     pages: [
       {title: '产品手册动画', paragraphs: ['一条 40 秒的产品动画，让第一次见到它的人了解从开箱到使用的全过程。', '画幅：横屏 16:9。交付：1080p 成片与可编辑视频。', '使用手册里的六张插图。先介绍产品外观，再解释接口、配对与充电，最后收束到便携和收纳。']},
       {title: '镜头与交付检查', paragraphs: ['开箱 8 秒，接口 12 秒，指示灯与配对 10 秒，充电与收纳 10 秒。', '检查标题没有遮挡产品主体；画面中的指示箭头与说明文字一一对应。', '先确认分镜，再进入制作。交付前完整播放一次，并核对视频、字幕和文稿。']},
     ]},
    {id: 'preview-html', kind: 'doc', name: '交付报告.html', file: '交付报告.html', dir: 'd8', session: 's17', mtime: 1,
     text: '<!doctype html>\n<html lang="zh-Hans">\n<head><meta charset="utf-8"><title>交付报告</title>\n<style>body { font-family: sans-serif; margin: 32px; line-height: 1.8; } table { border-collapse: collapse; width: 100%; } td, th { text-align: left; padding: 12px; border-bottom: 1px solid currentColor; }</style></head>\n<body>\n<p>产品手册动画 / 制作资料</p>\n<h1>从开箱到收纳，40 秒看懂</h1>\n<p>六张手册插图，四个镜头，一条完整的使用路径。</p>\n<table><tr><th>交付物</th><th>规格</th></tr><tr><td>视频</td><td>1920 × 1080 · 40 秒</td></tr><tr><td>字幕</td><td>UTF-8 · SRT</td></tr></table>\n<h2>检查清单</h2><ul><li>插图清晰、比例完整</li><li>文字没有遮挡产品</li><li>镜头之间衔接自然</li></ul>\n</body>\n</html>'},
    {id: 'preview-csv', kind: 'doc', name: '镜头清单.csv', file: '镜头清单.csv', dir: 'd8', session: 's17', mtime: 1,
     text: '镜头,时长（秒）,插图,说明\n开箱,8,01-开箱.png,封面插图淡入\n接口,12,02-接口.png,"接口特写，保留完整构图"\n指示灯与配对,10,"03-指示灯.png, 04-配对.png","步骤一\n步骤二"\n充电与收纳,10,"05-充电.png, 06-收纳.png",口号与联系方式'},
    {id: 'preview-tsv', kind: 'doc', name: '字幕对照.tsv', file: '字幕对照.tsv', dir: 'd8', session: 's17', mtime: 1,
     text: '时间\t中文\tEnglish\n00:00\t从开箱开始\tStart with unboxing\n00:08\t找到接口\tFind the port\n00:20\t轻松配对\tPair in a few steps\n00:30\t充电与收纳\tCharge and store'},
    {id: 'preview-json', kind: 'doc', name: '交付规格.json', file: '交付规格.json', dir: 'd8', session: 's17', mtime: 1,
     text: '{"title":"产品手册动画","durationSeconds":40,"size":{"width":1920,"height":1080},"files":["成片.mp4","字幕.srt"],"editable":true}'},
    {id: 'preview-code', kind: 'doc', name: '检查时长.py', file: '检查时长.py', dir: 'd8', session: 's17', mtime: 1,
     text: '# 检查分镜总时长\nshots = [8, 12, 10, 10]\nexpected_seconds = 40\n\nassert sum(shots) == expected_seconds\nprint(f"Duration: {sum(shots)} seconds")\n'},
    {id: 'o11', kind: 'image', name: '橘猫窗台 · 水彩.png', dir: null, task: 'im1', status: 'generating',
     res: '1024×1024', mtime: 0, hue: 32, file: '~/BaoCut/未归类/cat-window.png'},
    {id: 'o13', kind: 'subtitle', name: '年度回顾 · 粗剪字幕.srt', dir: 'd7', movie: 'p6', trashed: true,
     lines: 0, mtime: 20160, file: '导出/year-review.srt', text: ''},
  ];
  /* ---------- 首页类型入口（§8.1；文案与向导意图磁贴同源）----------
     hue 是这一类型的专属色（第 78.1 轮）：向导意图磁贴与首页快捷入口的图标盒
     用它着色，四类一眼可分；模板 / 空白是旁路，不配色、保持灰底低权重。 */
  const ptypes = [
    {k: 'sub',   icon: 'captions',  hue: 'blue',    title: '给视频加字幕', desc: '识别说话内容，生成可编辑的字幕', fit: '适合播客、课程、访谈', primary: true},
    {k: 'trans', icon: 'translate', hue: 'green',   title: '翻译视频字幕', desc: '先润色原文，再翻译并对齐时间轴', fit: '适合出海、双语发布',   primary: true},
    {k: 'clean', icon: 'mic',       hue: 'orange',  title: '剪口播视频',   desc: '去口癖、压长停顿、挑出坏拍',     fit: '适合口播、录屏讲解',   primary: true},
    {k: 'a2v',   icon: 'audio',     hue: 'magenta', title: '音频转视频',   desc: '给纯音频配上画面、字幕与声波',   fit: '适合播客做成视频',     primary: true},
    {k: 'tpl',   icon: 'template',  title: '用模板开始', desc: '套一套现成版面，之后逐项可改', fit: '', primary: false},
    {k: 'blank', icon: 'blank',     title: '从空白开始', desc: '不转录、不排队，立即可用',     fit: '', primary: false},
  ];

  /* ---------- 模板（§8.1：首页行与向导预览同一套词表同序） ---------- */
  /* 模板目录 = BC_TPL.BUILTINS（第 112 轮；2026-09-14 起十款、含三款水印）：这一份是缺省语言
     （简体中文）的目录，纯层测试与静态词表用它；向导与元素目录在视图里按界面语言读
     `BC_TPL.builtins(app.tplLang)`，两份 id 与版面相同、只有文字不同。 */
  const templates = window.BC_TPL.BUILTINS;

  /* ---------- 转录模型（§8.3 类型 A 三分组） ---------- */
  const models = {
    local: [
      {id: 'moss-transcribe',  name: 'MOSS Transcribe', size: '1.1 GB', installed: true,  recommended: true,  speakers: 'builtin', note: '内建说话人识别'},
      {id: 'qwen3-asr-0.6b',   name: 'Qwen3-ASR 0.6B',  size: '680 MB', installed: true,  speakers: 'pack'},
      {id: 'qwen3-asr-1.7b',   name: 'Qwen3-ASR 1.7B',  size: '2.3 GB', installed: false, speakers: 'pack'},
      {id: 'whisper-large-v3', name: 'Whisper large-v3', size: '947 MB', installed: true,  speakers: 'pack'},
      {id: 'whisper-turbo',    name: 'Whisper large-v3 turbo', size: '1.5 GB', installed: false, speakers: 'pack'},
    ],
    // 与内核支持的四家 STT 目录一致；不猜测未提供的价格。
    cloud: [
      {id: 'gpt-4o-transcribe',      name: 'gpt-4o-transcribe',      provider: 'OpenAI', price: '$0.006 / 分钟'},
      {id: 'gpt-4o-mini-transcribe', name: 'gpt-4o-mini-transcribe', provider: 'OpenAI', price: '$0.003 / 分钟'},
      {id: 'whisper-1',              name: 'whisper-1',              provider: 'OpenAI', price: '$0.006 / 分钟'},
      {id: 'cloud:elevenlabs/scribe_v2', name: 'scribe_v2', provider: 'ElevenLabs', price: '', speakers: 'builtin'},
      {id: 'cloud:elevenlabs/scribe_v1', name: 'scribe_v1', provider: 'ElevenLabs', price: '', speakers: 'builtin'},
      {id: 'cloud:volcengine/bigmodel-asr', name: 'bigmodel-asr', provider: '火山引擎（豆包）', price: '', speakers: 'builtin'},
      {id: 'cloud:volcengine/bigmodel-asr-flash', name: 'bigmodel-asr-flash', provider: '火山引擎（豆包）', price: '', speakers: 'builtin'},
      {id: 'cloud:qwen/qwen3-asr-flash', name: 'qwen3-asr-flash', provider: '阿里云百炼（Qwen）', price: ''},
    ],
    remote: [],   // 读已配对节点表现算；演示环境无节点
  };

  /* 云端模型表（直接调模型那一组）。第 109 轮把「本机 Agent」从这张表里拿掉；第 111 轮起
     它作为另一组回到工具页第一行「用」的下拉里（model-agent.js::runnerOptions 把 agent.harnesses
     与这张表拼成两组，各自标明是什么）——这张表本身只剩 Settings › 云端模型里的 provider；第一项是默认。 */
  const transModels = [
    {id: 'claude-sonnet',    name: 'claude-sonnet', provider: 'Anthropic', note: '默认', dflt: true},
    {id: 'gpt-4o',           name: 'gpt-4o',        provider: 'OpenAI'},
    {id: 'gemini-2.5-pro',   name: 'gemini-2.5-pro', provider: 'Google', note: '未连接 key'},
  ];

  // 演示 8 条（真实是 143 语言，§8.3）
  const sttLangs = [
    {code: 'auto', name: '自动检测'}, {code: 'zh', name: '中文'}, {code: 'en', name: '英语'},
    {code: 'ja', name: '日语'}, {code: 'ko', name: '韩语'}, {code: 'es', name: '西班牙语'},
    {code: 'fr', name: '法语'}, {code: 'de', name: '德语'},
  ];
  /* 演示项目**翻过两门**（English 与 日本語），但画面上默认只叠中 + English。
     第三门是故意留的：轨集的软上限（默认两条、第三条起问一次「换成这一门」还是
     「再叠一条」）没有第三门语言就演不出来，而这一整轮讲的就是多语言。 */
  const transLangs = [
    {code: 'en', name: 'English', native: '英语', done: 100},
    {code: 'zh', name: '中文',    native: '中文', done: 100},
    {code: 'ja', name: '日本語',  native: '日语', done: 100},
    {code: 'ko', name: '한국어',  native: '韩语', done: 0},
    {code: 'es', name: 'Español', native: '西班牙语', done: 0},
    {code: 'de', name: 'Deutsch', native: '德语', done: 0},
    ...(window.BC_LANGUAGES || (typeof require === 'function' ? require('./model-languages.js') : {languages: []})).languages.filter(l => !['en', 'zh', 'ja', 'ko', 'es', 'de'].includes(l.code))
      .map(l => ({code: l.code, name: l.native, native: l.name, done: 0})),
  ];

  /* 模型活动台账（§17.3 / 第 11 轮）：波次短语 + 在飞数 + calls/retried，可逐调用展开。
     App v2 侧任务事件里还没有这些计数的通道（登记在 README 分歧台账）。 */
  const modelActivity = {
    j1: {
      summary: '84 calls · 3 retried · 0 failed',
      // id 只存数字，井号在视图层加：带井号的三位数字会被 conformance 检查器
      // 当成三位简写 hex 色，误报成 off-system
      calls: [
        {id: '084', what: 'transcribe segment 83/120', took: '2.1s · ok',
         req: 'audio[248.0s – 251.2s] · model=moss-transcribe · lang=zh',
         res: '「……我们决定把语音发布做成一等公民……」 · avg_logprob −0.21'},
        {id: '083', what: 'transcribe segment 82/120 · 重试 ×1', took: '4.8s · ok'},
        {id: '082', what: 'transcribe segment 81/120', took: '1.9s · ok'},
      ],
    },
  };

  /* ---------- 后台任务（§17.3；与顶栏进度胶囊、侧栏迷你条读同一真相） ---------- */
  const tasks = [
    {id: 'j1', kind: 'transcribe', project: 'p2', title: '转录 · 产品发布会 · 主视频',
     sub: 'moss-transcribe · 本机', status: 'running', pct: 45, phase: '识别中', source: 'app',
     started: '12 分钟前', cancellable: true,
     /* 详情页的事实（BC_TASK_FACTS）：语言 / 调用计数 / 剩余 / 用时，与 jobs 帧同名。
        liveSegments 是 jobs 帧里最近的实时分段（最多 40 段）；转到 45% ≈ 23:24 */
     lang: '中文', callsDone: 84, callsTotal: 120, callsRetried: 3, leftMs: 930000, elapsedMs: 760000,
     liveSegments: [
       {start: 1318.2, end: 1324.6, text: '接下来是大家问得最多的一件事：离线能用吗？'},
       {start: 1324.6, end: 1331.0, text: '答案是可以，整条转录链路都跑在你自己的电脑上。'},
       {start: 1331.0, end: 1338.4, text: '我们在一台三年前的笔记本上试过，一小时的素材十二分钟转完。'},
       {start: 1338.4, end: 1345.9, text: '而且音频不会离开这台机器，这比快不快更要紧。'},
       {start: 1352.3, end: 1359.8, text: '第二件事是多语言，这次一共支持四十多种语言的识别。'},
       {start: 1359.8, end: 1367.1, text: '同一段视频里中英混着说，也能按句子分开标注。'},
       {start: 1381.5, end: 1389.0, text: '下面请产品负责人上台，给大家现场演示一遍。'},
       {start: 1389.0, end: 1396.4, text: '好，我先把这段四十分钟的访谈拖进来，选语言，点开始。'},
     ]},
    /* 生图任务（2026-09-27，§17.3「任务详情的通用补齐与图片任务」）：jobs 帧带 `images[]`
       （同协议 `JobGranular.images`），每行一次请求。这一条是命令行起的 Codex 单行任务：
       没有项目、没有发起方标题——标题从第一行提示词兜底，不再念阶段名 `image`。
       排在 j1 之后：侧栏迷你条读第一条 running（仍是 j1），胶囊头取索引最大的（仍是 ag1）。
       `startedAt` 是演示时刻（载入时往回 15 秒），用时从它现算。 */
    {id: 'im1', kind: 'image', project: null, stage: 'image', sub: 'Codex 画图', status: 'running', pct: 4,
     phase: '正在画', detail: '第 1 行 · Codex 正在画 · 15 秒', source: 'cli', started: '刚刚',
     startedAt: Date.now() - 15000, runsOn: '本机 · Codex', cancellable: true,
     images: [
       {line: 1, prompt: '一只橘猫趴在老城区的窗台上晒太阳，窗外是层层叠叠的灰瓦屋顶，水彩风格，暖色调，笔触松弛，留白多一些',
        model: 'agent:codex/gpt-image', modelName: 'Codex', engine: 'codex', status: 'running', phase: 'drawing',
        detail: 'Codex 正在画', n: 1, aspect: '1:1', paths: [], elapsedMs: 15000},
     ]},
    {id: 'j2', kind: 'transcribe', project: 'p3', title: '转录 · 课程 03 · 确定性渲染',
     sub: '排队中 · 第 2 位', status: 'queued', pct: 0, source: 'app', started: '25 分钟前', cancellable: true},
    {id: 'j3', kind: 'export', project: 'p1', title: '导出 · 科浪访谈 第 42 期',
     sub: 'mp4 · 1920×1080 · 中文 · 日本語字幕', status: 'done', pct: 100, outcome: 'done', source: 'app',
     started: '1 小时前', artifacts: [{name: 'kelang-ep42.mp4', note: '已完成'}],
     framesDone: 6180, framesTotal: 6180, elapsedMs: 94000,
     /* 成片实测响度（演示值）：导出弹层的 Shorts 发布前检查只把它印成「仅供参考」，不判对错（D4） */
     measured: {lufs: -15.2, tp: -1.8}},
    {id: 'j4', kind: 'transcribe', project: 'p6', title: '转录 · 年度回顾 · 素材汇编',
     sub: 'qwen3-asr-0.6b · 本机', status: 'error', pct: 0, outcome: 'error',
     error: '模型权重缺少 forced aligner', source: 'cli', started: '上周', retry: 'cross-engine',
     lang: '中文', stage: 'transcribe', elapsedMs: 8000},
    /* 命令行建在临时目录里的包（project: null）：不在项目库里，详情页只能给包路径，
       媒体是从包里的 project.json 探出来的（`media` / `pkg`）。 */
    {id: 'j6', kind: 'transcribe', project: null, title: '转录 · review-v1',
     sub: 'whisper-large-v3 · 本机', status: 'done', pct: 100, outcome: 'done', source: 'cli', started: '2 小时前',
     pkg: '/tmp/bcut-review/review-v1.bcut',
     media: {name: 'dry-voice.wav', path: '/tmp/bcut-review/review-v1/dry-voice.wav', duration: 162},
     lang: '中文', stage: 'transcribe', elapsedMs: 38000},
    /* 翻译中（第 35 轮）：Translate Tab 运行态头读的就是这条记录。
       目标语挑**还没有译文的那一门**（日本語），空列表一句句填起来才看得出
       四个阶段各自不同的样子；跑在已有译文的语言上只会看到一堆卡在原地闪。 */
    /* 种子状态是**跑完**，不是「running 0%」：后台任务页平时该看到的是一条
       可撤销的已完成 AI run；那条 0% 永远不动的假进行中，只会让人以为卡住了。
       原型开关切到「翻译中」时它被倒回起点重演（见 editor.jsx 的 setEntry）。 */
    {id: 'j5', kind: 'translate', project: 'p1', title: '翻译 · 科浪访谈 第 42 期 · 中 → 日本語',
     sub: 'claude · Anthropic', status: 'done', outcome: 'done', pct: 100, source: 'app',
     started: '3 分钟前', cancellable: true, target: 'ja',
     lang: '日本語', linesDone: 62, linesTotal: 62, callsDone: 7, callsTotal: 7, elapsedMs: 104000,
     /* undoable：这一跑写进了项目（译文），所以它可以整条撤销，撤销位就存在这条
        记录上——编辑器的收据条与后台任务页读的是同一个字段，不各存一份。
        转录不带这个标记：它是一次成片的事务，没有「撤销转录」这回事；
        导出也不带——那产出的是一个文件，删它不叫撤销。 */
     undoable: true, undone: false,
     undoBody: '这一门语言的译文会被移除。原文一个字不动。'},
    /* 会话里的视频卡（product-design §4.2，home-session.jsx + agent-cards.jsx）：s18 / s19 / s20 三条会话各一组，
       覆盖转录、翻译、导出、合成语音、生成图片五种活的运行 / 完成 / 失败。视频卡只摊开进行中的或最后结束的那件、其余收起，只读这些记录：
       阶段键（转录与导出是 Job 阶段 `jobPhase`，翻译是流程步骤 `step`）、计数、用时与剩余、结果事实。
       合成语音与生成图片不进视频卡：运行中与失败留在步骤行，完成后是候选卡。
       ag21d / ag22d 是下载（视频还没建，单独一张下载卡）：链接、站点与文件名是虚构的。
       排在 ag1 前面：侧栏迷你条读第一条 running（仍是 j1），胶囊头取索引最大的 running（仍是 ag1）。
       API 提供方与模型名是虚构的（星河云、lumen-tts-2、pixa-image-1）。 */
    {id: 'ag18t', kind: 'transcribe', project: 'p10', title: '转录 · 综合制作 · 播客精剪 · 第二段访谈',
     sub: 'Claude Code · Sonnet · 会话「发布前把这一期的活一起做了」', status: 'running', pct: 46, phase: '识别中',
     source: 'agent', session: 's18', started: '4 分钟前', cancellable: true,
     jobPhase: 'transcribing', model: 'moss-transcribe', runsOn: '本机', lang: '中文', mediaSec: 1560, elapsedMs: 252000, leftMs: 296000},
    {id: 'ag18l', kind: 'translate', project: 'p10', title: '翻译 · 综合制作 · 播客精剪 · 中 → 英语',
     sub: 'Claude Code · Sonnet · 会话「发布前把这一期的活一起做了」', status: 'running', pct: 61, phase: '翻译',
     source: 'agent', session: 's18', started: '4 分钟前', cancellable: true, target: 'en',
     step: 'translate', from: '中文', lang: '英语', model: 'Claude Code · Sonnet', linesDone: 38, linesTotal: 62, glossaryHits: 5,
     elapsedMs: 19000, leftMs: 12000, undoBody: '这一门语言的译文会被移除。原文一个字不动。'},
    {id: 'ag18e', kind: 'export', project: 'p10', title: '导出 · 综合制作 · 播客精剪 · 1080p 预览',
     sub: 'Claude Code · Sonnet · 会话「发布前把这一期的活一起做了」', status: 'running', pct: 44, phase: '编码中',
     source: 'agent', session: 's18', started: '4 分钟前', cancellable: true,
     jobPhase: 'generating', runsOn: '本机渲染', framesDone: 2719, framesTotal: 6180, elapsedMs: 41000, leftMs: 52000},
    /* s18 先发的那次导出分辨率设成了 2160p，刚开始就取消、按 1080p 重导：视频卡摊开在跑的三件，
       这一件收进「之前的 1 项」（已取消不算待处理；product-design §3.2.2 视频卡，BC_AGENT_CARDS.foldRows） */
    {id: 'ag18c', kind: 'export', project: 'p10', title: '导出 · 综合制作 · 播客精剪 · 2160p 预览',
     sub: 'Claude Code · Sonnet · 会话「发布前把这一期的活一起做了」', status: 'error', outcome: 'canceled', canceled: true, pct: 3,
     source: 'agent', session: 's18', started: '4 分钟前', jobPhase: 'generating', runsOn: '本机渲染', framesDone: 190, framesTotal: 6180,
     elapsedMs: 4000, error: '已取消'},
    {id: 'ag18s', kind: 'tts', project: 'p10', title: '合成语音 · 片头旁白',
     sub: 'Claude Code · Sonnet · 会话「发布前把这一期的活一起做了」', status: 'running', pct: 33, phase: '生成中',
     source: 'agent', session: 's18', started: '4 分钟前', cancellable: true,
     jobPhase: 'generating', model: 'lumen-tts-2', runsOn: '云端 · 星河云', linesDone: 1, linesTotal: 3, elapsedMs: 6000, leftMs: 12000},
    {id: 'ag18i', kind: 'image', project: 'p10', title: '生成图片 · 竖版封面',
     sub: 'Claude Code · Sonnet · 会话「发布前把这一期的活一起做了」', status: 'running', pct: 50, phase: '生成中',
     source: 'agent', session: 's18', started: '4 分钟前', cancellable: true,
     jobPhase: 'generating', model: 'pixa-image-1', runsOn: '云端 · 星河云', outputsDone: 1, outputsTotal: 2, elapsedMs: 14000, leftMs: 14000},
    {id: 'ag19t', kind: 'transcribe', project: 'p12', title: '转录 · 为什么要把视频工具做在本机',
     sub: 'Claude Code · Sonnet · 会话「转录、翻译、导出，再配旁白和封面」', status: 'done', outcome: 'done', pct: 100,
     source: 'agent', session: 's19', started: '2 小时前', undoable: true, undone: false, captioned: true,
     jobPhase: 'done', model: 'moss-transcribe', runsOn: '本机', lang: '中文', mediaSec: 37, elapsedMs: 41000,
     result: {language: '中文', durationSec: 37, sentences: 10, words: 186, speakers: 2, warnings: ['diarization-unavailable']},
     undoBody: '这一份文稿会被移除，视频回到没有文稿的状态。原片与时间轴不动。'},
    {id: 'ag19l', kind: 'translate', project: 'p12', title: '翻译 · 为什么要把视频工具做在本机 · 中 → 英语',
     sub: 'Claude Code · Sonnet · 会话「转录、翻译、导出，再配旁白和封面」', status: 'done', outcome: 'done', pct: 100,
     source: 'agent', session: 's19', started: '2 小时前', undoable: true, undone: false, target: 'en',
     step: 'write', from: '中文', lang: '英语', model: 'Claude Code · Sonnet', linesDone: 10, linesTotal: 10, glossaryHits: 3, elapsedMs: 9400,
     result: {units: 10, stale: 0, unaligned: 1}, undoBody: '这一门语言的译文会被移除。原文一个字不动。'},
    {id: 'ag19e', kind: 'export', project: 'p12', title: '导出 · 为什么要把视频工具做在本机 · 1080p',
     sub: 'Claude Code · Sonnet · 会话「转录、翻译、导出，再配旁白和封面」', status: 'done', outcome: 'done', pct: 100,
     source: 'agent', session: 's19', started: '2 小时前', jobPhase: 'done', runsOn: '本机渲染', framesDone: 1110, framesTotal: 1110, elapsedMs: 22000,
     artifacts: [{name: '为什么要把视频工具做在本机.mp4', note: '已完成'}],
     files: [{name: '为什么要把视频工具做在本机.mp4', path: 'out/为什么要把视频工具做在本机.mp4', width: 1080, height: 1920, durationSec: 37, size: '86 MB'},
       {name: '为什么要把视频工具做在本机-both.srt', path: 'out/为什么要把视频工具做在本机-both.srt', size: '3 KB'}],
     checks: [{label: '音画同步'}, {label: '字幕没有出画'}, {label: '响度 -15.2 LUFS，比平台建议的 -14 略低', ok: false}]},
    /* s19 第二轮多导了两次（一次画幅设错、取消重导，一次单导英语 SRT）：这一轮的视频卡只摊开最后结束的成片导出，
       之前的三件收进「之前的 3 项」（product-design §3.2.2 视频卡，BC_AGENT_CARDS.foldRows） */
    {id: 'ag19c', kind: 'export', project: 'p12', title: '导出 · 为什么要把视频工具做在本机 · 横版',
     sub: 'Claude Code · Sonnet · 会话「转录、翻译、导出，再配旁白和封面」', status: 'error', outcome: 'canceled', canceled: true, pct: 11,
     source: 'agent', session: 's19', started: '2 小时前', jobPhase: 'generating', runsOn: '本机渲染', framesDone: 120, framesTotal: 1110,
     elapsedMs: 3000, error: '已取消'},
    {id: 'ag19r', kind: 'export', project: 'p12', title: '导出 · 为什么要把视频工具做在本机 · 英语 SRT',
     sub: 'Claude Code · Sonnet · 会话「转录、翻译、导出，再配旁白和封面」', status: 'done', outcome: 'done', pct: 100,
     source: 'agent', session: 's19', started: '2 小时前', jobPhase: 'done', elapsedMs: 1200,
     artifacts: [{name: '为什么要把视频工具做在本机-en.srt', note: '已完成'}],
     files: [{name: '为什么要把视频工具做在本机-en.srt', path: 'out/为什么要把视频工具做在本机-en.srt', size: '2 KB'}]},
    {id: 'ag19s', kind: 'tts', project: 'p12', title: '合成语音 · 片头旁白',
     sub: 'Claude Code · Sonnet · 会话「转录、翻译、导出，再配旁白和封面」', status: 'done', outcome: 'done', pct: 100,
     source: 'agent', session: 's19', started: '2 小时前', model: 'lumen-tts-2', runsOn: '云端 · 星河云', elapsedMs: 9000,
     outputs: [
       {name: '旁白 A · 温和', text: '为什么要把视频工具做在本机？这一期只讲一件事。', durationSec: 5, voice: '温和女声'},
       {name: '旁白 B · 干脆', text: '为什么要把视频工具做在本机？这一期只讲一件事。', durationSec: 4, voice: '干脆男声'},
     ]},
    {id: 'ag19i', kind: 'image', project: 'p12', title: '生成图片 · 竖版封面',
     sub: 'Claude Code · Sonnet · 会话「转录、翻译、导出，再配旁白和封面」', status: 'done', outcome: 'done', pct: 100,
     source: 'agent', session: 's19', started: '2 小时前', model: 'pixa-image-1', runsOn: '云端 · 星河云', elapsedMs: 28000, picked: 0,
     outputsDone: 2, outputsTotal: 2,
     outputs: [{name: '封面 A · 深色桌面', width: 768, height: 1344, art: 7}, {name: '封面 B · 晨光窗台', width: 768, height: 1344, art: 6}]},
    {id: 'ag20t', kind: 'retranscribe', project: 'p5', title: '重新转录 · 短视频切片 · 第 7 条',
     sub: 'Claude Code · Sonnet · 会话「配字幕、配旁白、出封面」', status: 'error', outcome: 'error', pct: 38,
     source: 'agent', session: 's20', started: '1 小时前', jobPhase: 'transcribing', model: 'moss-transcribe', runsOn: '本机', lang: '中文',
     mediaSec: 42, elapsedMs: 16000, errorCode: 'MODEL_CRASHED', error: '语音模型进程意外退出（内存不足）。关掉占内存的程序后再试一次。'},
    {id: 'ag20l', kind: 'translate', project: 'p5', title: '翻译 · 短视频切片 · 第 7 条 · 中 → 日语',
     sub: 'Claude Code · Sonnet · 会话「配字幕、配旁白、出封面」', status: 'error', outcome: 'error', pct: 90, target: 'ja',
     source: 'agent', session: 's20', started: '1 小时前', step: 'write', from: '中文', lang: '日语', model: 'Claude Code · Sonnet',
     linesDone: 12, linesTotal: 12, elapsedMs: 8000, errorCode: 'STALE_JOB_INPUT', error: '译文写入前，原文又被改过 2 句'},
    {id: 'ag20e', kind: 'export', project: 'p5', title: '导出 · 短视频切片 · 第 7 条 · 竖版',
     sub: 'Claude Code · Sonnet · 会话「配字幕、配旁白、出封面」', status: 'error', outcome: 'canceled', canceled: true, pct: 27,
     source: 'agent', session: 's20', started: '1 小时前', jobPhase: 'generating', runsOn: '本机渲染', framesDone: 340, framesTotal: 1260,
     elapsedMs: 11000, error: '已取消'},
    {id: 'ag20s', kind: 'tts', project: 'p5', title: '合成语音 · 片尾一句',
     sub: 'Claude Code · Sonnet · 会话「配字幕、配旁白、出封面」', status: 'error', outcome: 'error', pct: 0,
     source: 'agent', session: 's20', started: '1 小时前', model: 'lumen-tts-2', runsOn: '云端 · 星河云',
     errorCode: 'PROVIDER_AUTH_FAILED', error: '星河云的登录已过期'},
    {id: 'ag20i', kind: 'image', project: 'p5', title: '生成图片 · 竖版封面',
     sub: 'Claude Code · Sonnet · 会话「配字幕、配旁白、出封面」', status: 'error', outcome: 'error', pct: 0,
     source: 'agent', session: 's20', started: '1 小时前',
     errorCode: 'CAPABILITY_NOT_CONFIGURED', error: '还没有可用的图片生成模型'},
    /* 下载中：打开 s21 才开始走（`drive: 'on-view'`，store-agent-sim.jsx），下完建视频、接着转录 */
    {id: 'ag21d', kind: 'download', project: null, title: '春季发布会回放', name: 'spring-launch-replay.mp4',
     url: 'https://lanshan.example/v/spring-launch-replay', site: 'lanshan.example',
     sub: 'Claude Code · Sonnet · 会话「把发布会回放下载下来转录」', status: 'running', pct: 27, phase: null,
     source: 'agent', session: 's21', started: '刚刚', cancellable: true, drive: 'on-view', scenario: 'success',
     sizeMB: 320, mediaSec: 1480, hue: 204, elapsedMs: 12960, leftMs: 35040},
    /* 下载断了：连接中断，可重试；重试从 34% 接着下，下完同样建视频 */
    {id: 'ag22d', kind: 'download', project: null, title: '创始人访谈 · 完整版', name: 'founder-interview-full.mp4',
     url: 'https://qingtai.example/watch/founder-interview-full', site: 'qingtai.example',
     sub: 'Claude Code · Sonnet · 会话「下载这条访谈」', status: 'error', outcome: 'error', pct: 34, phase: null,
     source: 'agent', session: 's22', started: '20 分钟前', cancellable: true, scenario: 'network',
     sizeMB: 214, mediaSec: 2210, hue: 32, elapsedMs: 16300, issue: 'network', error: '连接中断了'},
    /* 边转边问（product-design §3.2.2 视频卡）：s23 的转录还在跑，Agent 先问了一句就收掉了这一轮。打开会话才开始走，
       走得慢（paceStep），留出回话的时间：回话后这一轮调 jobs_wait 等它，视频卡跟到这一轮；卡上那一行只读地写出用的模型。 */
    {id: 'ag23t', kind: 'transcribe', project: 'p11', title: '转录 · Sintel · 预告片剪辑',
     sub: 'Claude Code · Sonnet · 会话「转录这支预告片」', status: 'running', pct: 40, phase: '识别中',
     source: 'agent', session: 's23', started: '1 分钟前', cancellable: true, drive: 'on-view', paceStep: 0.15,
     jobPhase: 'transcribing', model: 'moss-transcribe', runsOn: '本机', lang: '英语', langCode: 'en', diarize: true,
     mediaSec: 52, elapsedMs: 100800, leftMs: 151200, undoBody: '这一份文稿会被移除，视频回到没有文稿的状态。原片与时间轴不动。'},
    /* 智能体自己翻译（product-design §3.2.2 视频卡；正式应用的 JobKind `agentTranslate`）：s24 的智能体读文稿时声明
       要译成英语（documents_read 的 translateTo），在自己这一轮里逐句翻，译完一次写进视频。没有逐句进度与百分比：
       视频卡头写「翻译中」、那一行是不确定的细条，字幕 Tab 的运行态头与压缩条也是；卡上不给取消，要停就停那条会话。 */
    {id: 'ag24l', kind: 'translate', project: 'p13', title: '翻译 · 口播 · 本机优先（链接导入） · 中 → 英语',
     sub: 'Claude Code · Sonnet · 会话「把这条口播翻成英语字幕」', status: 'running', pct: null, byAgent: true, phase: '智能体逐句翻译',
     source: 'agent', session: 's24', started: '1 分钟前', cancellable: false, target: 'en',
     from: '中文', lang: '英语', model: 'Claude Code · Sonnet', linesTotal: 62, elapsedMs: 48000,
     undoBody: '这一门语言的译文会被移除。原文一个字不动。'},
    /* Agent 会话里放行后跑的活也是**任务**（第 109 轮）：同一条记录，会话里的
       工具行、后台任务页、侧栏迷你条读的都是它；撤销位也在这里，收据与任务页同源。
       source: 'agent' ＋ session 指回那条会话。 */
    {id: 'ag1', kind: 'cleanup', project: 'p1', title: '找可剪的口 · 科浪访谈 第 42 期 · 第 3 章',
     sub: 'Claude Code · Sonnet · 会话「把第 3 章的停顿压到 0.3 秒」', status: 'running', pct: 62, phase: '执行中',
     source: 'agent', session: 's1', started: '4 分钟前', cancellable: true,
     linesDone: 38, linesTotal: 62, callsDone: 5, callsTotal: 8, callsRetried: 1, leftMs: 90000, elapsedMs: 240000},
    {id: 'ag2', kind: 'translate', project: 'p1', title: '重译 4 句 · 科浪访谈 第 42 期 · English',
     sub: 'Claude Code · Sonnet · 会话「统一「渲染 / 光栅化」的译法」', status: 'done', outcome: 'done', pct: 100,
     source: 'agent', session: 's2', started: '18 分钟前', undoable: true, undone: false,
     linesDone: 4, linesTotal: 4, elapsedMs: 42000,
     undoBody: '这 4 句会回到重译前的译文。其余 58 句本来就没动。'},
    {id: 'ag3', kind: 'chapters', project: 'p7', title: '重写章节标题 · Code & Wander Ep. 42',
     sub: 'Claude Code · Opus · 会话「给 4 个章节重新起名」', status: 'done', outcome: 'done', pct: 100,
     source: 'agent', session: 's3', started: '1 小时前', undoable: true, undone: false, elapsedMs: 31000,
     undoBody: '4 个章节标题会还原成原来的。边界与段落不动。'},
    /* 跑完的云端批次：三行请求，两行出图（带估价，美元——价目表只有美元一档），一行被拒。
       缩略图是 `BC_CLOUD_IMAGE.demoArt` 按行号挑的渐变，数据里只存路径。 */
    {id: 'im2', kind: 'image', project: 'p5', title: '生成封面 · 短视频切片 · 第 7 条', stage: 'image',
     sub: 'gpt-image-2 · 云端', status: 'done', outcome: 'done', pct: 100, source: 'app', started: '40 分钟前',
     runsOn: '云端', elapsedMs: 41000,
     images: [
       {line: 1, prompt: '竖版封面：一位年轻人夜里坐在城市天台上弹吉他，霓虹灯倒映在地面的积水里，电影感，冷暖对比，上方三分之一留给标题',
        model: 'cloud:openai/gpt-image-2', modelName: 'gpt-image-2', engine: 'cloud', status: 'done', n: 2, aspect: '9:16',
        paths: ['~/Movies/切片/clip-07.bcut/assets/图片-001-gpt-image-2-1.png', '~/Movies/切片/clip-07.bcut/assets/图片-001-gpt-image-2-2.png'],
        width: 768, height: 1344, cost: {amount: 0.08, currency: 'USD'}, elapsedMs: 18000},
       {line: 2, prompt: '同一个天台，清晨，天空刚泛白，吉他靠在栏杆上，没有人，安静',
        model: 'cloud:openai/gpt-image-2', modelName: 'gpt-image-2', engine: 'cloud', status: 'done', n: 1, aspect: '9:16',
        paths: ['~/Movies/切片/clip-07.bcut/assets/图片-002-gpt-image-2-1.png'],
        width: 768, height: 1344, cost: {amount: 0.04, currency: 'USD'}, elapsedMs: 12000},
       {line: 3, prompt: '天台上的人群挤在一起看烟花，特写人脸，写实摄影',
        model: 'cloud:openai/gpt-image-2', modelName: 'gpt-image-2', engine: 'cloud', status: 'error', n: 1, aspect: '9:16',
        paths: [], elapsedMs: 3000, error: '服务商拒绝了这条提示词（内容策略：可识别的真人面孔）。改写后重新生成。'},
     ]},
  ];

  /* ---------- 编辑器右侧 rail（10 项；第 109 轮 12→11，第 152 轮 11→10） ----------
     第 27 轮曾把 Subtitle 与 Translate 拆成两个独立 Tab（与 apps/baocut rail.rs 的
     `ITEMS: [RailItem; 12]` 收敛）；第 152 轮按产品裁决又并回**一个「字幕」Tab**：
     一门语言 = 一条轨，轨条是唯一的语言选择器；列表看什么由它下面的对照条决定
     （第 153 轮：只看原文 / 原文 ＋ 译文 / 只看译文 ＋ 对照哪一门）。apps/baocut 仍是
     两个 Tab，登记为台账 178 / 182。 */
  const rail = [
    {k: 'transcript', icon: 'transcript', label: '文稿'},
    // 第 152 轮：翻译并入字幕 Tab（双语对照跟着轨条选中的译文轨走），rail 收成 10 项
    {k: 'subtitle',   icon: 'captions',   label: '字幕'},
    /* 2026-10-09：AI 工具回到 rail 第三格（product-design §5.10）。v3 曾决定不设独立 Tab、只从对话斜杠命令与
       面板按钮进工具页——实际用下来不好找；现在它有自己的列表页，Web 表面仍不落（model-surface.js）。 */
    {k: 'aitools',    icon: 'sparkle',    label: 'AI 工具'},
    {k: 'elements',   icon: 'elements',   label: '元素'},
    {k: 'text',       icon: 'text',       label: '文字'},
    {k: 'image',      icon: 'image',      label: '图片'},
    {k: 'video',      icon: 'video',      label: '视频'},
    {k: 'audio',      icon: 'audio',      label: '音频'},
    {k: 'brand',      icon: 'brand',      label: '品牌'},
    /* 第 109 轮：Agent 不再是右侧的一个 Tab——它升到左侧主入口（侧栏「会话」＋
       Agent 页 ＋ 编辑器左抽屉，见 §17.2）。rail 收成 11 项（第 152 轮再收成 10）；
       apps/baocut 仍是 `ITEMS: [RailItem; 12]`，登记为台账 116（原型先行）。 */
    /* 2026-09-15：项目这一格叫「属性」（Project properties），与 App 级「设置」页分开，图标换 project-props。 */
    {k: 'settings',   icon: 'project-props', label: '属性'},
  ];

  /* ---------- 字幕（§13.2 / §16；第 45 轮按组模型重写） ----------

     一条字幕是一个**组**：组持有叠法（谁在上、间距、底板、锚点、偏移），成员是
     两个**派生文本元素**（原文 / 译文）——文本与时间是 transcript `words[]` 的
     投影，成员自己只持有「长什么样」，外加原文成员独有的词级时间戳。
     组模型的纯函数在 model-substyle.js。 */
  /* 动效字幕（Designed Caption）的**配方注册表** —— 第 70 轮整表换成 **emphasis 系列**，
     数据逐字段写定（数据与解释器在 [model-motioncaption.js](model-motioncaption.js)）。
     第 72 轮再补进 8 份，**共 25 份**——那 8 份是插在中段的，不是追加在尾巴上。

     此前这里是原型自己编的 16 份 `caption-*`：一份涂装 ＋ 一个借来的逐词动效枚举 ＋
     一句「图层」文案，舞台上 `caption` 字段没有任何独立渲染——**它不是一条渲染路径，
     是一张标签表**。emphasis 那一族不是：每份自带排版（一次一词还是逐词堆叠、几行、怎么
     断行）、自带逐词规则（哪个词吃哪一档动画、换什么字体什么色）、自带四档时间通道
     （词 / 字形簇 / 行 / 整条），视图在 [subcaption.jsx](subcaption.jsx)。

     **卡片 id 就是配方的 preset id**（`emphasisFifteen` / `template-027-sub`…），中间不设
     翻译层；显示名直接用配方自带的名字，包括三个占位名「Template 003 / 004 / 005」。
     涂装不在这张表里：配方接管整条，画的是
     `BC_VC.byKey(k).paint`（所以卡上没有 `look`）。

     **登记分歧**：核心 `bcut-subtitle-render/caption_recipe.rs` 与 apps/mac 的
     `captions/registry.json` 仍是旧的 16 份——原型先行，App 与核心待跟进。 */
  const designed = window.BC_VC.cards();

  /* 默认轨集按语言对现做（第 73 轮抽成函数：语言包切换要重落一对轨）。
     叠法与涂装的判据见 defaults.tracks 处的注释——译文在上字大（32）、
     源语言在下字小（20），与语言无关；词级那几件（逐词动画 / 强调词 / 当前词色）只长在
     源语言轨上。 */
  function defaultTracks(src, dst) {
    const L = window.BC_VS.LOOKS.prettymarketer;
    const trans = Object.assign({}, L, {
      id: dst.code, lang: dst.code, name: dst.name, role: 'translation',
      size: 32, y: 86, valign: 'bottom'});
    // 词级时间戳只有源语言轨有，所以译文轨不带当前词高亮色（同 stagePreset）
    delete trans.activeColor;
    const srcT = Object.assign({}, L, {
      id: src.code, lang: src.code, name: src.name, role: 'source',
      size: 20, y: 93, valign: 'bottom',
      /* 第 102 轮改正：这里此前写的是 `'color'`——那是**核心枚举**的名字，不是原型
         这份目录里的键（第 66 轮起这一档在目录里叫 `colourHighlight`）。
         对不上的后果是两处都读不出名字：属性页那行印的是生的 `color`，动画页十九格
         一格都不高亮。默认落 `vb-prettymarketer`，它带的就是 Colour Highlight。 */
      wordAnim: 'colourHighlight', caption: null,
      /* 强调词由用户在属性页点选，不自动猜测重点。 */
      highlight: {on: false, marks: {}, color: L.activeColor, font: null,
        bold: true, italic: false, scale: 100}});
    /* 两轴写法（caption-style-model-design §4/§5）：当前词是轨上的一等字段，`wordAnim` 留作
       兼容投影。译文轨没有词级时间戳，不带当前词。 */
    if (window.BC_CS) srcT.activeWord = window.BC_CS.fromAnim('colourHighlight', L.activeColor).activeWord;
    return [trans, srcT];
  }

  const subtitle = {
    /* 分类：与「形态」正交的另一根轴。形态决定这份样式出现在哪个 Tab，
       分类决定它排在画廊的哪一区。 */
    /* 第 2026-10-09 轮起分区来自 `BC_CS.CATEGORIES`（caption-style-model-design §7）：
       基础 / 社交 / 商务 / 复古 / 动效 / 动态排版。下面这份旧表只在模型没装上时兜底。 */
    cats: window.BC_CS ? window.BC_CS.CATEGORIES.slice() : [
      /* 「动效字幕」那一区第 74 轮**下架**（用户裁决：当前还不适合上这个功能）。
         这是隐藏不是删除：25 份配方注册表（`designed`）、presetIR 解释器与 canvas
         渲染路径（model-motioncaption.js / subcaption.jsx / stage 的分流）全部原样留着，
         重启时把这一行放回 cats、目录尾部补回 `.concat(designed)` 即可。 */
      /* 第一区只有一张卡：**新建项目种下的那份涂装本身**（`BC_DS`）。摆在最前面是
         为了让刚建的项目一进样式面板就有一张亮着的卡——选中态按出处戳判，戳的 id
         不在目录里就一张都不亮，此前默认样式既没有对勾、也没有回头路。 */
      {k: 'default',  name: '默认'},
      /* Shorts（2026-09-27）：竖屏发布用的内置预设（`BC_DS`，不进品牌库）。
         套上去除了涂装还会落位：大字、居中、块下沿贴安全框底 72%（`BC_SHORTS.captionLayout`）。 */
      {k: 'shorts',   name: 'Shorts', note: '竖屏发布：逐词大字，落在平台按钮挡不到的地方'},
      /* 倒鸭子（2026-09-17）：跨句动态排版——字幕铺在画面上、镜头跟着念到的词走。它是一份
         **样式**（接管源语言轨整条的排版与镜头，落在轨的 `kinetic` 字段上），所以进画廊而
         不进动画页；叠加 / 纯色底、镜头与排版都是这一张卡属性页里的选项，不拆成多张卡。
         设计稿 docs/design/subtitle/bcut-daoyazi-caption-design.md，模型 model-daoyazi.js。 */
      {k: 'kinetic',  name: '动态排版', note: '字幕铺在画面上，镜头跟着念到的词走'},
      {k: 'social',   name: '社交'},
      {k: 'business', name: '商务'},
      {k: 'retro',    name: '复古'},
    ],

    /* 样例文字。分两处用，规矩不一样，这是有意的：

       **画廊缩略图是样本**（`specimen`），像字体样张——它要在所有项目里长一个样，
       所以固定一对语言。样张按**位次**给，不按角色给：`main` 是那一行（单行样张）
       或上面那一行（双语样张，默认叠法里是译文行），`sub` 是下面那一行。

       第 74 轮起这条「固定」只管**字幕 Tab**。翻译 Tab 的样张跟项目语言对走
       （`{main: dstLang, sub: srcLang}`，取处在 panel-substyle.jsx）——那两区回答的
       是「我这个项目翻出来长什么样」：英文项目双语卡中文在上、英文在下；中文项目
       反过来。字幕 Tab 仍固定英文样张——它比的是样式，不是语言。

       `main` 是**英文**。BaoCut 不是一个中文 App，一屏卡片全是中文会让人以为它只做
       中文字幕；画面上最显眼的那一行就更该是英文。`sub` 给中文：一张双语样张必须
       真的有两门语言才看得出「双语」，而拉丁 ＋ CJK 恰好是双语排版最难的那一组
       （字高、行距、标点宽度全不一样），样张挑难的那组才有意义。顺带，双语样张里
       在动的是下面那行原文（词级时间戳只有它有），于是 CJK 的逐词动画也一并看得见。

       **属性页预览条是你的项目**：它按每条轨自己的语言取，因为那里回答的问题是
       「我这条字幕调成这样好不好看」，不是「这份样式长什么样」。

       给的是整句，切词交给 `BC_WA.split`——样例没有理由预先切好，那样加一门语言
       就要多记一件事。 */
    sampleDefault: 'en',
    specimen: {main: 'en', sub: 'zh'},
    sample: {
      // 样张那句要短：一格 66px 高、不到 200px 宽，还要放得下 0.2em 字距的全大写那一档
      en: {thumb: 'Words are truth', line: 'Hi everyone, I’m Su Li — I work on rendering.'},
      zh: {thumb: '词是真相',            line: '大家好，我是苏黎，负责渲染这一块。'},
      ja: {thumb: '語が真実である',      line: 'こんにちは、蘇黎です。レンダリングを担当しています。'},
    },

    /* look = 一份样式在**导出画面**里长什么样。画廊缩略图不是截图也不是外链
       webm，是拿这份 look 真画一遍——所以点下去画面就是缩略图的样子，
       不会出现「预览好看、套上去不是那回事」。

       第 62 轮起这张表整表换成 **31 份逐字段写定的预设**（换算见
       [model-subpresets.js](model-subpresets.js)）。此前是原型自己编的 12 份，只有色 / 字重 /
       描边 / 阴影 / 底板几个键，字体、行高、字距、大小写、当前词高亮色全是画廊那一层
       现编的——那套东西的毛病不在好不好看，在于**改一个数没有判据**，加一份也没有。

       键就是预设 key（`prettymarketer` / `casper` / `slay`…），值是一份已经
       换算好的涂装，键与轨上的键一一对应：`bg` 是**不透明**底色、透明度走 `opacity`
       （两者分开存，属性页那颗滑杆才有东西可写）；`corners` / `pad` 是**占字号的百分比**
       （第 62 轮从 px 改过来——px 圆角不跟字号缩放，同一份样式在 13px 的缩略图与画布的
       大字上会是两个形状，而画廊那条「点下去画面就是缩略图的样子」要求它们是同一个）；
       `activeColor` 是这份 look 下当前词用什么颜色，它必须由 look 一起给，不能留一个
       全局默认——黄底药丸配黄色当前词等于没有当前词。
       色值是导出画面的渲染色，不是 S2 表面，按文件登记在 `_ds_conformance.json`。 */
    looks: Object.assign({}, window.BC_DS.LOOKS, window.BC_VS.LOOKS, window.BC_SD ? window.BC_SD.LOOKS : {}),

    /* 目录。`form` 是形态：'orig' 只画原文一行（归字幕 Tab）、'bi' 双语两行、
       'trans' 只画译文一行（后两者归翻译 Tab）。

       `look` 恒是**原文行**的 look——`anim` 那份逐词动画长在它身上（词级时间戳只有
       源语言轨有）；`look2` 是译文行的，省略即与原文同款。默认叠法是译文在上、原文
       在下，所以双语缩略图上**第一行画的是 look2**。这两个键跟着角色走而不是跟着
       位次走，是有意的：位次可以被用户上移/下移改掉，角色不会。

       第 62 轮起内置目录**由那 31 份预设派生**，不在这里逐张抄一遍：`BC_VS.cards(form)`
       给三种形态各一份，顺序是定死的（`prettymarketer` 排在第一位是有意摆的，
       别按字母重排——画廊第一屏看见什么由它决定）。

       **只有 `orig` 直接对应预设**：一份预设讲的是「一条字幕长什么样」，没有双语这
       件事。`bi` / `trans` 是 BaoCut 自己的形态（一门语言一条轨，见 model-substyle.js），
       由同一份涂装派生，**双语两行同款**——给译文行另配一款是在预设之外替用户做一个没有依据的决定。 */
    /* 动效字幕的 25 份配方卡（`BC_VC.cards()`，`form: 'orig'`，`caption` 指配方 id）
       第 74 轮起**不进目录**——那一区下架了（见 cats 处的注释）。渲染路径、属性页的
       「来自样式」行与 `stagePreset` 清 `caption` 的写法都保留：它们对着 `designed`
       注册表工作，不依赖目录里有没有那几张卡。 */
    /* 每张卡经 `BC_CS.annotate` 补上新分区与两轴（`activeWord` / `motion`）；`anim` 仍在，作兼容投影。 */
    catalog: ((list) => window.BC_CS ? list.map(window.BC_CS.annotate) : list)(window.BC_DS.cards('orig').concat(window.BC_VS.cards('orig'),
      /* 倒鸭子那一张：`kinetic: true` 是它的记号，`stagePreset` 见到就在源语言轨上种
         `BC_DZ.defaults(kineticDemo)`；套别的卡时清掉。`look` 只给译文行与「换回普通字幕」
         用——源语言轨的排版与颜色由 `kinetic` 自己的配色决定，canvas 不读涂装。 */
      [{id: 'daoyazi', name: '倒鸭子', cat: 'kinetic', form: 'orig', look: 'casper', anim: 'none', kinetic: true}],
      window.BC_DS.cards('bi'), window.BC_VS.cards('bi'),
      window.BC_DS.cards('trans'), window.BC_VS.cards('trans'),
      window.BC_SD ? window.BC_SD.cards('orig').concat(window.BC_SD.cards('bi'), window.BC_SD.cards('trans')) : [])),

    /* 倒鸭子的演示实例记录：几个主角词，让画廊套上去第一眼就看得见「独占一块、字号 1.5 倍」。
       下标按 `BC_WA.split` 的演示切词（g2 = 「朋友。」，g5 = 「问题」，g6 = 「上传」）。 */
    kineticDemo: {heroes: {g2: [9], g5: [4], g6: [4]}},

    /* 大小写四档（一颗 `Aa` 循环钮）。存的是**要做什么变换**而不是一个布尔——
       「全大写」与「首字母大写」是两件事，一个布尔装不下第二件。 */
    cases: [
      {k: '', name: '原样', demo: 'Aa'},
      {k: 'upper', name: '全大写', demo: 'AB'},
      {k: 'title', name: '首字母大写', demo: 'Ab'},
      {k: 'lower', name: '全小写', demo: 'ab'},
    ],

    /* 背景怎么包住这一条字幕（属性页背景一段里那排形状钮）。每一格画的就是它
       落在画面上的样子（见 `.plate__f--*`）——看得出来比读三个词快。
       圆角不做成一档预设，留成滑杆：目录里的样式
       用到 2 / 3 / 6 / 10 / 12 / 50 六个半径，一个「圆/方」的开关装不下。 */
    plates: [
      {k: 'line',  name: '逐行',  note: '每一行各自贴一块，宽度跟着那一行走'},
      {k: 'block', name: '整块',  note: '整条一块矩形，按最宽那一行'},
    ],

    /* 逐词动画目录。`core` = 核心 `bcut-subtitle-render::word_animation` 今天
       就认的名字（None / Color / Highlight / Reveal / Bounce / Paint / Custom），
       空心的是建议扩展项——与文字面板的动画目录同一套实心/空心记号。

       **一格一种，看得出差别才配有一格**（第 52 轮的判据，有测试钉住 `demo` 不重复）。
       上一版有 18 条，其中「旋转翻页 / 旋转高亮 / 跺脚」与「翻页钟 / 方块高亮 / 冲击」
       共用同一帧——格子里长得一模一样，用户没法凭画面选，只能凭名字猜。三条一起砍掉，
       剩 15 条。**要把它们加回来，得先让它们
       在格子里看得出不一样**，不是先加进目录再说。

       `demo` 是缩略格里那一帧**签名帧**画什么：静帧只承诺「认得出是哪一种」，
       真效果在上面的预览条上放。 */
    /* 逐词动效目录 = **17 条预设动效 ＋ 核心认的两条**，由 [model-subanim.js](model-subanim.js)
       派生（顺序就是选择器的陈列顺序）。这里不再抄一份名字与帧：`k` 直接就是样式里
       `animation` 存的枚举键，所以两者之间**没有翻译层**，也就没有
       「按名字对错了」的余地。`core` = 核心 `word_animation` 今天认不认这个名字。 */
    anims: window.BC_SA.ANIMS.map((a) => ({k: a.k, name: a.name, core: !!a.core, demo: a.k})),

    designed,

    /* 默认色板：7 个中性色 + 3×8 彩色；首格留给无色，固定内容色不跟随主题。 */
    swatches: [
      /* @ds-allow: 视频内容预设色，不属于主题 UI 色 */
      '#000000', '#5d647b', '#9094a5', '#bfc1ce', '#dfe0e5', '#eeeef0', '#ffffff',
      /* @ds-allow: 视频内容预设色，不属于主题 UI 色 */
      '#ff4f4a', '#ff7434', '#ffe069', '#4ea552', '#2d8eff', '#5456ff', '#8253f9', '#ff69b1',
      /* @ds-allow: 视频内容预设色，不属于主题 UI 色 */
      '#ffa7a4', '#ffba9a', '#fff0b4', '#a6d2a8', '#96c6ff', '#a9aaff', '#c1a9fc', '#ffb4d8',
      /* @ds-allow: 视频内容预设色，不属于主题 UI 色 */
      '#ffcac9', '#ffd5c2', '#fff6d2', '#cae4cb', '#c0ddff', '#ccccff', '#d9cbfd', '#ffd2e8',
    ],

    /* 默认样式文档 = **若干条彼此独立的轨**（第 47 轮去掉了「组」）。

       一门语言 = 一条字幕轨。演示项目已经转录并翻译过，所以默认落着两条：
       源语言（中文，词级时间戳的宿主）与译文（English）。再翻一门就是第三条。
       轨落到 timeline 上就固定在那里——语言下拉切的是「编辑哪一条」，不是
       「timeline 上有哪几条」。

       **每条轨自带 `y` ＋ `valign`**（第 49 轮改成与核心同一套）：`y` 是锚线的**帧高
       百分比 0–100**（核心默认 86），`valign` 是这一块的哪条边钉在锚线上（`top` /
       `center` / `bottom`，核心的严格白名单）。画面上谁在上谁在下由这一对说了算，不是
       数组顺序（数组顺序只管 timeline 的行序与新轨插在哪儿）。

       `wordAnim` 与 `caption` 是**两个字段**，与核心一致（`document.rs::word_animation` 读
       `wordAnimation.name`，`designed_caption` 读 `wordAnimation.caption.style.id`；后者一旦
       有值，前者报的名字就变成 `Designed`）。**动效字幕接管整条**：它不是逐词动效的一档，
       是一整套排版 ＋ 图层 ＋ 时间通道的配方，落下去连涂装一起换。
       轨里 `wordAnim` / `caption` / `activeColor` / `highlight` 只长在源语言轨上——词级
       时间戳只有它有。**没有「跟随源语言」**（第 49 轮去掉）：双语套装的配对由样式目录
       里的 `look2` 给，不需要一条运行时的连线。 */
    trackDefaults: {
      font: '思源黑体 Source Han Sans', size: 32, color: 'var(--gray-25)',
      bold: false, italic: false, align: 'center',
      bg: '#000000', corners: 10, opacity: 45,
      outline: false, outlineColor: 'var(--gray-1000)', outlineW: 8,
      shadow: true, shDist: 12, shBlur: 24, shAngle: 90, shColor: 'rgba(0,0,0,0.85)',
      spacing: 0, upper: '', mono: false, lh: 130, plate: 'line',
      y: 86, valign: 'bottom',               // 新落的译文轨摆在原文行上方那一档（核心默认 y）
    },
    defaults: {
      /* 默认落目录里的第一份 `prettymarketer`。
         它带 `colourHighlight`，所以画布一开就能看见逐词动效——`casper`
         不带动效，拿它做默认会让画布上少演一件事。 */
      preset: 'vb-prettymarketer',
      /* **默认译文在上、原文在下**（第 46 轮）：观众读的是译文，所以译文是主行——
         在上、字更大（32）；原文是参照行——在下、字更小（20 = 32 ÷ 1.6，正是
         §16.1 的比例链），逐词动画留在原文行上。上下由各自的锚线 `y` 拉开：原文的
         下沿钉在 93%，译文的下沿钉在 86%，于是译文正好落在原文上面。

         涂装不在这里逐键写一遍——它就是画廊那一份（第 62 轮）。此前这里手抄了一份
         「思源黑体 + 55% 黑底板」，与目录里任何一张卡都对不上，于是首屏画的东西不在
         画廊里；`Object.assign` 之后默认态就是 `vb-prettymarketer` 那张卡本身。
         身份（id / lang / name / role）、几何（字号 / 锚线）与源语言轨独有的那几件
         （词级动画 / 强调词）留在这里——它们不属于涂装。 */
      tracks: defaultTracks(LANG.zh, LANG.en),
    },
  };

  /* 统一字体选择框（§13.5 / 第 20.1 轮、第 80 轮改成三段）：五个挂点共用一份。
     菜单是「导入字体 ＋ Brand kits / Popular / All」三段——Brand kits 读的是
     `brand.fonts`（这里不再另存一份），`popular` 只是**指向 `all` 里的名字**，
     样张写法（`st`）因此只有一份。 */
  const fonts = {
    /* 常用的那几款。名字必须在 `all` 里能找到（有单测钉住），顺序就是陈列顺序：
       项目自己在用的两款打头，其后是字幕样式目录里最常被套用的几款。 */
    popular: ['思源黑体 Source Han Sans', 'Source Sans 3', 'Poppins', 'Montserrat',
      'Inter', 'Anton', 'Playfair Display', 'Noto Sans SC'],
    /* 目录全量。字幕样式目录用到的族排在前面（第 62 轮）——属性页的字体框此前
       指着一个它自己列表里没有的名字，搜也搜不到。`st` 是这一行样张自己的写法；
       这里的顺序是**出处顺序**，菜单里的 All 段按名字自然序重排（`BC_FONT.catalog`）。 */
    all: [
      // 默认字幕样式那一份（种子的 `fontFamily: "system"`，内核按平台兜底）
      {n: 'System', st: 'font-family:system-ui'},
      {n: 'Poppins', st: "font-family:'Poppins',sans-serif;font-weight:600"},
      {n: 'Montserrat', st: "font-family:'Montserrat',sans-serif;font-weight:600"},
      {n: 'Anton', st: "font-family:'Anton',sans-serif"},
      {n: 'Bangers', st: "font-family:'Bangers',cursive"},
      {n: 'Squada One', st: "font-family:'Squada One',sans-serif"},
      {n: 'Shrikhand', st: "font-family:'Shrikhand',cursive"},
      {n: 'Rubik', st: "font-family:'Rubik',sans-serif;font-weight:900"},
      /* 动效字幕那 25 份用到的族（见 model-motioncaption.js 的 `fontFamilies()`）。
         这一族的族名是干净的（字重不编在名字里），所以样张只写 family ＋ 用得上的字重。 */
      {n: 'Epilogue', st: "font-family:'Epilogue',sans-serif;font-weight:700"},
      {n: 'Archivo Black', st: "font-family:'Archivo Black',sans-serif"},
      {n: 'Bricolage Grotesque', st: "font-family:'Bricolage Grotesque',sans-serif;font-weight:500"},
      {n: 'Special Gothic Expanded One', st: "font-family:'Special Gothic Expanded One',sans-serif"},
      {n: 'IBM Plex Mono', st: "font-family:'IBM Plex Mono',monospace;font-weight:500"},
      {n: 'Libre Caslon Text', st: "font-family:'Libre Caslon Text',serif"},
      {n: 'Playfair Display', st: "font-family:'Playfair Display',serif;font-weight:900"},
      {n: 'Pinyon Script', st: "font-family:'Pinyon Script',cursive"},
      {n: 'Indie Flower', st: "font-family:'Indie Flower',cursive"},
      {n: 'Ballet', st: "font-family:'Ballet',cursive"},
      {n: 'Jacquard 24', st: "font-family:'Jacquard 24',system-ui"},
      {n: 'Lacquer', st: "font-family:'Lacquer',system-ui"},
      /* 第 72 轮：preset-seven 那 8 份带进来的 7 个族 */
      {n: 'Instrument Serif', st: "font-family:'Instrument Serif',serif"},
      {n: 'Gloock', st: "font-family:'Gloock',serif"},
      {n: 'Unna', st: "font-family:'Unna',serif;font-weight:700"},
      {n: 'Gloria Hallelujah', st: "font-family:'Gloria Hallelujah',cursive"},
      {n: 'Just Me Again Down Here', st: "font-family:'Just Me Again Down Here',cursive"},
      {n: 'Rubik Spray Paint', st: "font-family:'Rubik Spray Paint',system-ui"},
      {n: 'BBH Bartle', st: "font-family:'BBH Bartle',sans-serif"},
      {n: '思源黑体 Source Han Sans', st: 'font-weight:500'},
      {n: '思源宋体 Source Han Serif', st: 'font-family:var(--sans);font-weight:600'},
      {n: '站酷快乐体', st: 'font-weight:800'},
      {n: 'Inter', st: "font-family:'Inter',sans-serif;font-weight:500"},
      {n: 'Source Sans 3', st: 'font-weight:400'},
      {n: 'Source Serif 4', st: 'font-weight:600'},
      {n: 'Source Code Pro', st: 'font-family:var(--mono)'},
      {n: 'Noto Sans SC', st: 'font-weight:500'},
    ],
  };

  /* ---------- 翻译面板（§13.2 / 第 9.1、24 轮） ----------
     四种块语义演示卡，逐条对应 research/alignment-block-display-notes.md：
       block      正常成对 + 双侧块刻度（1↔1、单调、不交叉）
       many       多对一：一行译文跨 2 条原文字幕，原文侧渲染成子行（不是对齐错误）
       deficit    行数亏空：一行译文覆盖 3 条原文、停留 6.4s，超出舒适阅读时长 → 可按源行重对齐
       sentence   整句对应：语序交叉不拆分，原文逐词高亮、译文整句显示 */
  /* 翻译面板里带方向性的两份演示数据的**英文源**版本（第 73 轮）。
     场景与中文版一一对应（块对齐 / 已改写 / 过期 / 未翻 / 多对一 / 译文亏欠 /
     语序交叉），只是方向反过来：原文英文、译文中文；「翻译中」样片是 EN → 日本語。
     ob/tb 仍是两侧块刻度的段宽（字符数），段数两侧恒相同。 */
  const translateLiveEn = [
    {sp: 's1', time: '00:00.0', o: 'Welcome back to Code & Wander. I’m Lin Che.',
     t: '『コードと遠方』へようこそ、林澈です。', ob: [30, 13], tb: [12, 7]},
    {sp: 's2', time: '00:04.2', o: 'This episode is about local-first video tools.',
     t: '今回はローカルファーストの動画ツールについて話します。', ob: [12, 34], tb: [3, 24]},
    {sp: 's1', time: '00:09.6', o: 'First, why render locally at all?',
     t: 'まず、なぜレンダリングをローカルで行うのか。', ob: [6, 27], tb: [3, 19]},
    {sp: 's3', time: '00:14.8', o: 'Because the footage isn’t ours. Uploading is itself a decision.',
     t: '素材が他人のものだからです。アップロードすること自体が一つの決定です。', ob: [31, 33], tb: [14, 20]},
    {sp: 's2', time: '00:21.3', o: 'Words are the truth; sentences and cues are projections.',
     t: '語が真実であり、文も cue も投影にすぎません。', ob: [20, 36], tb: [8, 15]},
    {sp: 's1', time: '00:26.1', o: 'That way editing the source never scrambles the timeline.',
     t: 'そうすれば原文を直しても時間軸は崩れません。', ob: [8, 49], tb: [10, 12]},
    {sp: 's3', time: '00:31.7', o: 'Finally export — we only re-render what the change touched.',
     t: '最後は書き出し、変更が及んだ範囲だけを再レンダリングします。', ob: [14, 45], tb: [7, 22]},
    {sp: 's2', time: '00:38.0', o: 'That’s all for today — thanks to you both.',
     t: '今日はここまで、お二人ともありがとうございました。', ob: [20, 22], tb: [8, 17]},
  ];
  const translateCardsEn = [
    {id: 'x1', duration: 6.5, kind: 'block', sp: 's1', time: '00:12.1', cps: 9,
     blocks: [
       {o: 'Once aligned,', t: '对齐之后，', ow: 13, tw: 5},
       {o: 'subtitles,', t: '字幕、', ow: 10, tw: 3},
       {o: 'translations and animations', t: '翻译和动画', ow: 27, tw: 5,
        units: [{o: 'translations', t: '翻译'}, {o: 'and animations', t: '和动画'}]},
     ]},
    {id: 'x2', duration: 1.8, kind: 'plain', sp: 's2', time: '00:18.6', cps: 12,
     orig: 'Because the footage isn’t ours.',
     trans: '因为素材是别人的。',
     units: [{o: 'Because', t: '因为'}, {o: 'the footage isn’t ours.', t: '素材是别人的。'}],
     rewritten: '因为素材属于别人，我们从来没有权利将它转送出去。'},
    // 与 x2 同说话人的相邻一句（第 155 轮）：接缝上那枚「并入上一句」要有地方出现
    {id: 'x2b', duration: 1.0, kind: 'plain', sp: 's2', time: '00:20.4', cps: 11,
     orig: 'Uploading is itself a decision.',
     trans: '上传这件事本身就是一个决定。',
     units: [{o: 'Uploading', t: '上传这件事'}, {o: 'is itself a decision.', t: '本身就是一个决定。'}]},
    {id: 'x3', duration: 1.6, kind: 'plain', sp: 's3', time: '00:21.4', cps: 7, stale: true,
     orig: 'And the models run fine now — a lot changed this year.',
     trans: '而且模型已经跑得动了，这一年变化很大。',
     units: [{o: 'And the models run fine now —', t: '而且模型已经跑得动了，'}, {o: 'a lot changed this year.', t: '这一年变化很大。'}]},
    {id: 'x4', duration: 1.0, kind: 'plain', sp: 's2', time: '00:23.0', cps: 0, untranslated: true,
     orig: 'Right, so we moved the whole pipeline onto the machine.', trans: ''},
    {id: 'x5', duration: 3.4, kind: 'many', sp: 's3', time: '00:24.0', cps: 10,
     subs: ['Hold on —', 'let’s see how the export looks first.'],
     trans: '等一下，我们先看看导出的效果。',
     note: '几条短原文共享一条紧凑译文是多对一的默认形态——原文侧按字幕分成子行，不是对齐错了。'},
    {id: 'x6', duration: 6.4, kind: 'deficit', sp: 's3', time: '00:31.2', cps: 4, dwell: 6.4,
     subs: ['Organize the footage first,', 'then check the subtitle rhythm,', 'and review the export last.'],
     trans: '先整理素材，再对节奏，最后查导出。',
     note: '这一条译文停留 6.4s、覆盖 3 条原文字幕，超过了舒适阅读时长——可按源行重新对齐。'},
    {id: 'x7', duration: 3.8, kind: 'sentence', sp: 's1', time: '00:27.4', cps: 8,
     words: ['We', 're-recorded this part', 'because the wording changed.'], cur: 1,
     trans: '因为前面改了口径，所以这一段重录了。',
     note: '这不是对齐错误——该句语序交叉不拆分：原文逐词高亮、译文整句显示。'},
  ];

  const translate = {
    stats: {cues: 62, sentences: 42, untranslated: 1, deficits: 1, stale: 3},
    /* 翻译中演示（第 35 轮）：中 → 日本語，一句句填进来。
       `ob` / `tb` 是两侧块刻度的段宽（= 字符数），对齐那一段才长出来；
       块恒 1↔1、单调不交叉，所以两条刻度段数相同。 */
    liveTotals: {lines: 42, calls: 120},
    live: [
      {sp: 's1', time: '00:00.0', o: '欢迎回到《码与远方》，我是林澈。',
       t: '『コードと遠方』へようこそ、林澈です。', ob: [8, 8], tb: [12, 7]},
      {sp: 's2', time: '00:04.2', o: '这一期我们聊本地优先的视频工具。',
       t: '今回はローカルファーストの動画ツールについて話します。', ob: [4, 11], tb: [3, 24]},
      {sp: 's1', time: '00:09.6', o: '先说为什么要把渲染放在本机。',
       t: 'まず、なぜレンダリングをローカルで行うのか。', ob: [3, 10], tb: [3, 19]},
      {sp: 's3', time: '00:14.8', o: '因为素材是别人的。上传这件事本身就是一个决定。',
       t: '素材が他人のものだからです。アップロードすること自体が一つの決定です。', ob: [9, 13], tb: [14, 20]},
      {sp: 's2', time: '00:21.3', o: '词是真相，句子和 cue 都是投影。',
       t: '語が真実であり、文も cue も投影にすぎません。', ob: [5, 10], tb: [8, 15]},
      {sp: 's1', time: '00:26.1', o: '这样翻译改了原文也不会把时间轴打乱。',
       t: 'そうすれば原文を直しても時間軸は崩れません。', ob: [7, 11], tb: [10, 12]},
      {sp: 's3', time: '00:31.7', o: '最后是导出，我们只重渲染改动波及的片段。',
       t: '最後は書き出し、変更が及んだ範囲だけを再レンダリングします。', ob: [5, 15], tb: [7, 22]},
      {sp: 's2', time: '00:38.0', o: '今天先聊到这里，谢谢两位。',
       t: '今日はここまで、お二人ともありがとうございました。', ob: [7, 6], tb: [8, 17]},
    ],
    cards: [
      {id: 'x1', duration: 6.5, kind: 'block', sp: 's1', time: '00:12.1', cps: 9,
       blocks: [
         {o: '对齐之后，', t: 'Once aligned,', ow: 5, tw: 13},
         {o: '字幕、', t: 'subtitles,', ow: 3, tw: 10},
         {o: '翻译和动画', t: 'translations and animations', ow: 5, tw: 27,
          units: [{o: '翻译', t: 'translations'}, {o: '和动画', t: 'and animations'}]},
       ]},
      {id: 'x2', duration: 1.8, kind: 'plain', sp: 's2', time: '00:18.6', cps: 12,
       orig: '因为素材是别人的。',
       trans: 'Because the footage isn’t ours.',
       units: [{o: '因为', t: 'Because'}, {o: '素材是别人的。', t: 'the footage isn’t ours.'}],
       rewritten: 'Because the footage belongs to someone else — it was never ours to give away.'},
      // 与 x2 同说话人的相邻一句（第 155 轮）：接缝上那枚「并入上一句」要有地方出现
      {id: 'x2b', duration: 1.0, kind: 'plain', sp: 's2', time: '00:20.4', cps: 11,
       orig: '上传这件事本身就是一个决定。',
       trans: 'Uploading is itself a decision.',
       units: [{o: '上传这件事', t: 'Uploading'}, {o: '本身就是一个决定。', t: 'is itself a decision.'}]},
      {id: 'x3', duration: 1.6, kind: 'plain', sp: 's3', time: '00:21.4', cps: 7, stale: true,
       orig: '而且模型已经跑得动了，这一年变化很大。',
       trans: 'And the models run fine now — a lot changed this year.',
       units: [{o: '而且模型已经跑得动了，', t: 'And the models run fine now —'}, {o: '这一年变化很大。', t: 'a lot changed this year.'}]},
      {id: 'x4', duration: 1.0, kind: 'plain', sp: 's2', time: '00:23.0', cps: 0, untranslated: true,
       orig: '所以我们把整条链路搬到了本机。', trans: ''},
      {id: 'x5', duration: 3.4, kind: 'many', sp: 's3', time: '00:24.0', cps: 10,
       subs: ['等一下，', '我们先看看导出的效果。'],
       trans: 'Hold on—let’s see how the export looks first.',
       note: '几条短原文共享一条紧凑译文是多对一的默认形态——原文侧按字幕分成子行，不是对齐错了。'},
      {id: 'x6', duration: 6.4, kind: 'deficit', sp: 's3', time: '00:31.2', cps: 4, dwell: 6.4,
       subs: ['先把素材整理好，', '再确认字幕节奏，', '最后检查导出效果。'],
       trans: 'Organize, align, then review.',
       note: '这一条译文停留 6.4s、覆盖 3 条原文字幕，超过了舒适阅读时长——可按源行重新对齐。'},
      {id: 'x7', duration: 3.8, kind: 'sentence', sp: 's1', time: '00:27.4', cps: 8,
       words: ['因为', '前面改了口径，', '所以这一段重录了。'], cur: 1,
       trans: 'We re-recorded this part because the wording changed.',
       note: '这不是对齐错误——该句语序交叉不拆分：原文逐词高亮、译文整句显示。'},
    ],
  };
  // 中文源版本的正身在上面的 translate 里；语言包切换时要换回来，先留个把手
  const translateLiveZh = translate.live;
  const translateCardsZh = translate.cards;

  /* ---------- 画布样式袋（§14.2） ----------
     画布上那几个演示元素的当前样式。它挂在编辑器上（`ctx.elStyle`）而不是舞台里，
     因为同一项属性有两个入口——画布浮动工具条与右侧属性页——两边各存一份必然漂
     （第 33 轮的 cue 表、第 34 轮的字幕样式文档都是为这件事收敛的）。
     两边的键名对照在 `model-elements.js` 的 `SHARED` 表里。 */
  const canvasStyle = {
    // 文字
    font: '思源黑体 Source Han Sans', size: 44, color: '#FFFFFF',
    bold: true, italic: false, align: 'center', lineHeight: 1.2, letterSpacing: 0,
    width: 420, scale: 1, rot: 0,
    // 形状
    fill: 'var(--green-900)', stroke: 'var(--red-900)', borderW: 0,
    // 形状（第 39 轮：格序与配色取 BC_EL 那份 24 格目录）
    shapeI: 1, borderOn: false,
    /* 贴纸的换色第 122 轮起是**逐元素**的 `elDocs[id].fillList`（素材里有几个填充色
       分组就几张卡），不进这份共用袋——两张不同素材的第 2 组根本不是同一个色。
       第 39.1 轮那个整体「着色」（`tint`）同轮退场：矢量贴纸只有逐组的填充色卡，
       位图贴纸一个颜色控件都没有，没有它的位置。 */
    // 声波 / 进度（样式 id 取 BC_EL 的真目录，不再是手编的展示名）
    waveStyle: window.BC_EL.WAVES[0].k, waveColor: 'var(--blue-800)', waveColor2: 'var(--gray-25)',
    // dB 窗与平滑（声波建条时的默认值：最低 / 最高分贝与平滑度）：
    // 属性页「控制」那三行与条子上「音量档位」飞出读写的是这同一份。
    waveMinDb: -80, waveMaxDb: 40, waveSmooth: 80,
    progStyle: window.BC_EL.PROGRESS[0].k, progColor: 'var(--blue-900)', progTrack: 'var(--gray-300)',
    /* 计时（第 88 轮）。**默认钟面是「秒」**——纯数字 10 / 9 / 8，与设计稿 §3 的
       `format` 缺省值一致：默认时长就是 10 秒，用 `00:10` 这种钟面写一个个位数的倒数，
       多出来的那两位零永远是零。分秒与时分秒留给长计时。
       字符样式与文字元素同一批，只是键名错开（见 `BC_EL.SHARED.counter`）。 */
    cntMode: 'countdown', cntFmt: 's',
    /* 白板手绘：演示那一条的手绘参数——示范 `flow` 自带三拍带词锚点与标签的节拍；这一条是
       「过了 `bcut whiteboard sync` 的样子」：画时写成末句结束（9.2 s）、节奏 natural（2026-09-17，
       docs/design/video/bcut-whiteboard-narration-sync-design.md §6.1）。目录里新加的一条仍是缺省（画时跟时长走、stretch）。 */
    whiteboard: Object.assign((window.BC_WHITEBOARD || (typeof require === 'function' ? require('./model-whiteboard.js') && window.BC_WHITEBOARD : null)).defaults('flow'),
      {draw: 9.2, pace: 'natural'}),
    /* 对齐默认**居中**（第 89.1 轮，用户裁决）：读数是逐秒换字的一小串，
       容器拉宽之后留白落在两侧才不会看着像贴在边上飘。 */
    cntFont: 'Inter', cntSize: 96, cntColor: 'var(--gray-25)', cntBold: true, cntItalic: false,
    cntAlign: 'center',
    // 取景框
    chrome: 'var(--gray-25)', frameStyle: '摄像机取景',
    // 图片 / 视频 / 动态贴纸共用的画面默认值
    opacity: 100, radius: 12, ovlOpacity: 55,
    // 视频：B-roll 默认静音，不变速，不淡入淡出
    vol: 0, rate: 1, fadeOn: false, fadeIn: 1, fadeOut: 1,
    // 滤镜与效果（第 84 轮，属性页的滤镜一栏）
    filter: 'none', effect: 'none', effectI: 1,
    // 字幕
    target: 'both', wordAnim: 'Karaoke 高亮',
  };

  /* ---------- Elements 目录与属性规格（§14；第 12/13 轮立骨架，第 39/60 轮重整） ----------
     All 视图分区带「查看全部」；可视化 = 进度 14 种 ＋ 声波 10 款（第 232 轮自有配方）＋ 计时 2 款（第 88 轮）。

     目录本身第 60 轮起住在 `model-stickers.js` 与 `model-elements.js`：形状/声波/进度
     来自核心 preset。这里只留**分区版式**与**属性页规格**。 */
  /* 第 122 轮起，**浏览结构整表搬到 `model-elpanel.js`**（`BC_ELPANEL`）：顶层 chip
     `TABS`（恰好四格）、目录页分节 `SECTIONS`、可视化二级 chip `VIZ_CATS`（恰好三格）。
     次序与 chip 表是**算得出来的东西**，有单测逐条钉住，所以跟着判据与 `node --test`
     一起住在那一层；这里只留
     属性页规格。（挂在模板后面的四格取景框 / 覆盖层 `frameItems` 2026-09-14 退出目录；
     文档里已有的 `vframe` / `overlay` 元素照常渲染与编辑，属性页规格仍在下表。） */

  /* Elements → 模板一节的行（第 112 轮；2026-09-14 十款）：内置都是真入口，品牌库里的另加在后面 */
  const templateItems = window.BC_TPL.BUILTINS.map((t) => ({id: t.id, name: t.name, sub: window.BC_TPL.summary(t), real: true, add: 'tpl'}));

  /* ---------- 属性页规格（§14.2；第 39 轮改成三段） ----------
     属性页不做成一条长滚动，切成三个子 Tab：**属性 / 样式 / 动画**——属性是
     §6.2 那组所有元素都有的时间轴条目字段（位置/尺寸/旋转/翻转/层级/时间/不透明度），
     样式是按类型才有的那部分，动画是 In/Out/Loop 三档。切开的理由是这三段的改动频率
     完全不同，混在一条滚动里每次都要滑过不相干的段。 */
  const elementSpecs = {
    wave:     {title: '声波', del: '删除声波', catalog: 'wave', speaker: true,
               sliders: [{k: 'mindb', label: 'Min dB', min: -120, max: 0, v: -80},
                         {k: 'maxdb', label: 'Max dB', min: -40, max: 60, v: 40},
                         {k: 'smooth', label: '平滑', min: 0, max: 100, v: 80}],
               hint: '未选中说话人发言时隐藏声波。样式表里示波器与环形波没有 dB 控件、双色款出两张色卡——控件跟着样式走。'},
    progress: {title: '进度条', del: '删除进度条', catalog: 'progress', range: true,
               hint: '进度由元素自己的开始/结束与播放头推导，没有独立进度参数；反向区间 = 倒计条。'},
    /* 计时（第 88 轮，`docs/design/elements/bcut-counter-element-design.md`）。段序照文字元素的读法：
       **内容在前、外观在后**——`counter` 段（模式 ＋ 钟面 ＋ 读数预览）先出，颜色与字号
       跟在后面，时长段就是计时总长（设计稿 §5：Timing 的 Duration 即计时总长，不另加
       控件）。与进度那条 `range`（反向区间 = 倒计条）不是一件事：那是**进度条形态**的
       倒计视觉，这里是**数字读数**。 */
    counter:  {title: '计时', del: '删除计时', counter: true, textStyle: true,
               hint: '计时是文字元素的派生内容，不是新类型：上面那一行字体 / 字号 / 颜色与 Text 面板是同一批控件，样式预设与动画也走文字那一套，这一页只多出「内容怎么派生」。带了计时就不再有可编辑的文字——内容只有一个真相。'},
    /* `fills` = 颜色一段由**素材本身**决定（第 122 轮）：
       素材里有几个填充色分组就出几张色卡、最多 5 张，逐张改；位图 / 动图与超过
       15 种色的插画一张都不出。所以这一条没有写死的 `colors`。 */
    /* 彩纸（第 231 轮）：算法粒子元素，专属属性页 panel-element-confetti.jsx（六段），
       不走这张表里的 colors / sliders 通用段。 */
    confetti: {title: '彩纸', del: '删除彩纸', confetti: true,
               hint: '十款配方都是算法逐帧生成：时长任意、参数可调、同一种子同一画面。'},
    /* 白板手绘：专属属性页 panel-element-whiteboard.jsx（示范 / 手 / 纸 / 画时 / 节拍）。 */
    whiteboard: {title: '白板手绘', del: '删除白板手绘', whiteboard: true,
               hint: '一张图按笔顺逐段揭示，手跟着笔尖走；画时不超过条子时长，画完定格。'},
    sticker:  {title: '贴纸', del: '删除贴纸', fills: true,
               hint: '第三方 SVG 贴纸有 1–5 个可编辑色组，Noto Lottie 动态贴纸最多 8 个。改一张色卡只换那一组，其余原样。导入的位图与 GIF 没有可换的填充色。'},
    /* `w` = 这一色还带一档粗细，画在同一张卡里（描边的粗细跟颜色同在一张卡上，
       不单独成段）。 */
    shape:    {title: '形状', del: '删除形状', shape: true,
               colors: [{k: 'fill', label: '填充', v: '#FF4C45'},
                        {k: 'outline', label: '描边', v: '#E43A33', w: 'outlineW'}],
               sliders: [{k: 'outlineW', label: '粗细', min: 0, max: 20, v: 3},
                         {k: 'corner', label: '圆角', min: 0, max: 50, v: 0, unit: '%'}],
               hint: '四角可以各自不同（cornerRadius 是四元组）；这里的一档滑杆写的是四角一致的那种。'},
    /* 视频第 84 轮起有**自己的属性页**（`app/panel-video.jsx`），
       不再借元素属性页那三根滑杆——那一页画不出变速档位、音频淡入淡出、
       四角圆角与滤镜。所以这里不再有 `video` 这一条：选中视频落在素材栏的编辑视频页，
       与图片第 58.2 轮同一条规矩。 */
    overlay:  {title: '覆盖层', del: '删除覆盖层',
               style: {label: '素材', value: '雪花'},
               endBehavior: ['循环', '停在末帧', '播一次'],
               hint: '素材比元素时长短时的补齐方式 · 默认循环'},
    vframe:   {title: '取景框', del: '删除取景框',
               style: {label: '样式', value: '摄像机取景'},
               colors: [{k: 'chrome', label: 'Chrome', v: '#FFFFFF'}],
               hint: '边框不随画面缩放裁切（前景 chrome）'},
    tpl:      {title: '模板', del: '移除模板', template: true},
  };

  /* ---------- Text 预设库与文字动画目录（§13.5；第 59 轮整表换掉） ----------
     此前这里手写着 20 条示意预设与三张编出来的动画目录，那是第 17 轮照截图猜的。
     第 59 轮换掉了：51 条预设与 In 19 / Out 16 / Loop 9 三张目录都在
     `model-textpresets.js`，生成自核心的 `core/presets/builtin/textpreset/*.json`
     （权威副本在核心）。这里只留一个转口——目录不是演示数据，
     它是产品词表，不该住在 `data.js`。 */
  const textCats = window.BC_TP.CATS;
  const textPresets = window.BC_TP.PRESETS;
  const textAnims = window.BC_TP.ANIMS;

  // Abc 样式预设（Styles 子页 3×3）
  const textStylePresets = [
    {id: 'a1', name: '纯净', style: {color: '#FFFFFF'}},
    {id: 'a2', name: '清晰描边', style: {color: '#FFFFFF', ol: {color: '#131313', w: 2}}},
    {id: 'a3', name: '黄色强调', style: {color: '#FFE14D', sh: {color: '#131313', a: 0.6, dist: 0.06, blur: 0.12, rot: 90}}},
    {id: 'a4', name: '白色标签', style: {color: '#131313', bg: {color: '#FFFFFF', pad: 8, r: 8, mode: 'wrap'}}},
    {id: 'a5', name: '蓝色标签', style: {color: '#FFFFFF', bg: {color: '#3B63FB', pad: 8, r: 8, mode: 'wrap'}}},
    {id: 'a6', name: '蓝色整块', style: {color: '#FFFFFF', bg: {color: '#3B63FB', pad: 8, r: 0, mode: 'block'}}},
    {id: 'a7', name: '柔和投影', style: {color: '#FFFFFF', sh: {color: '#131313', a: 0.8, dist: 0.08, blur: 0.2, rot: 90}}},
    {id: 'a8', name: '蓝色辉光', style: {color: '#FFFFFF', ol: {color: '#3B63FB', w: 1}, sh: {color: '#3B63FB', a: 1, dist: 0, blur: 0.25, rot: 0}}},
    {id: 'a9', name: '厚描边', style: {color: '#FFFFFF', ol: {color: '#3B63FB', w: 4}}},
  ];

  /* ---------- 项目素材库（§13.6） ----------
     三个媒体面板读的是同一份 `sources{}`，只按类别过滤。缩略图渐变是**素材内容
     本身**的示意，不是 S2 表面——登记为 media still。 */
  const sources = {
    image: [
      {id: 'i1', name: 'logo-mark.png', meta: '512 × 512 · 24 KB', alpha: true},
      {id: 'i2', name: 'cover-art.jpg', meta: '1920 × 1080 · 1.2 MB',
       grad: 'linear-gradient(135deg, #FBD3A4 0%, #E98CA5 55%, #6A5ACD 100%)'},
      {id: 'i3', name: 'chapter-card.png', meta: '1600 × 900 · 310 KB',
       grad: 'linear-gradient(140deg, #2E4A3F, #16241F)'},
    ],
    video: [
      {id: 'v1', name: 'kelang-ep42-master.mp4', meta: '1080p · 30 fps · 412 MB', dur: 206,
       badge: '转录源', grad: 'linear-gradient(160deg, #232A38, #10141C)'},
      {id: 'v2', name: 'broll-desk.mov', meta: '4K · 24 fps · 208 MB', dur: 41,
       grad: 'linear-gradient(140deg, #2E4A3F, #16241F)'},
    ],
    audio: [
      {id: 'a1', name: 'bgm-sunrise.mp3', meta: '02:58 · 320 kbps', dur: 178, badge: '已在时间轴'},
      {id: 'a2', name: 'voiceover-intro.m4a', meta: '00:22 · 48 kHz', dur: 22},
    ],
  };

  /* 已存进品牌库的素材（第 84.1 轮）。品牌页此前缺视频与图片两节，于是画布 `···`
     上那一行「存到品牌库」在图片与视频上没有落点，被拦了两轮。补上这一节之后它才是一个真的动作。
     `kind` 决定它排在哪一节，`grad` 与素材库缩略图同一份取色。 */
  const brandMedia = [
    {id: 'bm1', kind: 'video', name: 'kelang-intro-bumper.mp4', meta: '1080p · 4 秒 · 片头',
     grad: 'linear-gradient(160deg, #232A38, #10141C)'},
    {id: 'bm2', kind: 'image', name: 'logo-mark.png', meta: '带透明通道',
     grad: 'linear-gradient(135deg, #3B63FB, #A46CFF)'},
  ];
  /* 旧版 Brand kit 的水印表（2026-09-14 之前的格式：文字或图片、平铺或钉一角）。
     「水印」这个格式没有了——它是模板的一类；这两条只用来演示「旧水印一次性导成品牌库模板」，
     视图层不再读它。 */
  const LEGACY_WATERMARKS = [
    {id: 'w1', name: '@kelang.studio', mode: '平铺'},
    {id: 'w2', name: 'logo-mark.png', mode: '右下角'},
  ];

  /* ---------- Brand kit（§13.7） ----------
     模板（含水印类）烧进导出画面；品牌色/品牌字出现在全 App 的取色面板与字体选择框里。
     色值是用户为导出画面挑的颜色，不是 S2 表面（登记在 app/data.js 作用域）。 */
  const brand = {
    colors: ['#131313', '#FFFFFF', '#3B63FB', '#FF4C45', '#70DB74'],
    // 「+」新增一格时用的默认色。内容色一律只住在这个文件里，视图层不发明颜色
    addDefault: '#FFE14D',
    /* 品牌字体是**字体选择框 Brand kits 那一节的唯一真相**（§13.7 早就这么写着：
       「这里加一条，每个选字体的地方就多一条」）。第 80 轮之前 `fonts.brand` 另存了
       一份「科浪 Sans / 科浪 Serif」——两份名字对不上，品牌页说的那句话是假的。
       `used` = 多少分钟前用过，选择框按它倒序（最近的排最前）；本页仍按用途排。
       名字必须是目录（`fonts.all`）里真有的族，否则选中之后画面上换不了字。 */
    fonts: [
      {name: 'Source Sans 3', use: '标题与界面', stack: "'Source Sans 3', sans-serif", used: 180},
      {name: '思源黑体 Source Han Sans', use: '字幕',
       stack: "'PingFang SC', 'Microsoft YaHei', sans-serif", used: 12},
    ],
    media: brandMedia,
    /* 已存进品牌库的模板定义（第 112 轮）：从「章节底栏 · 色条」改出来的一套——色条换成品牌蓝、
       台标改用品牌库里那张 logo。演示「套用 = 拷一份进项目 / 品牌库那份不动」这条契约。
       后面两条是旧水印导进来的（`imported: 'watermark'`，2026-09-14）：平铺的社交名、钉右下角的
       logo 图——图片水印按名字在品牌库图片里认出 bm2。 */
    templates: (() => {
      const TPL = window.BC_TPL;
      let t = TPL.updateLayer(TPL.BUILTINS[0], 'l-ch', {accent: '#3B63FB'});
      t = TPL.updateLayer(t, 'l-lg', {src: 'bm2', bg: null});
      const own = [Object.assign(t, {id: 'tpl-brand-1', name: '科浪 · 节目包装', hue: 'blue', brand: true, builtin: false})];
      return TPL.importWatermarks(own, LEGACY_WATERMARKS, {images: brandMedia.filter((m) => m.kind === 'image')});
    })(),
    /* 已存进品牌库的字幕样式。`form` 决定它出现在哪个 Tab（与内置目录同一根轴），
       `look` / `look2` 是它在画廊缩略图里的渲染配方（键取自 subtitle.looks），
       `st` 是品牌页那张小卡自己的行内示意——两处画的是同一份样式，但品牌页的卡片
       没有画面底，不走 look 那套按字号折算的几何。 */
    subStyles: [
      {id: 'b1', name: 'Studio caption', form: 'bi', look: 'shadeplay', look2: 'shadeplay',
       st: {color: '#FFFFFF', fontWeight: 800,
        background: 'rgba(0,0,0,0.5)', padding: '0 6px', borderRadius: 3}},
      {id: 'b2', name: 'Neon pop', form: 'orig', look: 'vegas', st: {color: '#FFE14D', fontWeight: 800,
        textShadow: '0 1px 3px rgba(0,0,0,0.8)'}},
      {id: 'b3', name: 'Outline', form: 'orig', look: 'slay', st: {color: '#FFFFFF', fontWeight: 800,
        WebkitTextStroke: '0.6px #131313'}},
      {id: 'b4', name: 'Subs only', form: 'trans', look: 'corpo', st: {color: '#FFFFFF', fontWeight: 600,
        textShadow: '0 1px 3px rgba(0,0,0,0.8)'}},
    ],
  };

  /* ---------- Agent（§17.2；第 109 轮：左侧主入口，会话制；第 110 轮：一条会话只绑一个项目） ----------
     Agent 底层是装在本机的 Claude Code / Codex CLI（用户自己的订阅），App 以子进程
     驱动它的 stdio，通过 baocut skill 调 `bcut` 操作项目。BaoCut 不自带模型、不代收
     密钥。**从不无头执行**：每一次写入项目都要用户放行。

     一条会话 = {id, title, project|null, harness, model, effort, status, ago, messages}。
     project 是工作目录也是唯一写入目标；null 只出现在首页起的、还没绑项目的会话
     （只能规划与回答，第一次要写入时会请你选项目或拖视频）。@ 引入的其他项目一律只读参考。
     编码 Agent 列表按 App v2 `settings/providers.rs` 的形状：found / ver / bin / models / enabled。
     status：running（agent 在干活）/ waiting（等你放行或回答）/ idle（轮到你说）/ done。
     消息角色：user / assistant / tool（一次 CLI 或读文件）/ permission（放行卡）/
     receipt（写进项目后的收据，撤销位与后台任务同源）。 */
  /* 内置的 provider 表（product-design §7.6）：BaoCut 自带启动方式、安装与登录说明的九家。
     Claude Code、Codex CLI、GitHub Copilot CLI、Pi、OpenCode 五家常驻主列表；Gemini CLI、Cursor Agent、Grok、Kimi Code
     四家 `extra: true`——没检测到时只出现在 设置 › Agent 的「更多」折叠段里，不进会话选择器和工具页的「用」；
     一旦检测到就和前五家同等对待。其余说 ACP 的命令行智能体不内置，由用户从 ACP_CATALOG 或自定义命令添加。
     安装命令与 `bcut-editor-core::agent_setup::install_methods` 同源；新装只列官方脚本 / Homebrew / npm；升级时按已装那一份的
     真实位置（`realBin`，链接解析到底；没给就等于 `bin`）认出它归谁管，推出同一种方式的升级命令（bun / pnpm / yarn / volta
     只在这时出现），见 model-agent-setup.js 的 installSource。
     `installs: []` = 没有一条可以稳妥给出的安装命令，安装面板改成「按官方说明安装」+ 重新检测。
     `launch` = 经 ACP 接入时 BaoCut 启动它用的整条命令；`loginHint` = 登录不是子命令、要在它的交互界面里做时的说明。
     `caveat` = 这一家没有逐次询问的通道，只能跑「完全访问」。模型表是装好之后才问得到的，这里是演示值。 */
  const harnessPreset = (id, name, cmd, by, plan, ver, installs, models, rest) => ({
    id, name, cmd, by, extra: true, found: false, ver, minVer: ver, latest: ver, bin: '/opt/homebrew/bin/' + cmd,
    loggedIn: true, runError: null, configModel: null, configModelKnown: null,
    account: plan, plan, install: installs.length ? installs[0].cmd : null, installs, models, ...(rest || {}),
  });
  const FULL_ONLY = '它没有逐次询问的通道，BaoCut 只能让它在「完全访问」模式下运行：执行命令和修改文件之前不会先问你。';
  /* 主列表里 Claude Code 与 Codex CLI 之后的三家（`extra: false`）。 */
  const MAIN_PRESETS = [
    /* Copilot 的模型表是演示值：真机由 ACP 的 session/new 应答给出，跟着 Copilot 订阅里开放的模型走。 */
    harnessPreset('copilot', 'GitHub Copilot CLI', 'copilot', 'GitHub', 'GitHub Copilot 订阅', '1.0.12',
      [{k: 'npm', label: 'npm', needs: 'Node.js', cmd: 'npm install -g @github/copilot', upgrade: 'npm install -g @github/copilot@latest'}],
      [{id: 'claude-sonnet-5', name: 'Claude Sonnet 5', dflt: true, tier: 'balanced'}, {id: 'gpt-6-sol', name: 'GPT-6 Sol', tier: 'max'}, {id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', tier: 'fast'}],
      {extra: false, launch: ['copilot', '--acp'], loginHint: '装好后在终端里运行 copilot，在它的交互界面里输入 /login，按提示用 GitHub 账号登录。',
       realBin: '/opt/homebrew/lib/node_modules/@github/copilot/index.js'}),
    harnessPreset('pi', 'Pi', 'pi', '开源项目', 'Pi 里的模型账号', '1.0.4',
      [{k: 'npm', label: 'npm', needs: 'Node.js', cmd: 'npm install -g @earendil-works/pi-coding-agent', upgrade: 'npm install -g @earendil-works/pi-coding-agent@latest'}],
      [{id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', dflt: true, tier: 'balanced'}],
      {extra: false, minVer: '0.84.4', caveat: FULL_ONLY, bin: '~/.nvm/versions/node/v22.3.0/bin/pi', realBin: '~/.nvm/versions/node/v22.3.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js'}),
    harnessPreset('opencode', 'OpenCode', 'opencode', 'OpenCode', 'OpenCode 里的模型账号', '2.0.24',
       /* 只有 npm 包 @opencode/cli 是 2.x；官方脚本与 opencode-ai 包装出的都是 1.x，BaoCut 驱动不了，所以不列。
          已装 1.x 时原地升级到不了 2.x：reinstall 让问题说明改说「改装」，升级段也不沿用检测到的来源。 */
       [{k: 'npm', label: 'npm', needs: 'Node.js', cmd: 'npm install -g @opencode/cli', upgrade: 'npm install -g @opencode/cli@latest'}],
       [{id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', dflt: true, tier: 'balanced'}, {id: 'openai/gpt-5.6-sol', name: 'GPT-5.6 Sol'}],
       {extra: false, minVer: '2.0.10', reinstall: {below: '2.0.0', from: '官方脚本或 opencode-ai 包', pkg: '@opencode/cli'},
        bin: '/opt/homebrew/bin/opencode', realBin: '/opt/homebrew/lib/node_modules/@opencode/cli/bin/opencode.js'}),
  ];
  /* 「更多」折叠段的四家 ACP 智能体。 */
  const MORE_HARNESSES = [
    harnessPreset('gemini', 'Gemini CLI', 'gemini', 'Google', 'Google 账号', '0.27.3',
      [{k: 'brew', label: 'Homebrew', needs: 'Homebrew', cmd: 'brew install gemini-cli', upgrade: 'brew upgrade gemini-cli'},
       {k: 'npm', label: 'npm', needs: 'Node.js', cmd: 'npm install -g @google/gemini-cli', upgrade: 'npm install -g @google/gemini-cli@latest'}],
      [{id: 'gemini-3-flash', name: 'Gemini 3 Flash', dflt: true, tier: 'balanced'}, {id: 'gemini-3-pro', name: 'Gemini 3 Pro', tier: 'max'}],
      {realBin: '/opt/homebrew/Cellar/gemini-cli/0.27.3/libexec/lib/node_modules/@google/gemini-cli/bundle/gemini.js'}),
    harnessPreset('cursor', 'Cursor Agent', 'cursor-agent', 'Cursor', 'Cursor 订阅', '2026.09.10',
      [{k: 'script', label: '官方脚本', cmd: 'curl https://cursor.com/install -fsS | bash', upgrade: 'cursor-agent update'}],
      [{id: 'auto', name: 'Auto', dflt: true, tier: 'balanced'}]),
    harnessPreset('grok', 'Grok', 'grok', 'xAI', 'xAI 账号', '0.9.2',
      [{k: 'script', label: '官方脚本', cmd: 'curl -fsSL https://x.ai/cli/install.sh | bash', upgrade: 'curl -fsSL https://x.ai/cli/install.sh | bash'}],
      [{id: 'grok-4.5', name: 'Grok 4.5', dflt: true, tier: 'balanced'}, {id: 'grok-4.6', name: 'Grok 4.6', tier: 'max'}]),
    harnessPreset('kimi', 'Kimi Code', 'kimi', 'Moonshot AI', 'Kimi 账号', '1.12.0', [],
      [{id: 'kimi-k3', name: 'Kimi K3', dflt: true, tier: 'balanced'}], {docs: 'https://github.com/MoonshotAI/kimi-code'}),
  ];
  /* 可添加的 ACP 智能体目录（product-design §7.6）：设置 › Agent「添加更多 Agent」里一键添加的条目，不含上面内置的九家。
     command = BaoCut 启动它用的命令数组（`npx -y 包@版本` 钉住版本，升级跟着 BaoCut 的目录走）；env = 启动时附加的环境变量；
     ver = 目录记的版本（null = 由它自己的安装方式决定）；docs = 它的官方说明。介绍是 BaoCut 自己写的一句话。
     这些智能体 BaoCut 没有逐家验证过：能不能用以它自己的说明与探测结果为准。 */
  const ACP_CATALOG = [
    {id: 'amp-acp', name: 'Amp', ver: '0.7.0', desc: '给 Amp 编码智能体套一层 ACP 的社区适配器。', command: ['amp-acp'], docs: 'https://github.com/tao12345666333/amp-acp'},
    {id: 'auggie', name: 'Auggie CLI', ver: '0.33.0', desc: 'Augment Code 的命令行智能体，长于在大型代码库里检索上下文。', command: ['npx', '-y', '@augmentcode/auggie@0.33.0', '--acp'], env: {AUGMENT_DISABLE_AUTO_UPDATE: '1'}, docs: 'https://www.augmentcode.com/'},
    {id: 'autohand', name: 'Autohand Code', ver: '0.2.1', desc: 'Autohand 出品的编码智能体，用它自己的模型服务。', command: ['npx', '-y', '@autohandai/autohand-acp@0.2.1'], docs: 'https://www.autohand.ai/cli/'},
    {id: 'cline', name: 'Cline', ver: '3.0.46', desc: '开源的自主编码智能体，能改文件、跑命令，模型账号自己接。', command: ['npx', '-y', 'cline@3.0.46', '--acp'], docs: 'https://cline.bot/cli'},
    {id: 'codebuddy-code', name: 'Codebuddy Code', ver: null, desc: '腾讯云的命令行编码助手。', command: ['codebuddy', '--acp'], docs: 'https://www.codebuddy.cn/cli/'},
    {id: 'codewhale', name: 'CodeWhale', ver: '0.8.55', desc: '面向 DeepSeek 与开源模型的终端编码智能体。', command: ['codewhale', 'serve', '--acp'], docs: 'https://codewhale.net/'},
    {id: 'cortex-code', name: 'Cortex Code', ver: '1.0.73', desc: 'Snowflake 的 Cortex 编码智能体，适合已经在用 Snowflake 的团队。', command: ['cortex', 'acp', 'serve'], docs: 'https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-cli'},
    {id: 'corust-agent', name: 'Corust Agent', ver: '0.5.1', desc: '偏重 Rust 项目的编码智能体。', command: ['corust-agent-acp'], docs: 'https://github.com/Corust-ai/corust-agent-release/releases'},
    {id: 'crow-cli', name: 'crow-cli', ver: '0.1.23', desc: '一个从一开始就按 ACP 写的轻量编码智能体。', command: ['crow-cli', 'acp'], docs: 'https://crow-ai.dev/'},
    {id: 'deepagents', name: 'DeepAgents', ver: '0.1.20', desc: '基于 LangChain 的通用智能体，也能写代码。', command: ['npx', '-y', 'deepagents-acp@0.1.20'], docs: 'https://docs.langchain.com/oss/javascript/deepagents/overview'},
    {id: 'devin', name: 'Devin CLI', ver: null, desc: 'Cognition 的 Devin 在终端里的版本。', command: ['devin', 'acp'], docs: 'https://cli.devin.ai/docs'},
    {id: 'dimcode', name: 'DimCode', ver: '0.2.36', desc: '可以在几家主流模型之间切换的编码智能体。', command: ['npx', '-y', 'dimcode@0.2.36', 'acp'], docs: 'https://dimcode.dev/docs/acp.html'},
    {id: 'dirac', name: 'Dirac', ver: '0.4.22', desc: '开源编码智能体，主打省调用量：并行改动、按语法树编辑。', command: ['npx', '-y', 'dirac-cli@0.4.22', '--acp'], docs: 'https://dirac.run'},
    {id: 'factory-droid', name: 'Factory Droid', ver: '0.179.0', desc: 'Factory 的 Droid 编码智能体。', command: ['npx', '-y', 'droid@0.179.0', 'exec', '--output-format', 'acp-daemon'], env: {DROID_DISABLE_AUTO_UPDATE: 'true', FACTORY_DROID_AUTO_UPDATE_ENABLED: 'false'}, docs: 'https://factory.ai/product/cli'},
    {id: 'fast-agent', name: 'fast-agent', ver: '0.9.22', desc: '可接多家模型服务的智能体框架，自带编码能力。需要 uv。', command: ['uvx', '--from', 'fast-agent-acp==0.9.22', 'fast-agent-acp', '-x'], docs: 'https://fast-agent.ai/acp/'},
    {id: 'gjc', name: 'Gajae Code', ver: null, desc: '借用你已有的编码订阅，先列计划再动手，危险操作前会先问。', command: ['gjc', 'acp'], env: {GJC_ACP_PERMISSION_MODE: 'prompt'}, docs: 'https://gajae-code.com'},
    {id: 'glm-acp-agent', name: 'GLM Agent', ver: '1.3.0', desc: '用智谱 GLM 编码套餐里的模型，会话可以中途换模型。', command: ['npx', '-y', 'glm-acp-agent@1.3.0'], docs: 'https://github.com/stefandevo/glm-acp-agent'},
    {id: 'goose', name: 'goose', ver: '1.33.1', desc: '开源、可扩展的本地智能体，能把工程上的杂活自动做完。', command: ['goose', 'acp'], docs: 'https://block.github.io/goose/'},
    {id: 'hermes', name: 'Hermes', ver: null, desc: 'Nous Research 的智能体，会从用过的任务里自我改进。', command: ['hermes', 'acp'], docs: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/acp'},
    {id: 'junie', name: 'Junie', ver: '1468.30.0', desc: 'JetBrains 的编码智能体。', command: ['junie', '--acp', 'true'], docs: 'https://junie.jetbrains.com/docs/junie-cli-acp.html'},
    {id: 'kilo', name: 'Kilo', ver: '7.2.40', desc: '开源编码智能体，命令行与编辑器共用一套。', command: ['kilo', 'acp'], docs: 'https://kilo.ai/docs/code-with-ai/platforms/cli'},
    {id: 'kiro', name: 'Kiro CLI', ver: null, desc: 'Amazon 的编码智能体，原生支持 ACP。', command: ['kiro-cli', 'acp'], docs: 'https://kiro.dev/docs/cli/acp/'},
    {id: 'minimax-code', name: 'MiniMax Code', ver: '0.1.2', desc: 'MiniMax 的终端编码智能体。', command: ['npx', '-y', '@minimax-ai/code@0.1.2', 'acp'], docs: 'https://agent.minimax.io'},
    {id: 'minion-code', name: 'Minion Code', ver: '0.1.44', desc: '基于 Minion 框架、带一套开发工具的编码助手。需要 uv。', command: ['uvx', '--from', 'minion-code==0.1.44', 'minion-code', 'acp'], docs: 'https://github.com/femto/minion-code'},
    {id: 'mistral-vibe', name: 'Mistral Vibe', ver: '2.9.3', desc: 'Mistral 的开源编码助手。', command: ['vibe-acp'], docs: 'https://github.com/mistralai/mistral-vibe'},
    {id: 'nova', name: 'Nova', ver: '1.1.29', desc: 'Compass AI 的软件工程智能体。', command: ['npx', '-y', '@compass-ai/nova@1.1.29', 'acp'], docs: 'https://www.compassap.ai/portfolio/nova.html'},
    {id: 'poolside', name: 'Poolside', ver: '1.0.0', desc: 'Poolside 的编码智能体。', command: ['pool', 'acp'], docs: 'https://docs.poolside.ai/cli/pool'},
    {id: 'qoder', name: 'Qoder CLI', ver: '1.1.4', desc: 'Qoder 的命令行编码助手，能自己拆任务、连续执行。', command: ['npx', '-y', '@qoder-ai/qodercli@1.1.4', '--acp'], docs: 'https://qoder.com'},
    {id: 'qwen-code', name: 'Qwen Code', ver: '0.20.1', desc: '阿里通义千问的编码助手。', command: ['npx', '-y', '@qwen-code/qwen-code@0.20.1', '--acp', '--experimental-skills'], docs: 'https://qwenlm.github.io/qwen-code-docs/en/users/overview'},
    {id: 'sigit', name: 'siGit Code', ver: '1.0.3', desc: '完全在本机运行的编码智能体，可以选用设备上的本地模型。', command: ['sigit'], docs: 'https://github.com/getsigit/sigit'},
    {id: 'stakpak', name: 'Stakpak', ver: '0.3.80', desc: '用 Rust 写的开源运维智能体，偏重安全。', command: ['stakpak', 'acp'], docs: 'https://stakpak.dev/'},
    {id: 'traecli', name: 'TRAE CLI', ver: null, desc: '字节跳动 TRAE 的命令行编码智能体。', command: ['traecli', 'acp', 'serve'], docs: 'https://docs.trae.cn/cli_get-started-with-trae-cli'},
    {id: 'vtcode', name: 'VT Code', ver: '0.96.14', desc: '开源编码智能体，懂代码结构，跑命令有安全护栏，可接多家模型。', command: ['vtcode', 'acp'], env: {VT_ACP_ENABLED: '1', VT_ACP_ZED_ENABLED: '1'}, docs: 'https://github.com/vinhnx/VTCode/blob/main/docs/guides/zed-acp.md'},
  ];
  /* 回合的开始 / 结束时刻（会话线程的回合页脚读它，记在这一轮的用户消息上）：演示时刻按载入时往回推。
     turnDone(ago, secs)：这一轮在 ago 分钟前结束、用了 secs 秒；turnLive(secs)：还在进行，已经 secs 秒。 */
  const turnDone = (ago, secs) => ({startedAt: Date.now() - ago * 60000 - secs * 1000, endedAt: Date.now() - ago * 60000});
  const turnLive = (secs) => ({startedAt: Date.now() - secs * 1000});

  const agent = {
    harnesses: [
      /* 2026-09-18（设置 › Agent 重设计）：探测结果多带几样——cmd（终端里敲的名字）、minVer / latest
         （BaoCut 能驱动的最低版本 / 上游最新版本）、loggedIn、runError、installs（原样给你看、也能替你摆进终端的
         安装与升级命令）、模型的 tier（balanced = 推荐 / max = 最强 / fast = 最快，见 model-agent-setup.js）。
         `found:false` 的那一家仍然带着「装好之后」的 ver / bin / realBin，安装演示落定时直接用。 */
      {id: 'claude', name: 'Claude Code', cmd: 'claude', found: true, ver: '2.1.284', minVer: '2.0.0', latest: '2.2.0',
       runtimeModel: 'sonnet', configModel: 'sonnet', configModelKnown: true,
       bin: '/opt/homebrew/bin/claude', realBin: '/opt/homebrew/Caskroom/claude-code/2.1.284/claude', loggedIn: true, runError: null,
       account: 'Claude Pro 订阅 · 已登录', plan: 'Claude Pro 或 Max 订阅', dflt: true, enabled: true,
       install: 'npm install -g @anthropic-ai/claude-code',
       installs: [
         {k: 'script', label: '官方脚本', cmd: 'curl -fsSL https://claude.ai/install.sh | bash', upgrade: 'claude update'},
         {k: 'brew', label: 'Homebrew', needs: 'Homebrew', cmd: 'brew install --cask claude-code', upgrade: 'brew upgrade --cask claude-code'},
         {k: 'npm', label: 'npm', needs: 'Node.js', cmd: 'npm install -g @anthropic-ai/claude-code', upgrade: 'npm install -g @anthropic-ai/claude-code@latest'},
       ],
       models: [{id: 'sonnet', name: 'Sonnet 5.5', dflt: true, tier: 'balanced'}, {id: 'opus', name: 'Opus 5.5', tier: 'max'}, {id: 'haiku', name: 'Haiku 4.5', tier: 'fast'}]},
      /* 2026-09-29：configModel = BaoCut 不传模型时 CLI 自己的配置会选哪个（codex 读 `~/.codex/config.toml` 的 model）；
         configModelKnown = 这一版 CLI 的完整模型表（含隐藏模型）里有没有它，内核算好送来。演示场景「默认模型需升级」
         把本机版本压回 0.153.0、模型表换成还没有 gpt-6-sol 的旧表，重现那次事故。
         新版目录含 GPT-6.1 Sol，按 CLI 自己的次序取第一个 `-sol` 推荐（见 model-agent-setup.js::recommended）。 */
      {id: 'codex', name: 'Codex CLI', cmd: 'codex', found: false, ver: '0.159.0', minVer: '0.120.0', latest: '0.159.0',
       runtimeModel: 'gpt-6.1-sol', configModel: 'gpt-6.1-sol', configModelKnown: true,
       bin: '/opt/homebrew/bin/codex', realBin: '/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js', loggedIn: true, runError: null,
       install: 'npm install -g @openai/codex',
       installs: [
         {k: 'brew', label: 'Homebrew', needs: 'Homebrew', cmd: 'brew install codex', upgrade: 'brew upgrade codex'},
         {k: 'npm', label: 'npm', needs: 'Node.js', cmd: 'npm install -g @openai/codex', upgrade: 'npm install -g @openai/codex@latest'},
       ],
       account: 'ChatGPT Plus / Pro 订阅', plan: 'ChatGPT Plus 或 Pro 订阅', enabled: false,
       models: [{id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', dflt: true, tier: 'balanced'}, {id: 'gpt-6-sol', name: 'GPT-6 Sol'}, {id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol'}, {id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', tier: 'fast'}]},
      ...MAIN_PRESETS,
      ...MORE_HARNESSES,
    ],
    catalog: ACP_CATALOG,
    checked: '刚检查过',
    /* 斜杠命令（第 111 轮补丁）：正文开头敲 / 弹出；选中只把 `/xxx ` 留在正文里，
       后面接着说范围或语言，Agent 自己解释——这不是 GUI 的工具表，是 skill 里的快捷句。 */
    /* 斜杠命令 = 这部视频能交给 Agent 的全部工具（product-design §5.10）：发出去由 Agent 接手，
       写入前在放行卡里调参数。命令落到哪份计划由 model-agent.js::SLASH_KINDS 决定。 */
    slash: [
      {cmd: '/crop', icon: 'video', label: '智能裁剪', sub: '换一种画幅，把重点留在框里'},
      {cmd: '/shorts', icon: 'clip', label: '剪成短视频', sub: '挑几段，各做成一支竖屏短视频'},
      {cmd: '/polish', icon: 'sparkle', label: '润色文稿', sub: '修错字、补标点、分段'},
      {cmd: '/chapters', icon: 'list', label: '生成章节', sub: '按话题分章并起标题'},
      {cmd: '/speakers', icon: 'mic', label: '识别说话人', sub: '给字幕与文稿标上名字'},
      {cmd: '/retranscribe', icon: 'redo', label: '重新转录', sub: '换一个语音模型重跑音频'},
      {cmd: '/clean', icon: 'captions', label: '找可剪的口', sub: '口癖、长停顿、坏拍'},
      {cmd: '/translate', icon: 'translate', label: '翻译字幕', sub: '翻成一门语言并对齐时间码'},
      {cmd: '/refresh', icon: 'redo', label: '刷新过期译文', sub: '只重译原文变过的那几句'},
      {cmd: '/dub', icon: 'wave', label: '翻译配音', sub: '让视频用另一种语言开口'},
      {cmd: '/summary', icon: 'transcript', label: '写总结', sub: '正文加带时间的要点'},
      {cmd: '/blog', icon: 'text', label: '写博客', sub: '改写成一篇文章'},
      {cmd: '/title', icon: 'star', label: '起标题', sub: '几个角度不同的候选'},
      {cmd: '/desc', icon: 'edit', label: '写简介', sub: '带章节时间码和标签'},
      {cmd: '/cover', icon: 'image', label: '做封面', sub: '从关键帧出发做几张候选'},
      {cmd: '/export', icon: 'export', label: '导出', sub: 'SRT / 烧录字幕的 MP4'},
    ],
    /* 推理强度：第 111 轮补丁从 Segmented 改成下拉，副文案说清代价。 */
    efforts: [{k: 'low', label: '低', sub: '快，适合小改动'}, {k: 'mid', label: '中', sub: '默认'}, {k: 'high', label: '高', sub: '慢，想得更久'}],
    /* 访问模式（第 121 轮，§17.2）：会话级的**粗闸门**，四档从最严到最松，照搬 waku——
       四档永远全部可选，不按 provider、不按任何开关置灰，切档也不弹确认框。
       它只决定「provider 送来审批请求时替不替你答应」，**命令级的判断仍然全部由下面
       那张放行策略表承担**——两层叠加，不是二选一。键名与 App 的序列化名同形
       （ask / autoAcceptEdits / auto / fullAccess），图标是下拉收起后唯一的状态提示，
       所以四档不共用一枚。默认档是 `ask`：这是**默认**，不是天花板——四档由用户自己切。 */
    modes: [
      {k: 'ask', label: '监督', icon: 'lock', desc: '执行命令或修改文件前先征求许可'},
      {k: 'autoAcceptEdits', label: '自动接受修改', icon: 'edit', desc: '自动批准文件修改，执行其他操作前先询问'},
      {k: 'auto', label: '自动', icon: 'sparkle', desc: '由编码 Agent 自带的审核者批准常规操作；高风险操作仍会询问'},
      {k: 'fullAccess', label: '完全访问', icon: 'unlock', desc: '无需确认即可执行命令和修改文件'},
    ],
    /* 三条放行策略，都可关。第 121 轮删掉了原先那条锁死的「写入项目一律先问」——
       写入要不要先问，由 composer 的访问模式说了算（默认「监督」），设置页不再另设
       一个天花板去钳它。 */
    policy: [
      {k: 'read', label: '读取视频文件自动允许', desc: 'transcript.json、project.json 这类只读操作不再逐次问你。', on: true},
      {k: 'bcutro', label: 'bcut 只读命令自动允许', desc: 'info / status / spec 这几条不改任何文件。', on: true},
      {k: 'loop', label: 'Agent 应答环自动允许', desc: 'task claim / task submit 这一对是 Agent 回答 AI 阶段请求的通道，不改视频文件，不必逐次问你。', on: true},
    ],
    chips: {
      home: ['给这个视频加字幕并翻译成英文', '找出口癖和长停顿，先列出来再剪', '把这一期分成章节并起标题', '导出双语 SRT 和烧录字幕的 MP4'],
      editor: ['把这一章的口癖去掉', '给每章起个更短的标题', '找出可以剪掉的重复段落', '把术语统一成术语表里的写法'],
      translate: ['把译文里的术语统一成术语表的写法', '找出停留太久的译文并重切', '再翻一门语言：日语'],
    },
    sessions: [
      {id: 's1', title: '把第 3 章的停顿压到 0.3 秒', project: 'p1', harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'running', ago: 4, taskId: 'ag1',
       messages: [
         {id: 'm1', role: 'user', text: '把第 3 章的停顿压到 0.3 秒，口癖也一起去掉。', ...turnLive(252)},
         {id: 'm2', role: 'assistant', text: '好。第 3 章「产品演示」是 95s–158s。我先扫一遍这一章的词级时间，把 ≥0.8s 的停顿和口癖列出来，再压停顿。压停顿会改 clip，所以写入前会先问你。'},
         {id: 'm3', role: 'tool', kind: 'command', cmd: 'bcut project info project.bcut', status: 'done', took: '0.3s', out: 'duration 206s · 3 speakers · 4 chapters · 62 cues'},
         {id: 'm4', role: 'tool', kind: 'read', summary: 'transcript.json', cmd: '读取 transcript.json · 第 3 章 · 18 段', status: 'done', took: '0.1s'},
         {id: 'm5', role: 'assistant', text: '第 3 章里有 11 处停顿 ≥0.8s（最长 2.4s），口癖 7 处（「嗯」×4、「就是」×3）。合计可以省 21 秒。'},
         {id: 'm6', role: 'permission', cmd: 'bcut cleanup project.bcut --chapter 3 --max-pause 0.3 --fillers', state: 'allowed',
          why: '会写剪辑建议（review 覆盖层）并把 11 处停顿压到 0.3s；clip 边界会变，可整条撤销。'},
         {id: 'm7', role: 'tool', kind: 'command', cmd: 'bcut cleanup project.bcut --chapter 3 --max-pause 0.3 --fillers', status: 'run', taskId: 'ag1'},
       ]},
      /* 2026-10-01：`review` = 有待审阅结果、`unread` = 已完成未读、`pinned` = 置顶（Home 侧栏，§3.1）；
         失败不另存——最后一条回复带 error 就是失败（BC_AGENT_PROJECTS.sessionStatus）。 */
      {id: 's2', title: '统一「渲染 / 光栅化」的译法', project: 'p1', harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'done', ago: 18, taskId: 'ag2', review: true, pinned: true,
       messages: [
         {id: 'm1', role: 'user', text: '英文译文里 render 一会儿翻成「渲染」一会儿「光栅化」，统一一下。', ...turnDone(25, 41)},
         {id: 'm2', role: 'assistant', text: '我先查一下两个词各出现在哪几句。「光栅化」在技术上是 rasterize，不是 render——要不要顺手把这一层也分开？'},
         {id: 'm3', role: 'tool', cmd: '读取 transcript.json · trans[en] · 62 句', status: 'done', took: '0.1s', out: '「渲染」14 句 · 「光栅化」6 句（其中 4 句原文是 render）'},
         {id: 'm4', role: 'user', text: '对，render 一律「渲染」，rasterize 才是「光栅化」。', ...turnDone(18, 63)},
         {id: 'm5', role: 'permission', cmd: 'bcut translate project.bcut --lang en --only 4 句', state: 'allowed',
          why: '只重译这 4 句，其余 58 句一个字不动；对齐会跟着重算。可整条撤销。'},
         {id: 'm6', role: 'tool', cmd: 'bcut translate project.bcut --lang en --only g12,g19,g33,g41', status: 'done', took: '2.1s'},
         {id: 'm7', role: 'receipt', text: '已应用 · 重译 4 句 · 对齐重算 · 2.1s', taskId: 'ag2'},
         {id: 'm8', role: 'assistant', text: '改好了：4 句里的「光栅化」换成「渲染」，另外 2 句原文确实是 rasterize，保留。翻译面板里这 4 句标了「刚改过」。'},
       ]},
      // s5 / s6：让第一个项目超过侧栏默认露的 3 条，「还有 N 条」这个态才看得见（第 110 轮补丁）
      {id: 's5', title: '第 2 章开头 40 秒的口癖清一遍', project: 'p1', harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'done', ago: 140, taskId: null,
       messages: [
         {id: 'm1', role: 'user', text: '第 2 章开头那 40 秒「那个」「就是」太多了，清一遍。', ...turnDone(140, 48)},
         {id: 'm2', role: 'permission', cmd: 'bcut cut project.bcut --fillers --range 02:10-02:50', state: 'allowed', why: '只动这 40 秒里的 9 处口癖，词真相不变；可整条撤销。'},
         {id: 'm3', role: 'tool', cmd: 'bcut cut project.bcut --fillers --range 02:10-02:50', status: 'done', took: '0.8s'},
         {id: 'm4', role: 'receipt', text: '已应用 · 剪掉 9 处口癖 · 0.8s', taskId: null},
       ]},
      {id: 's6', title: '这一期的章节表和上一期对齐', project: 'p1', harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'done', ago: 1500, taskId: null,
       messages: [
         {id: 'm1', role: 'user', text: '章节起名照 @视频:Code & Wander Ep. 42 那一期的风格来。', ...turnDone(1500, 37)},
         {id: 'm2', role: 'assistant', text: '读了那一期的 4 个章节标题，都是「动词 + 对象」四到六个字。这一期我按同样的口径起了 4 个，写入前给你看。'},
         {id: 'm3', role: 'receipt', text: '已应用 · 4 个章节改名 · 0.3s', taskId: null},
       ]},
      {id: 's3', title: '给 4 个章节重新起名', project: 'p7', harness: 'claude', model: 'opus', effort: 'high',
       status: 'done', ago: 62, taskId: 'ag3', unread: true,
       messages: [
         {id: 'm1', role: 'user', text: 'Rename the 4 chapters — shorter, and make them sound like a podcast rundown.', ...turnDone(70, 22)},
         {id: 'm2', role: 'assistant', text: 'Reading the chapter table and the first paragraph of each. I will propose titles first; nothing is written until you approve.'},
         {id: 'm3', role: 'tool', cmd: 'bcut project info project.bcut', status: 'done', took: '0.2s'},
         {id: 'm4', role: 'assistant', text: 'Proposal: Cold open / Why local / How rendering works / What is next. Apply?'},
         {id: 'm5', role: 'user', text: 'Go.', ...turnDone(62, 15)},
         {id: 'm6', role: 'permission', cmd: 'bcut chapters project.bcut --rename', state: 'allowed', why: 'Rewrites 4 chapter titles; boundaries and ids stay. Undoable as one step.'},
         {id: 'm7', role: 'tool', cmd: 'bcut chapters project.bcut --rename', status: 'done', took: '0.4s'},
         {id: 'm8', role: 'receipt', text: 'Applied · 4 titles rewritten · 0.4s', taskId: 'ag3'},
       ]},
      {id: 's4', title: '这批采访素材怎么批量加字幕', project: null, harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'idle', ago: 60 * 26, pinned: true,
       messages: [
         {id: 'm1', role: 'user', text: '我有 12 段采访素材在 ~/Movies/访谈/，都要加中文字幕和英文译文，怎么批量做？', ...turnDone(60 * 26, 19)},
         {id: 'm2', role: 'assistant', text: '可以一条命令跑完：每个文件 `bcut auto <文件> --translate en`，**串行**跑（本机一次只能占一个语音模型槽）。12 段按平均 20 分钟算，大约 40 分钟。\n\n```sh\nfor f in ~/Movies/访谈/*.mp4; do\n  bcut auto "$f" --translate en\ndone\n```\n\n> 跑的时候别合上电脑：睡眠会让当前那一段从头再来。\n\n两个问题先确认：\n\n1. 说话人要不要识别？\n2. 目录里有 3 个 .mov，要不要一起？'},
       ]},
      /* 登录过期的那一轮（2026-09-20）：凭据在会话开着的时候过期，CLI 只会把那句话
         作为**这一轮的失败详情**送回来。线程里要能就地把登录做完，见 §17.2。 */
      {id: 's14', title: '帮我做一版手绘风格的儿童故事视频', project: null, harness: 'claude', model: 'opus', effort: 'mid',
       status: 'idle', ago: 8,
       messages: [
         {id: 'm1', role: 'user', text: '帮我做一版手绘风格的儿童故事视频：狼来了', ...turnDone(8, 3)},
         {id: 'm2', role: 'assistant', text: '', error: 'Failed to authenticate: OAuth session expired and could not be refreshed'},
       ]},
      /* 默认模型需要更新的 CLI（2026-09-29）：会话选的是「Agent 默认模型」，BaoCut 不传模型，旧版 codex 照共用配置
         发出 gpt-6-sol，服务端拒绝。失败详情下面的恢复区给「升级 / 改用推荐模型重新发送」，见 §17.2。
         在 设置 › Agent 的演示场景里切到「默认模型需升级」再打开它，composer 上方的预检提示也会一起出现。
         2026-10-01：它在「客户访谈」项目里（`dir`），还没打开哪一部视频——Home 侧栏里这个项目就带一枚「失败」。 */
      {id: 's15', title: '把这段采访剪成 3 分钟精华', project: null, dir: 'd4', harness: 'codex', model: null, effort: 'mid',
       status: 'idle', ago: 12,
       messages: [
         {id: 'm1', role: 'user', text: '把这段采访剪成 3 分钟精华，保留她讲创业第一年的那几段。', ...turnDone(12, 2)},
         {id: 'm2', role: 'assistant', text: '', error: "The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account."},
       ]},
      /* 等你批准的一条（2026-10-01）：写入卡停在 pending，计划随消息带着（和 store 里 sendAgent 落下的形状一致），
         点「允许」照常跑完。它让「新品发布」项目带上「等待批准」。 */
      {id: 's16', title: '把发布会主视频切成 3 条竖版预告', project: 'p2', harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'waiting', ago: 6,
       messages: [
         {id: 'm1', role: 'user', text: '等转录完，把发布会主视频切成 3 条竖版预告，每条 30 秒左右。', ...turnLive(380)},
         {id: 'm2', role: 'assistant', text: '转录到 45% 了。我先在已经转出来的部分里找能独立成立的几段话，候选写进候选库，你挑完才会建视频。写入前先问你。'},
         {id: 'm3', role: 'tool', cmd: 'bcut project info project.bcut', status: 'done', took: '0.2s', out: 'duration 52:00 · 转录 45% · 1 位说话人'},
         {id: 'm4', role: 'permission', cmd: 'bcut shorts find project.bcut --count 3 --ratio 9:16', state: 'pending',
          why: '只写候选库（shorts/candidates.json），不创建视频，也不动时间轴和文稿。',
          plan: {kind: 'shortscut',
            write: {cmd: 'bcut shorts find project.bcut --count 3 --ratio 9:16', why: '只写候选库（shorts/candidates.json），不创建视频，也不动时间轴和文稿。'},
            task: {kind: 'shorts-cut', title: '剪成短视频 · 找片段'},
            receipt: '已写入候选库 · 3 段候选 · 6.1s',
            close: '找好了 3 段，都落在句子边界上。到右侧的「剪成短视频」面板里挑、调起止，确认后才会建视频。'}},
       ]},
      /* 只在项目目录里、还没有视频的会话（2026-10-01）：「产品手册动画」项目只有插图和文档。 */
      {id: 's17', title: '产品手册的插图做成 40 秒动画', project: null, dir: 'd8', harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'done', ago: 35, unread: true,
       messages: [
         {id: 'm1', role: 'user', text: '目录里有手册的 6 张插图，做成一条 40 秒的产品动画，先给我分镜。', ...turnDone(35, 74)},
         /* 工具步骤行的几种样子：读目录（有输出）、搜索（没有输出）、改文件（输出是 unified diff，展开后按行上色）、
            一条失败的命令（退出码 1，展开后多一段错误）。两次改的是同一个文件，组头按去重后的路径数说「修改了 1 个文件」 */
         {id: 'm2', role: 'tool', kind: 'read', summary: '插图/', cmd: '读取 插图/ · 6 张 PNG', status: 'done', took: '0.1s',
          out: '01-开箱.png\n02-接口.png\n03-指示灯.png\n04-配对.png\n05-充电.png\n06-收纳.png'},
         {id: 'm3', role: 'tool', kind: 'search', summary: '分镜', cmd: 'rg --files -g "*分镜*"', status: 'done', took: '0.1s'},
         {id: 'm4', role: 'tool', kind: 'edit', summary: '分镜.md', cmd: '新建 分镜.md', status: 'done', took: '0.2s',
          out: '--- /dev/null\n+++ b/分镜.md\n@@ -0,0 +1,6 @@\n+# 产品动画分镜\n+\n+| 镜头 | 时长 | 插图 |\n+| --- | --- | --- |\n+| 开箱 | 8s | 01-开箱.png |\n+| 接口 | 10s | 02-接口.png |'},
         {id: 'm5', role: 'tool', kind: 'command', cmd: 'bcut storyboard check 分镜.md', status: 'fail', exitCode: 1, took: '0.4s',
          error: 'storyboard check: 第 4 行的镜头总时长 18s，少于目标 40s'},
         {id: 'm6', role: 'tool', kind: 'edit', summary: '分镜.md', cmd: '修改 分镜.md', status: 'done', took: '0.1s',
          out: '--- a/分镜.md\n+++ b/分镜.md\n@@ -5,2 +5,4 @@\n | 开箱 | 8s | 01-开箱.png |\n-| 接口 | 10s | 02-接口.png |\n+| 接口 | 12s | 02-接口.png |\n+| 指示灯与配对 | 10s | 03-指示灯.png、04-配对.png |\n+| 充电与收纳 | 10s | 05-充电.png、06-收纳.png |'},
         {id: 'm7', role: 'assistant', text: '分镜写好了，放在项目目录的 `./分镜.md`，在 Space 里能看到。一共 **4 个镜头**，合计 40 秒：\n\n| 镜头 | 时长 | 插图 |\n| --- | :---: | --- |\n| 开箱 | 8s | `插图/01-开箱.png` |\n| 接口 | 12s | `插图/02-接口.png` |\n| 指示灯与配对 | 10s | 03、04 |\n| 充电与收纳 | 10s | 05、06 |\n\n第一次检查时总时长不够（~~18 秒~~），补了后两个镜头再查就过了。你确认以后，我再按它建一部视频。\n\n制作资料：[制作简报 PDF](制作简报.pdf) · [交付报告 HTML](交付报告.html) · [镜头清单 CSV](镜头清单.csv) · [字幕对照 TSV](字幕对照.tsv) · [交付规格 JSON](交付规格.json) · [检查时长 Python](检查时长.py)。点击在右侧标签页查看。\n\n文件回退：[未知后缀文本](说明.abc) · [无扩展名文本](README) · [未知二进制](模型.bin) · [过大文件](日志.unknown) · [文件不存在](已移走.abc)。\n\n封面候选（缩略图切换，点击大图放大查看）：\n\n![封面候选 A](封面/候选-a.svg)\n\n也可以[打开独立图片](封面/独立图片.svg)、[查看 GIF 分帧](动效分帧.gif)，或[查看 360° 全景](山谷全景.svg)。\n\n音频预览：\n\n![音频播放示例](音频/audio_preview_demo.wav)\n\n动效预览：\n\n![色块动效](导出/色块动效.webm)'},
       ]},
      /* 会话里的视频卡（product-design §4.2）：BaoCut 工具调用的步骤行（model-agent-tools.js）后面挂当次视频的卡，
         一件活一行，读上面 ag18* / ag19* / ag20* 的任务记录。视频卡一条会话一部视频一张，
         挂在最后一条引用它的消息（任务落在这部视频上的工具行，或收据）后面、有新引用就挪过去，列这条会话在它上面的全部活。
         s18 转录、翻译、导出同时在跑（旁白与封面只在步骤行上带百分比）；先发的一次导出分辨率设错、已取消，
         视频卡摊开在跑的三件，那一件收在「之前的 1 项」里（已取消不算待处理，这一行不写「N 项待处理」），
         s19 两轮都跑完了：第一轮转录（旁白与封面是候选卡），第二轮翻译 + 三次导出，卡挪到第二轮最后的收据后面
         （只摊开最后的成片导出：结果事实、「播放 / 在文件夹中显示」；第一轮的转录连同之前的三件收在「之前的 4 项」里；收据条照常带撤销），
         s20 都没成（重新转录与翻译可重试、导出已取消；旁白与封面的失败留在步骤行，展开有去处）。
         s20 的视频卡只摊开最后结束的导出（已取消），可重试的两件收在「之前的 2 项」里，那一行写「2 项待处理」（foldRows 的 pending）。 */
      {id: 's18', title: '发布前把这一期的活一起做了', project: 'p10', harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'running', ago: 4, taskId: 'ag18t',
       messages: [
         {id: 'm1', role: 'user', text: '发布前把这一期的活一起做了：第二段访谈转录，已有的文稿翻成英语，导出一版 1080p 预览，片头配一句旁白，再出两张竖版封面。', ...turnLive(252)},
         {id: 'm2', role: 'assistant', text: '这五件互不依赖，我一起开始。转录跑在本机；旁白和封面走云端的星河云。译文写进视频、导出都不动原片，哪一件都可以单独取消。'},
         {id: 'm3', role: 'tool', tool: 'videos_inspect', args: {video: '综合制作 · 播客精剪'}, status: 'done', took: '0.2s', out: '2 段访谈 · 第二段 26 分钟、还没有文稿 · 1920×1080'},
         {id: 'm4', role: 'tool', tool: 'documents_read', args: {document: '文稿 · 第一段', sentences: 62}, status: 'done', took: '0.1s'},
         {id: 'm5', role: 'tool', tool: 'models_transcribe', args: {model: 'moss-transcribe', duration: 1560}, status: 'run', taskId: 'ag18t'},
         {id: 'm6', role: 'tool', tool: 'edits_apply', args: {putDocument: {schema: 'baocut.translation/2', language: '英语', units: 62}}, status: 'run', taskId: 'ag18l'},
         {id: 'm6a', role: 'tool', tool: 'exports_create', args: {resolution: '2160p', what: '预览'}, status: 'failed', took: '已取消', taskId: 'ag18c'},
         {id: 'm7', role: 'tool', tool: 'exports_create', args: {resolution: '1080p', what: '预览'}, status: 'run', taskId: 'ag18e'},
         {id: 'm8', role: 'tool', tool: 'models_synthesize_speech', args: {lines: 3, voice: '温和女声'}, status: 'run', taskId: 'ag18s'},
         {id: 'm9', role: 'tool', tool: 'models_generate_image', args: {count: 2}, status: 'run', taskId: 'ag18i'},
       ]},
      {id: 's19', title: '转录、翻译、导出，再配旁白和封面', project: 'p12', harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'done', ago: 120, unread: true,
       messages: [
         {id: 'm1', role: 'user', text: '转录这一期。片头配一句旁白，再出两张竖版封面。', ...turnDone(124, 52)},
         {id: 'm2', role: 'assistant', text: '好。转录跑在本机；旁白和封面不依赖文稿，同时开始。'},
         {id: 'm3', role: 'tool', tool: 'videos_inspect', args: {video: '为什么要把视频工具做在本机'}, status: 'done', took: '0.2s', out: '37 秒 · 1080×1920 · 1 条音轨 · 还没有文稿'},
         {id: 'm4', role: 'tool', tool: 'models_transcribe', args: {model: 'moss-transcribe', duration: 37}, status: 'done', took: '41s', taskId: 'ag19t'},
         {id: 'm5', role: 'tool', tool: 'models_synthesize_speech', args: {lines: 1, voice: '温和女声 / 干脆男声'}, status: 'done', took: '9s', taskId: 'ag19s'},
         {id: 'm6', role: 'tool', tool: 'models_generate_image', args: {count: 2}, status: 'done', took: '28s', taskId: 'ag19i'},
         {id: 'm7', role: 'receipt', text: '已写入文稿 · 10 句 · 2 位说话人', taskId: 'ag19t', movieId: 'p12'},
         {id: 'm8', role: 'assistant', text: '文稿写进视频了：10 句、2 位说话人。这台电脑没装说话人区分组件，说话人按分块里的标签保留。\n\n旁白和封面各给了两个候选，封面先替你选了 A。'},
         {id: 'm9', role: 'user', text: '翻成英语，导出竖版 1080p，带双语 SRT。', ...turnDone(120, 34)},
         {id: 'm10', role: 'assistant', text: '好。先查一下文稿里「本机」出现在哪几句，统一译法，再翻译和导出。'},
         {id: 'm11', role: 'tool', tool: 'speech_search', args: {query: '本机'}, status: 'done', took: '0.1s', out: '3 句'},
         {id: 'm12', role: 'tool', tool: 'edits_apply', args: {putDocument: {schema: 'baocut.translation/2', language: '英语', units: 10}}, status: 'done', took: '9s', taskId: 'ag19l'},
         {id: 'm12a', role: 'tool', tool: 'exports_create', args: {resolution: '1920×1080', what: '横版 MP4'}, status: 'failed', took: '已取消', taskId: 'ag19c'},
         {id: 'm12b', role: 'tool', tool: 'exports_create', args: {format: 'SRT', what: '英语字幕'}, status: 'done', took: '1s', taskId: 'ag19r'},
         {id: 'm13', role: 'tool', tool: 'exports_create', args: {resolution: '1080p', what: '竖版 MP4 + 双语 SRT'}, status: 'done', took: '22s', taskId: 'ag19e'},
         {id: 'm14', role: 'receipt', text: '已写入译文 · 英语 10 句', taskId: 'ag19l', movieId: 'p12'},
         {id: 'm15', role: 'assistant', text: '都好了。译文 10 句，有 1 句没对齐到词，在字幕 Tab 里标出来了。第一次导出的画幅设成了横版，我取消后按竖版重导了；成片、双语 SRT 和单独一份英语 SRT 都在 `out/` 里。响度比平台建议略低，要我调一下再导吗？'},
       ]},
      {id: 's20', title: '配字幕、配旁白、出封面', project: 'p5', harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'done', ago: 60,
       messages: [
         {id: 'm1', role: 'user', text: '给这条切片配字幕，再把已有的文稿翻成日语，导出竖版。片尾配一句话，再出一张封面。', ...turnDone(60, 95)},
         {id: 'm2', role: 'assistant', text: '我一起开始：转录跑在本机，翻译我自己来，旁白和封面走云端。'},
         {id: 'm3', role: 'tool', tool: 'models_transcribe', args: {model: 'moss-transcribe', duration: 42}, status: 'failed', took: '16s', taskId: 'ag20t',
          error: '语音模型进程意外退出（内存不足）'},
         {id: 'm4', role: 'tool', tool: 'edits_apply', args: {putDocument: {schema: 'baocut.translation/2', language: '日语', units: 12}}, status: 'failed', took: '8s', taskId: 'ag20l',
          error: 'STALE_JOB_INPUT：译文写入前，原文又被改过 2 句'},
         {id: 'm5', role: 'tool', tool: 'exports_create', args: {resolution: '1080×1920', what: '竖版'}, status: 'failed', took: '已取消', taskId: 'ag20e'},
         {id: 'm6', role: 'tool', tool: 'models_synthesize_speech', args: {lines: 1}, status: 'failed', took: '0.6s', taskId: 'ag20s',
          error: 'PROVIDER_AUTH_FAILED：星河云的登录已过期'},
         {id: 'm7', role: 'tool', tool: 'models_generate_image', args: {count: 1}, status: 'failed', took: '0.1s', taskId: 'ag20i',
          error: 'CAPABILITY_NOT_CONFIGURED：还没有可用的图片生成模型'},
         {id: 'm8', role: 'assistant', text: '这一轮一件都没成，视频卡里写了每一件的原因，旁白和封面的去处在步骤里：\n\n- 重新转录：语音模型内存不足退出了，原来的文稿没动；关掉占内存的程序后点「重试」。\n- 翻译：写入前你又改了 2 句原文，按当前版本重试就行。\n- 导出：你取消了。\n- 旁白：星河云的登录过期了，重新登录后再来。\n- 封面：还没启用图片生成模型。'},
       ]},
      /* 下载（product-design §4.2）：链接里的视频还没建，步骤行后面是一张下载卡；下完同一个位置换成视频卡。
         s21 正在下（打开这条会话才开始走，演示里几秒就下完，接着转录），s22 在 34% 断了（点「重试」从断点接着下）。 */
      {id: 's21', title: '把发布会回放下载下来转录', project: null, dir: 'd6', harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'running', ago: 1, taskId: 'ag21d',
       messages: [
         {id: 'm1', role: 'user', text: '把这条发布会回放下载下来，转录一下：https://lanshan.example/v/spring-launch-replay', ...turnLive(14)},
         {id: 'm2', role: 'assistant', text: '这条链接里的视频还不在项目里。我先把它下载下来；下载完会在项目里建一部视频，接着用本机语音模型转录。视频一建好你就能打开编辑器，不用等转录。'},
         {id: 'm3', role: 'tool', tool: 'downloads_fetch', args: {site: 'lanshan.example', name: 'spring-launch-replay.mp4'}, status: 'run', taskId: 'ag21d'},
       ]},
      {id: 's22', title: '下载这条访谈', project: null, dir: 'd4', harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'idle', ago: 20,
       messages: [
         {id: 'm1', role: 'user', text: '下载这条访谈：https://qingtai.example/watch/founder-interview-full', ...turnDone(20, 22)},
         {id: 'm2', role: 'assistant', text: '这条链接里的视频还不在项目里。我先把它下载下来；下载完会在项目里建一部视频，接着用本机语音模型转录。'},
         {id: 'm3', role: 'tool', tool: 'downloads_fetch', args: {site: 'qingtai.example', name: 'founder-interview-full.mp4'}, status: 'failed', took: '16s', taskId: 'ag22d',
          error: '连接中断了（已下 34%）'},
         {id: 'm4', role: 'assistant', text: '下载在 34% 断了：连接中断了。检查网络后点下载卡上的「重试」，会从断点接着下。'},
       ]},
      /* 边转边问：转录在后台跑，Agent 问了一句就收掉这一轮；用户回话时转录还没完，视频卡跟到新的一轮（ag23t） */
      {id: 's23', title: '转录这支预告片', project: 'p11', harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'idle', ago: 1,
       messages: [
         {id: 'm1', role: 'user', text: '转录这支预告片，要出字幕。', ...turnDone(1, 18)},
         {id: 'm2', role: 'assistant', text: '好。先看一眼音轨，再用本机的 MOSS Transcribe 转录，转完写进视频的文稿。'},
         {id: 'm3', role: 'tool', tool: 'videos_inspect', args: {video: 'Sintel · 预告片剪辑'}, status: 'done', took: '0.2s', out: '52 秒 · 854×480 · 1 条音轨 · 英语对白 · 还没有文稿'},
         {id: 'm4', role: 'tool', tool: 'models_transcribe', args: {model: 'moss-transcribe', duration: 52}, status: 'run', taskId: 'ag23t'},
         {id: 'm5', role: 'assistant', text: '转录在后台跑，还要一会儿。先问一句：字幕要按说话人分开标出来，还是只要一条字幕？'},
       ]},
      /* 智能体自己翻译（ag24l）：读文稿时声明目标语，在这一轮里逐句翻，译完一次写进视频 */
      {id: 's24', title: '把这条口播翻成英语字幕', project: 'p13', harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'running', ago: 1,
       messages: [
         {id: 'm1', role: 'user', text: '把这条口播翻成英语字幕。', ...turnLive(52)},
         {id: 'm2', role: 'assistant', text: '好。文稿 62 句，我直接逐句翻，译完一次写成英语译文，再按译文出字幕。'},
         {id: 'm3', role: 'tool', tool: 'documents_read', args: {document: '文稿', sentences: 62, translateTo: 'en'}, status: 'done', took: '0.1s', taskId: 'ag24l'},
       ]},
      /* 未绑定项目的会话再补 7 条：侧栏这一段首屏只露 5 条、每次再加载 5 条，少于 6 条演示不出来 */
      {id: 's7', title: '把 3 段竖屏素材拼成一条 60 秒短片', project: null, harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'done', ago: 1800,
       messages: [{id: 'm1', role: 'user', text: '把 3 段竖屏素材拼成一条 60 秒短片'}]},
      {id: 's8', title: '字幕里的英文人名要不要保留原文', project: null, harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'idle', ago: 3000,
       messages: [{id: 'm1', role: 'user', text: '字幕里的英文人名要不要保留原文'}]},
      {id: 's9', title: '导出给视频号用什么码率合适', project: null, harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'idle', ago: 4320,
       messages: [{id: 'm1', role: 'user', text: '导出给视频号用什么码率合适'}]},
      {id: 's10', title: '本机能同时跑几个转录任务', project: null, harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'done', ago: 5760,
       messages: [{id: 'm1', role: 'user', text: '本机能同时跑几个转录任务'}]},
      {id: 's11', title: '访谈里的口头禅怎么批量删掉', project: null, harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'idle', ago: 7200,
       messages: [{id: 'm1', role: 'user', text: '访谈里的口头禅怎么批量删掉'}]},
      {id: 's12', title: '双语字幕的译文行放在上面还是下面', project: null, harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'idle', ago: 10080,
       messages: [{id: 'm1', role: 'user', text: '双语字幕的译文行放在上面还是下面'}]},
      {id: 's13', title: '把一期播客切成 5 条短视频的思路', project: null, harness: 'claude', model: 'sonnet', effort: 'mid',
       status: 'done', ago: 14400,
       messages: [{id: 'm1', role: 'user', text: '把一期播客切成 5 条短视频的思路'}]},
    ],
  };

  /* ---------- 远端算力（§17.3；docs/design/speech/bcut-remote-transcribe-design.md） ----------
     音频只在局域网内传输，只有 transcript 回来。 */
  const remote = {
    paired: [
      /* `ttsModels` 是节点报得出的配音模型（`bcut remote models <alias>` 扫出来的）：
         缺这个字段表示还没扫过，与「扫过、一个都没有」不是一回事，所以 meta 也
         只有报过的节点才分成转录 / 配音两段说。 */
      /* 2026-09-27：节点报 `tasks`（开放的任务类）与 `taskModels`（按任务的就绪模型）后，
         meta 的任务那一截由 `BC_SERVICES.nodeTaskMeta` 算；没报的旧节点（n2）meta 保留旧写法。 */
      {id: 'n1', name: 'mac-studio.local', addr: '192.168.1.10:24350',
       meta: 'Apple Silicon · MLX · bcut 1.12', state: 'online',
       ttsModels: ['index-tts2.5', 'gpt-sovits-v2'],
       tasks: ['asr', 'tts', 'image', 'separate', 'download', 'export'],
       taskModels: {asr: ['moss-transcribe', 'whisper-large-v3', 'qwen3-asr-0.6b'],
         tts: ['index-tts2.5', 'gpt-sovits-v2'], image: ['qwen-image-2.1'], separate: ['htdemucs-ft']},
       exportSpeed: 2.4},  // 导出编码速度是这台 Mac 的几倍（节点 healthz 报；原型给一个演示值）
      {id: 'n2', name: 'older-imac.local', addr: '192.168.1.18:24350',
       meta: 'Intel · bcut 1.09 · 1 个模型', state: 'offline'},
    ],
    nearby: [
      {id: 'n3', name: 'jim-macbook.local', meta: 'Apple Silicon'},
    ],
    share: {
      nodeName: '这台 Mac Studio', addr: '192.168.1.23:24350', code: '481 924',
      models: ['moss-transcribe', 'whisper-large-v3'],
      /* 2026-09-17：共享的不只是转录了，配音也在这台节点上跑（§17.3），
         所以两类模型分两行列——对方的「在哪儿跑」候选就取自这一份。 */
      ttsModels: ['index-tts2.5', 'gpt-sovits-v2'],
      /* 2026-09-27：任务目录扩到出图 / 分离 / 下载 / 导出（bcut-remote-compute-jobs-design.md）。
         按任务的就绪模型；图像模型故意留空，演示「没装就不许开」那一行。 */
      taskModels: {asr: ['moss-transcribe', 'whisper-large-v3'], tts: ['index-tts2.5', 'gpt-sovits-v2'],
        image: [], separate: ['htdemucs-ft']},
      /* 配对码缺省开（`worker.pairMode=required`），可以关 */
      requireCode: true,
      jobs: 2, activity: '空闲',
      peers: [{name: 'jim-macbook', seen: '2 分钟前'}],
    },
  };

  /* ---------- Agent skill 页（§17.3） ---------- */
  /* Agent 目录（第 121 轮）：会话的工作目录**不是项目包**，而是 App 按项目建的一个
     scratch 目录。内置指令（AGENTS.md）与指向 canonical skill 的链接都在这里，每次
     会话开始前幂等重生成。下面 `contextDoc` 是渲染后的**示例**全文，供设置页的
     「复制内置指令」按钮拷出去——真产品里它随当前项目的事实替换占位。 */
  const agentDir = '~/Library/Application Support/BaoCut/agent/p1';
  const contextDoc = [
    '<!-- 这份文件由 BaoCut 在每次会话开始前生成，请勿手改。 -->',
    '',
    '你正运行在 BaoCut 里——一个桌面视频 / 字幕应用。这次对话是用户从 BaoCut 的界面里',
    '发起的，不是从终端。下面是宿主对环境的自述，它覆盖任何关于「我在哪、该装什么」的',
    '通用假设。',
    '',
    '## 1. 会话与视频',
    '',
    '- 工作目录：' + agentDir + '。这是 BaoCut 为本次会话建的 scratch 目录，',
    '  **不是视频**。写在这里的东西不属于用户的成果，只用来放你本来要记在脑子里的笔记。',
    '- 视频是 BaoCut 包「科浪访谈 第 42 期：本地优先的视频工具」，位于',
    '  ~/Movies/播客/kelang-ep42.bcut。它已经存在、已经登记，本次会话已获授权。',
    '  不要新建视频，不要去找什么共享视频库，不要 cd 到别处。$BAOCUT_PROJECT 是同一个路径。',
    '- 媒体：视频 ~/Movies/播客/kelang-ep42-master.mp4，时长 3:26。',
    '- 源语言：中文。转录已就绪：是。记录在案的转录引擎：moss-transcribe。',
    '- 一条会话只绑一部视频。用户要问别的视频，直说，请他从那部视频开一条新会话。',
    '',
    '## 2. 工具',
    '',
    '- BaoCut CLI 是 /Applications/BaoCut.app/Contents/MacOS/bcut，spec 版本 1.32.0。',
    '  它同时在 PATH 上叫 bcut，$BAOCUT_CLI 指向同一个二进制。永远不要自己下载、编译或',
    '  安装 CLI——这一个是 App 钉死的。',
    '- 动手之前先跑一次 bcut --json spec，看这个构建真正暴露的命令面，别按旧版本推断。',
    '- 一律带 --json（流式работ用 --jsonl）。每个响应都是信封 {status, project, changed,',
    '  next, data}。退出码：0 成功，1 错误，2 质量门，3 版本 / spec 契约。遇到 kind:"busy"',
    '  就等一下重试同一条命令，不要绕开。',
    '- 每条碰视频的命令都显式带视频路径，不要依赖工作目录。',
    '- 密钥永远不上命令行：bcut key 只从 stdin 读。',
    '',
    '## 3. Skill',
    '',
    '- baocut skill 已链接进本工作目录的 .agents/skills/baocut（真身在 ~/.claude/skills/baocut，',
    '  v1.4.2）。SKILL.md 与它的 references/ 是每一条 BaoCut 工作流的唯一真相：**动手前**',
    '  先读你要跑的那一段。',
    '- 因为你由 App 托管（BAOCUT_HOST=baocut-app），跳过该 skill 的三部分：① 启动版本门与',
    '  升级流程；② CLI 解析 / 缓存 / 下载一节（用 $BAOCUT_CLI）；③ 共享视频库一节（视频已在上面写明）。',
    '- 不要启动或重启 bcut serve。预览服务由 App 管，你产出的结果它会实时显示给用户。',
    '',
    '## 4. 视频数据的硬规矩',
    '',
    '- transcript.json 的 words[] 是文本与时间的唯一持久真相，Cue / 句 / 段都是派生投影。',
    '- 永远不要手改词原子、阶段戳、指纹、trans、transAlign，也不要手改 timeline.json 与',
    '  studio/data.json。每一次写入都走 bcut 命令。',
    '- 翻译对齐先按目标语冻结译文显示块，再映射到连续的原文词区间；原文 Cue 与 breaks 不参与。',
    '- 带 --review 跑出来的是候选稿不是结果，bcut review accept 之前它没有生效——告诉用户还有什么挂着。',
    '- 收工前跑 bcut check --strict 并如实报告。退出码 2 表示质量门没过：修它或者解释它，别藏。',
    '- 永远不要删除或移动用户的媒体文件。',
    '',
    '## 5. AI 阶段',
    '',
    '- 打算自己回答的 AI 阶段，显式传 --llm agent。CLI 会写出请求文件并等待，你用',
    '  bcut task claim / bcut task submit 这一对应答环回答，细节见 references/agent-tasks.md。',
    '- 短素材走那份参考里的快路径：BCUT_LLM_MAX_WORKERS=1 串行，一个后台生产者、一个应答环。',
    '- 不要为这个循环开子 Agent，也不要自己造记账表——bcut task status --json 已经有了。',
    '',
    '## 6. 权限与举止',
    '',
    '- 你每一条可能写视频的命令，App 都会先给用户一张放行卡。所以：动手前用一句话说清你要',
    '  跑什么、为什么；相关的写入尽量合并成尽量少的命令；永远不要绕过这道问（不要 sh -c、',
    '  不要命令替换、不要直接写视频文件来躲开 CLI）。',
    '- 只读命令自动放行，看东西不用请示。',
    '- 每次写入之后 App 会实时刷新并记下一条可撤销的收据，用户已经看得到结果。不要开浏览器、',
    '  不要起服务、不要把整份文稿打印出来证明你干了活。',
    '- 回话保持简短。收工时报告改了什么、还有什么等着审阅、哪几行需要人再看一眼。',
    '',
    '用简体中文回复用户。',
  ].join('\n');
  const skill = {
    agentDir,
    contextDoc,
    // 检测到的 agent 见 agent.harnesses（第 109 轮合并：同一次探测，不存两份）
    commands: [
      {cmd: 'bcut auto <媒体>', desc: '转录 → 润色 → 分段 → 章节，一条龙'},
      {cmd: 'bcut translate --to en', desc: '翻译并自动对齐时间轴'},
      {cmd: 'bcut cleanup --review', desc: '出剪辑建议，留到 App 里逐条审阅'},
      {cmd: 'bcut export --to mp4', desc: '导出成片（可烧录字幕）'},
    ],
    /* 能力目录（2026-10-01）：skills/baocut/workflows.json 的 catalog[] 的演示副本——App 从装着的 skill 里现读，
       这里只抄 id / name / commands；desc 是设置页那一句话（App 的 settings.skills.catalog.<id>_desc）。 */
    catalog: [
      {id: 'project', name: '视频与素材', desc: '建视频、导入或下载媒体、画布、历史与撤销', commands: ['project', 'source', 'stock', 'waveform', 'spectrum', 'upgrade-baocut', 'migrate']},
      {id: 'subtitle', name: '转录、字幕与翻译', desc: '转录、润色、分章、说话人、翻译与对齐', commands: ['auto', 'transcribe', 'polish', 'segment', 'translate', 'refine-align', 'chapters', 'speakers', 'transcript', 'review', 'task', 'screentext', 'studio']},
      {id: 'writing', name: '写作与发布', desc: '摘要、博客、标题、简介与封面', commands: ['ai', 'cover']},
      {id: 'cut', name: '剪辑与时间轴', desc: '剪口、片段编排、变速、切 Shorts、跟拍重构图', commands: ['cleanup', 'cut', 'clip', 'edit', 'shorts']},
      {id: 'layers', name: '元素与画面', desc: '文字、贴图、B-roll、水印、贴纸、动画、模板、品牌库、生成图片', commands: ['element', 'broll', 'watermark', 'sticker', 'animation', 'template', 'brand', 'image', 'whiteboard', 'frames']},
      {id: 'voice', name: '配音与声音', desc: '文本转语音、我的声音、翻译配音、人声分离、配乐与音效', commands: ['tts', 'voice', 'dub', 'separate', 'beats', 'events', 'score', 'sfx', 'music', 'sound']},
      {id: 'film', name: '视频创作', desc: '从题目、文稿、图片、音频或数据做一支片子：分镜、逐镜实现、成片', commands: ['lint', 'probe', 'compile', 'storyboard', 'sheet', 'render', 'bake', 'ssim', 'compare', 'ops']},
      {id: 'deliver', name: '检查与导出', desc: '质量检查；导出字幕、视频、音频或剪辑工程；取帧', commands: ['check', 'export']},
      {id: 'system', name: '环境与服务', desc: '体检、模型、密钥、后台任务、远端算力、Web 编辑器、MCP、版本', commands: ['version', 'spec', 'doctor', 'model', 'key', 'config', 'jobs', 'serve', 'mcp', 'remote', 'worker']},
    ],
  };

  /* ---------- 服务（§17.6，2026-09-17）：MCP / Web 两页的监控演示数据 ----------
     客户端名不用真实品牌；演示调用在 model-mcp-tools.js 的 DEMO（走同一份工具目录与校验）。 */
  const services = {
    mcp: {
      clients: [{id: 'c1', name: '桌面 AI 助手', since: '刚刚', calls: 3}],
    },
    web: {
      sessions: [{id: 'b1', browser: '浏览器标签页', page: '编辑器', ago: '2 分钟前'}],
    },
  };

  /* ---------- Settings 数据（§17.3；第 25 轮对齐 Mac 设置窗） ----------
     仓名、体积、目录价、docs 域名都是真值。deps 是 M99 那条「隐藏依赖显式化」：
     一个语音模型要跑起来，除了权重还要 forced aligner 与 VAD，缺件要说出来。 */
  /* 本地模型（2026-09-13 分类重排，§17.3）：权重体积、仓库与依赖照 core/crates/bcut-models/src/catalog.rs。
     `uses` 是这只模型要的组件（`setComponents` 的 id）；同一分类里两只以上声明的组件由
     BC_LOCALMODELS.layout 放到分类顶部「公共组件」，只有一只用的留在那只模型的依赖子行。
     id 沿用原型旧名（BC_TTS.MODELS / PACE_SEED 以它为键），不追真实 catalog id。
     `license`（{name, url, commercialUse, summary}）照 packages/models 的模型包登记逐字抄：详情「许可」行列它
     （BC_LOCALMODELS.licenseLines）；`commercialUse: false` 的行另标「仅限非商用」、下载前弹确认。
     登记里没有许可的不写（画面理解三件）。说话人区分包的许可是登记给整包的（Pyannote 分段的 MIT），声纹嵌入另列；
     Qwen-Image-2.1 登记为不可商用，与 OmniVoice 一样标「仅限非商用」、下载前弹确认。 */
  const QWEN3_ASR_LICENSE = {name: 'Apache-2.0', url: 'https://huggingface.co/Qwen/Qwen3-ASR-1.7B', commercialUse: true,
    summary: '上游 Qwen3-ASR 模型卡标 Apache-2.0，可商用；MLX 量化包沿用同一许可'};
  const QWEN3_TTS_LICENSE = {name: 'Apache-2.0', url: 'https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base', commercialUse: true,
    summary: '上游 Qwen3-TTS 模型卡标 Apache-2.0，可商用；MLX 转换包沿用同一许可'};
  const INDEX_TTS_LICENSE = {name: 'bilibili Model Use License Agreement', commercialUse: true,
    summary: '可商用，但上月月活超 1 亿或上年营收超 10 亿元人民币的主体须另向 bilibili 申请；分发须附协议原文'};
  const setModels = [
    {id: 'moss-transcribe', name: 'MOSS Transcribe', size: 1748, installed: true, dflt: true,
     note: '转录同时区分说话人', repo: 'OpenMOSS-Team/MOSS-Transcribe-Diarize', uses: ['wespeaker'],
     license: {name: 'Apache-2.0', url: 'https://huggingface.co/OpenMOSS-Team/MOSS-Transcribe-Diarize', commercialUse: true,
       summary: '上游模型卡标 Apache-2.0，可商用'}},
    {id: 'qwen3-asr-0.6b', name: 'Qwen3-ASR 0.6B', size: 680, installed: true,
     repo: 'aufklarer/Qwen3-ASR-0.6B-MLX-4bit', uses: ['vad', 'aligner'],
     license: Object.assign({}, QWEN3_ASR_LICENSE, {url: 'https://huggingface.co/Qwen/Qwen3-ASR-0.6B'})},
    {id: 'qwen3-asr-1.7b', name: 'Qwen3-ASR 1.7B', size: 2355, installed: false,
     repo: 'aufklarer/Qwen3-ASR-1.7B-MLX-8bit', uses: ['vad', 'aligner'], license: QWEN3_ASR_LICENSE},
    {id: 'whisper-large-v3', name: 'Whisper large-v3', size: 947, installed: true,
     repo: 'argmaxinc/whisperkit-coreml', uses: ['vad', 'aligner', 'whisper-tokenizer'],
     license: {name: 'Apache-2.0', url: 'https://huggingface.co/openai/whisper-large-v3', commercialUse: true,
       summary: '上游 openai/whisper-large-v3 模型卡标 Apache-2.0，可商用；WhisperKit 的 CoreML 转换仓库标 MIT'}},
    {id: 'whisper-turbo', name: 'Whisper large-v3 turbo', size: 1536, installed: false,
     repo: 'aufklarer/Whisper-Large-v3-Turbo-CoreML', uses: ['vad', 'aligner', 'whisper-tokenizer'],
     license: {name: 'MIT', url: 'https://huggingface.co/openai/whisper-large-v3-turbo', commercialUse: true,
       summary: '上游 openai/whisper-large-v3-turbo 模型卡标 MIT，可商用；CoreML 转换包同为 MIT'}},
    /* 说话人区分包：Pyannote 分段是它自己的权重，声纹嵌入与 MOSS 共用；MOSS 自带区分不需要它 */
    {id: 'speaker-diarization', name: '说话人区分', size: 5.7, installed: false, pack: true,
     note: '给不自带区分的模型用 · MOSS 不需要', repo: 'aufklarer/Pyannote-Segmentation-MLX', uses: ['wespeaker'],
     license: {name: 'MIT', url: 'https://huggingface.co/pyannote/segmentation-3.0', commercialUse: true,
       summary: '上游 pyannote/segmentation-3.0 标 MIT，可商用；声纹模型 WeSpeaker 另标 CC-BY-4.0（须署名 WeSpeaker 与 pyannote.audio）'}},
    /* 语音合成：五只 Qwen3-TTS（0.6B 有 CustomVoice 与 Base；1.7B 再加 VoiceDesign，2026-09-26 恢复）共用 12Hz 语音编解码器；
       IndexTTS 2.5 从 IndexTTS2 仓库补一层辅助件，只有它用，所以跟着它的行走；IndexTTS2 的辅助件本来就在自己的仓库里。
       VoxCPM2 / OmniVoice（2026-09-26）各自一个仓库、没有共享组件。不能商用的（`license.commercialUse: false`，目前只有
       OmniVoice）设置行标「仅限非商用」，第一次下载前弹确认。 */
    {id: 'qwen3-tts-0.6b-customvoice', name: 'Qwen3-TTS 0.6B CustomVoice', cat: 'tts', size: 1732, installed: true,
     note: '9 个预设音色 · 可用一句话指定风格', repo: 'aufklarer/Qwen3-TTS-12Hz-0.6B-CustomVoice-MLX-bf16', uses: ['tts-codec'],
     license: QWEN3_TTS_LICENSE},
    {id: 'qwen3-tts-0.6b-base', name: 'Qwen3-TTS 0.6B Base', cat: 'tts', size: 1249, installed: true,
     note: '3 秒参考音频克隆声音 · 8 bit', repo: 'aufklarer/Qwen3-TTS-12Hz-0.6B-Base-MLX-8bit', uses: ['tts-codec'],
     license: QWEN3_TTS_LICENSE},
    {id: 'qwen3-tts-1.7b-customvoice', name: 'Qwen3-TTS 1.7B CustomVoice', cat: 'tts', size: 2287, installed: false,
     note: '9 个预设音色 · 可用一句话指定风格 · 更大更慢 · 8 bit', repo: 'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit', uses: ['tts-codec'],
     license: QWEN3_TTS_LICENSE},
    {id: 'qwen3-tts-1.7b-base', name: 'Qwen3-TTS 1.7B Base', cat: 'tts', size: 2310, installed: false,
     note: '3 秒参考音频克隆声音 · 更大更慢 · 8 bit', repo: 'aufklarer/Qwen3-TTS-12Hz-1.7B-Base-MLX-8bit', uses: ['tts-codec'],
     license: QWEN3_TTS_LICENSE},
    {id: 'qwen3-tts-1.7b-voicedesign', name: 'Qwen3-TTS 1.7B VoiceDesign', cat: 'tts', size: 2287, installed: false,
     note: '一句话描述造一个新声音 · 不用参考音频 · 8 bit', repo: 'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit', uses: ['tts-codec'],
     license: Object.assign({}, QWEN3_TTS_LICENSE, {url: 'https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign'})},
    {id: 'indextts2', name: 'IndexTTS2', cat: 'tts', size: 3660, installed: false,
     note: '参考音频克隆 · 情绪可控 · 中 / 英', repo: 'aufklarer/IndexTTS2-MLX-fp16', uses: [],
     license: Object.assign({}, INDEX_TTS_LICENSE, {url: 'https://huggingface.co/IndexTeam/IndexTTS-2/blob/main/LICENSE.txt',
       summary: INDEX_TTS_LICENSE.summary + '；不得用它改进 IndexTTS 以外的商用模型'})},
    {id: 'index-tts2.5', name: 'IndexTTS 2.5', cat: 'tts', size: 1934, installed: false,
     note: '参考音频克隆 · 情绪可控 · 中 / 英 / 日 / 西 / 阿', repo: 'mlx-community/IndexTTS-2.5-fp16', uses: ['indextts-aux'],
     license: Object.assign({}, INDEX_TTS_LICENSE, {url: 'https://huggingface.co/IndexTeam/IndexTTS-2.5/blob/main/LICENSE',
       summary: INDEX_TTS_LICENSE.summary + '；辅助权重来自 IndexTTS2，同一协议'})},
    {id: 'gpt-sovits-v2', name: 'GPT-SoVITS v2', cat: 'tts', size: 1101, installed: false,
     note: '参考音频克隆 · 参考文本可选 · 中 / 英', repo: 'PJMixers-Dev/lj1995_GPT-SoVITS-safetensors', uses: [],
     license: {name: 'MIT', url: 'https://huggingface.co/lj1995/GPT-SoVITS', commercialUse: true,
       summary: '上游 lj1995/GPT-SoVITS 模型卡标 MIT，可商用；safetensors 转换包沿用同一许可'}},
    {id: 'voxcpm2', name: 'VoxCPM2', cat: 'tts', size: 2870, installed: false,
     note: '参考音频克隆 · 可写风格 · 30 种语言与粤语 · 48 kHz · int8', repo: 'aufklarer/VoxCPM2-MLX-int8', uses: [],
     license: {name: 'Apache-2.0', url: 'https://huggingface.co/openbmb/VoxCPM2', commercialUse: true,
       summary: '上游 openbmb/VoxCPM2 模型卡标 Apache-2.0，可商用；MLX int8 转换包沿用同一许可'}},
    {id: 'omnivoice', name: 'OmniVoice', cat: 'tts', size: 1049, installed: false,
     note: '参考音频克隆或挑选项造声 · 能按目标时长念 · 会念的语言最多 · int8', repo: 'aufklarer/OmniVoice-MLX-int8', uses: [],
     license: {name: 'CC-BY-NC-4.0', commercialUse: false, url: 'https://huggingface.co/k2-fsa/OmniVoice',
       summary: '代码 Apache-2.0，但预训练权重因训练数据（Emilia 等）以 CC-BY-NC 发布，只许非商业用途；MLX int8 转换包是它的派生物，受同一许可'}},
    /* 音源分离：翻译配音把人声和背景拆开，配音铺在背景声上 */
    {id: 'htdemucs-ft', name: 'HTDemucs-FT', cat: 'sep', size: 321, installed: false,
     note: '人声 / 背景分离 · 每窗 7.8 s', repo: 'aufklarer/HTDemucs-FT-MLX', uses: [],
     license: {name: 'MIT', url: 'https://github.com/facebookresearch/demucs/blob/main/LICENSE', commercialUse: true,
       summary: '上游 facebookresearch/demucs（代码与权重）MIT，可商用；MLX 转换包的模型卡未标许可'}},
    /* 画面理解（§15.9 智能裁剪）：三个都是开源、能在本机跑的小模型，按场景只要其中几个。
       人物定位随应用附带（体积小到可以进安装包），另外两个按需下载。 */
    {id: 'vision-person', name: '人物定位', cat: 'vision', size: 6.4, installed: true,
     note: '找出画面里的人和脸 · YuNet 人脸 + 轻量人体检测', repo: 'opencv/opencv_zoo', uses: []},
    {id: 'vision-speaker', name: '发言人判断', cat: 'vision', size: 3.5, installed: false,
     note: '对照声音判断谁在说话 · Light-ASD', repo: 'Junhua-Liao/Light-ASD', uses: []},
    {id: 'vision-content', name: '内容区域', cat: 'vision', size: 88, installed: false,
     note: '认出白板、投视频上的文字区域 · PP-OCRv5 检测头', repo: 'PaddlePaddle/PaddleOCR', uses: []},
    /* 同一 4-bit 包包含文本编码器、DiT 与 VAE；共享语音栈代码，不共享下载组件。 */
    {id: 'qwen-image-2.1', name: 'Qwen-Image-2.1', cat: 'image', size: 10035, installed: false, platform: 'macos-arm64,windows-x64,linux-x64',
     note: '文生图 · 4-bit · Apple Silicon / Windows / Linux · CPU 较慢', repo: 'mlx-community/Qwen-Image-2.1-MLX-4bit', uses: [],
     license: {name: 'Qwen RESEARCH LICENSE AGREEMENT', url: 'https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE', commercialUse: false,
       summary: '只许非商业用途（研究 / 评估），商用要向 Qwen 另行申请；MLX 包是它的派生物，受同一许可'}},
  ];
  /* 组件（catalog.rs 的 SharedDependency 与覆盖层）。`installed` 是初始盘上状态：
     Whisper 分词器缺着，让 Whisper large-v3 演示「权重在、组件缺」的半装态。
     `license` 只有登记里带了自己许可的组件写（对齐器、声纹嵌入）；声纹嵌入是 CC-BY-4.0，署名照登记逐字抄。 */
  const setComponents = [
    {id: 'vad', name: 'VAD 语音活动检测', size: 1.2, installed: true, repo: 'aufklarer/Silero-VAD-v6.2.1-MLX',
     desc: '切出有人说话的段落'},
    {id: 'aligner', name: 'Forced aligner', size: 938, installed: true, repo: 'aufklarer/Qwen3-ForcedAligner-0.6B-4bit',
     desc: '把文字对到逐词时间',
     license: {name: 'Apache-2.0', url: 'https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B', commercialUse: true,
       summary: '上游 Qwen3-ForcedAligner 模型卡标 Apache-2.0，可商用；MLX 量化包沿用同一许可'}},
    {id: 'whisper-tokenizer', name: 'Whisper 分词器', size: 3.2, installed: false, repo: 'openai/whisper-large-v3',
     desc: '覆盖层 · 两只 Whisper 共用'},
    {id: 'wespeaker', name: '声纹嵌入', size: 26.5, installed: true, repo: 'aufklarer/WeSpeaker-ResNet34-LM-MLX',
     desc: '区分谁在说话',
     license: {name: 'CC-BY-4.0', url: 'https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM', commercialUse: true,
       summary: '可商用但须署名。署名：说话人嵌入模型 wespeaker-voxceleb-resnet34-LM 出自 WeSpeaker（wenet-e2e/wespeaker；Wang 等，ICASSP 2023），' +
         '在 VoxCeleb 上训练，由 pyannote.audio（Bredin，Interspeech 2023）封装发布，许可 CC-BY-4.0；这里用的是它的 MLX 格式转换（aufklarer/WeSpeaker-ResNet34-LM-MLX）'}},
    {id: 'tts-codec', name: 'Qwen3-TTS 语音编解码器', size: 662, installed: true, repo: 'Qwen/Qwen3-TTS-Tokenizer-12Hz',
     desc: '把声学 token 还原成波形'},
    {id: 'indextts-aux', name: 'IndexTTS2 辅助件', size: 1400, installed: false, repo: 'aufklarer/IndexTTS2-MLX-fp16',
     desc: 'w2v-BERT · CAM++ · BigVGAN · 情绪特征表'},
  ];
  const setSources = [
    {id: 'auto', name: '自动', desc: '按当前网络挑最快的镜像（现在粘在 Hugging Face）'},
    {id: 'hf', name: 'Hugging Face', desc: 'huggingface.co'},
    {id: 'ms', name: 'ModelScope', desc: 'modelscope.cn · 国内通常更快'},
    {id: 'cdn', name: 'BaoCut CDN', desc: 'cdn.baocut.app'},
    {id: 'custom', name: '自定义…', desc: '填一个镜像地址'},
  ];
  const setShortcuts = [
    {grp: '全局', rows: [['新建视频', '⌘N'], ['设置…', '⌘,'], ['显示/隐藏侧边栏', '⌃⌘S']]},
    {grp: '导航', rows: [['后退', '⌘['], ['前进', '⌘]'], ['Space', '⇧⌘H'], ['后台任务', '⇧⌘B']]},
    {grp: '编辑器', rows: [['查找…', '⌘F'], ['导出…', '⌘E'], ['在播放头分割', 'S']]},
  ];
  const setCrashes = [
    {id: 'c1', when: '3 天前', ver: '0.1.0 (1)', reason: 'EXC_BAD_ACCESS · bcut-render', state: 'ready'},
    {id: 'c2', when: '上周', ver: '0.1.0 (1)', reason: 'Metal 着色器编译失败', state: 'sent'},
  ];

  /* ---------- 六入口开场（§9，round8 六态） ----------
     用户从哪个入口来，编辑器就以哪个「第一件事」开场——默认面板、Timeline、画布
     三处同时说同一句话。入口切换是**一次性重置**：默认 tab/子视图/语言/元素表
     ＋ 清除选中与弹层 ＋ 重置全部 AI flow 状态机。
     真实产品由向导路由决定；原型用顶栏「入口演示」下拉切换（原型专用控件）。 */
  const entries = [
    /* 开场停在**文稿**页：打开一个有转录稿的项目先看文稿，字幕页是从这里点进去
       的下一步（§9 第 1 行）。 */
    {k: 'sub',   name: '加字幕',     tab: 'transcript', sub: 'edit',
     canvas: 'mono',  timeline: 'subs',
     toast: '字幕已生成 · 42 句 · 点句子即可修改'},
    /* §8.3 类型 A 的交接是「关掉 sheet、直接进编辑器」——那一刻转录还在跑。
       这一态因此不是额外演示，是 sub 入口真实的**前一秒**。 */
    {k: 'live',  name: '转录中',     tab: 'transcript', live: true,
     canvas: 'mono',  timeline: 'subs',
     toast: '转录已经在后台跑了 · 文稿会一段一段出现'},
    /* 重新转录（product-design §5.7）：视频已经有字幕轨，所以时间轴和画面照常，只有文稿面板切到只读的实时态。 */
    {k: 'relive', name: '重新转录中', tab: 'transcript', live: true, rerun: true,
     canvas: 'mono',  timeline: 'subs',
     toast: '正在重新转录 · 字幕与时间轴不受影响，文稿会一段一段出现'},
    {k: 'trans', name: '翻译',       tab: 'subtitle', bilingual: true,
     canvas: 'bi',    timeline: 'subs',
     toast: '翻译完成 · 中 → EN · 双语字幕已开启'},
    /* 与 live 同理：§8.3 类型 B 的交接也是「关掉 sheet 直接进编辑器」，
       那一刻翻译还在跑。这一态是 trans 入口真实的**前一秒**。 */
    {k: 'translive', name: '翻译中',  tab: 'subtitle', transLive: true,
     canvas: 'bi',    timeline: 'subs',
     toast: '翻译已经在后台跑了 · 译文会一句一句出现'},
    {k: 'clean', name: '口播剪辑',   tab: 'transcript', review: true,
     canvas: 'mono',  timeline: 'cuts',
     toast: '粗剪建议已就绪 · 先看看再应用'},
    {k: 'a2v',   name: '音频转视频', tab: 'elements', selectWave: true,
     canvas: 'wave',  timeline: 'audio',
     toast: '已把音频变成视频 · 换个背景或波形样式试试'},
    {k: 'tpl',   name: '模板',       tab: 'elements', tplOn: true,
     canvas: 'tpl',   timeline: 'tpl',
     toast: '模板已套用：章节底栏 · 色条 · 时间轴多了一行模板'},
    {k: 'blank', name: '空白',       tab: 'video',
     canvas: 'empty', timeline: 'empty',
     toast: null},
  ];

  /* clean 入口的剪辑建议（§9 剪辑模式；§12.6 剪口覆盖层；与 Timeline 视频轨的剪口段双向联动）。
     建议按「哪条 cue 里的哪个子串」定义，时间由 BC_CUT.fromSpecs 按 cue 内字符比例算出——
     这样中英两个语言包引的是同一处毛病，时间也和 makeCues 铺出来的 cue 完全对得上。
     演示稿 21 句循环 3 轮，所以同一处口癖 / 重复起句 / 停顿各出现 3 次：共 9 条。 */
  const cutSpecs = [
    {id: 'c1', cue: 'g3',  kind: 'filler', why: '口癖',     find: {zh: '嗯，就是，', en: 'Uh, so,'}},
    {id: 'c2', cue: 'g9',  kind: 'take',   why: '重复起句', find: {zh: '那时候每一个小改动都要——', en: 'Back then every small change needed—'}},
    {id: 'c3', cue: 'g11', kind: 'pause',  why: '长停顿',   tail: 1.4},
    {id: 'c4', cue: 'g24', kind: 'filler', why: '口癖',     find: {zh: '嗯，就是，', en: 'Uh, so,'}},
    {id: 'c5', cue: 'g30', kind: 'take',   why: '重复起句', find: {zh: '那时候每一个小改动都要——', en: 'Back then every small change needed—'}},
    {id: 'c6', cue: 'g32', kind: 'pause',  why: '长停顿',   tail: 1.1},
    {id: 'c7', cue: 'g45', kind: 'filler', why: '口癖',     find: {zh: '嗯，就是，', en: 'Uh, so,'}},
    {id: 'c8', cue: 'g51', kind: 'take',   why: '重复起句', find: {zh: '那时候每一个小改动都要——', en: 'Back then every small change needed—'}},
    {id: 'c9', cue: 'g53', kind: 'pause',  why: '长停顿',   tail: 0.9},
  ];
  const cutSuggestions = window.BC_CUT.fromSpecs(cutSpecs, cues, 'zh');

  /* ---------- 舞台工具条（§11） ---------- */
  const ratios = ['Original', '16:9', '9:16', '1:1', '4:3', '3:4', '2:1', '2.35:1', '1.85:1'];
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  /* ---------- 时间轴缩放菜单（§12.4，7 项 1:1 Descript） ---------- */
  const zoomMenu = [
    {k: 'in',       label: '放大',           sk: '⌘='},
    {k: 'out',      label: '缩小',           sk: '⌘−'},
    {k: '100',      label: '100%',           sk: '⌘0'},
    {k: 'fit',      label: '适应窗口',       sk: '⌥⌘1'},
    {k: 'fitclip',  label: '适应当前片段',   sk: '⌥⌘2'},
    {k: 'playhead', label: '缩放到播放头',   sk: '⌥⌘3'},
    {k: 'fitsel',   label: '适应所选',       sk: '⌥⌘4'},
  ];

  /* ---------- 术语库（§15.10，2026-09-20） ----------
     用户自己的跨项目专名表，**两种表各管一件事**（算法在 model-glossary.js）：
     - 转录术语表 `kind: 'asr'`：规范写法 + 常听错成什么；送给语音模型、润色时据此纠正。
     - 翻译术语表 `kind: 'trans'`：原文 → 译文，带语言方向；翻译时只带本篇命中的条目。
     一条词只有两格，备注与「可变通」（`lock: false`）是少数条目才用得上的「更多」。

     `variants` 是**真的会被听错的写法**，不是编出来的近义词（反幻觉条款同 core）：
     维科夫 / 开维缓存 / 罗拉都是中文口播里 ASR 的实际错法。 */
  const glossary = {
    packs: [
      {id: 'ga-ml', kind: 'asr', name: '机器学习', lang: 'zh', dflt: true, updated: '昨天',
       terms: [
         {id: 'am1', source: 'KV cache', variants: ['开维缓存', 'KV 换成']},
         {id: 'am2', source: 'LoRA', variants: ['罗拉', '萝拉']},
         {id: 'am3', source: '注意力头', variants: ['注意力投']},
         {id: 'am4', source: '词级对齐', variants: ['词集对齐', '词技对齐']},
         {id: 'am5', source: '推理框架', variants: []},
       ]},
      {id: 'ga-show', kind: 'asr', name: '这档节目', lang: 'zh', dflt: true, updated: '上周',
       terms: [
         {id: 'as1', source: '码与远方', variants: ['马与远方', '码语远方']},
         {id: 'as2', source: '林澈', variants: ['林彻', '林车']},
         {id: 'as3', source: '周远', variants: ['周园']},
       ]},
      {id: 'ga-trading', kind: 'asr', name: '交易 · 量价方法', lang: null, dflt: false, updated: '3 天前',
       terms: [
         {id: 'at1', source: 'Wyckoff', variants: ['维科夫', '威克夫', 'why cough']},
         {id: 'at2', source: 'commit', variants: ['康米特']},
         {id: 'at3', source: 'spring', variants: ['斯普林']},
       ]},
      {id: 'gt-ml-en', kind: 'trans', name: '机器学习', from: 'zh', to: 'en', dflt: true, updated: '昨天',
       terms: [
         {id: 'tm1', source: 'KV cache', target: 'KV cache'},
         {id: 'tm2', source: '注意力头', target: 'attention head'},
         {id: 'tm3', source: '词级对齐', target: 'word-level alignment', note: '本产品的核心说法'},
         {id: 'tm4', source: '量化', target: 'quantization', note: '模型量化，不是量化交易', lock: false},
         {id: 'tm5', source: '推测解码', target: 'speculative decoding'},
         {id: 'tm6', source: '蒸馏', target: 'distillation'},
       ]},
      {id: 'gt-show-en', kind: 'trans', name: '这档节目', from: 'zh', to: 'en', dflt: true, updated: '上周',
       terms: [
         {id: 'ts1', source: '码与远方', target: 'Code & Far Away'},
         {id: 'ts2', source: '林澈', target: 'Lin Che'},
         {id: 'ts3', source: '周远', target: 'Zhou Yuan'},
       ]},
      {id: 'gt-ml-ja', kind: 'trans', name: '机器学习', from: 'zh', to: 'ja', dflt: true, updated: '昨天',
       terms: [
         {id: 'tj1', source: 'KV cache', target: 'KV キャッシュ'},
         {id: 'tj2', source: '注意力头', target: 'アテンションヘッド'},
         {id: 'tj3', source: '词级对齐', target: '単語単位のアライメント'},
       ]},
      {id: 'gt-trading', kind: 'trans', name: '交易 · 量价方法', from: 'en', to: 'zh', dflt: false, updated: '3 天前',
       terms: [
         {id: 'tt1', source: 'Wyckoff', target: '威科夫'},
         {id: 'tt2', source: 'commit', target: '突破确认', note: '这一派里不是「提交」'},
         {id: 'tt3', source: 'accumulation', target: '吸筹', lock: false},
         {id: 'tt4', source: 'distribution', target: '派发', note: '与统计学的「分布」不是一个意思'},
         {id: 'tt5', source: 'spring', target: '弹簧效应', note: '不要译成「泉水」'},
         {id: 'tt6', source: 'composite operator', target: '综合操盘手'},
       ]},
    ],

    /* 校对波次扫的段落：变体真的写在正文里，页面上那几条建议是 `BC_GLOSSARY.review()` 当场
       扫出来的，不是写死的卡片。 */
    reviewParas: [
      {id: 'gp1', label: '¶3 · 00:16', sp: '周远', text: '我们把开维缓存这一层重写了一遍，吞吐大概快了三倍。'},
      {id: 'gp2', label: '¶5 · 00:41', sp: '周远', text: '罗拉微调只动一小部分参数，所以成本低很多，罗拉也更好分发。'},
      {id: 'gp3', label: '¶7 · 01:02', sp: '林彻', text: '刚才林彻说的词集对齐，就是整条链路的地基。'},
      {id: 'gp4', label: '¶9 · 01:28', sp: '周远', text: '注意力投的数量不变，改的是缓存怎么摆。'},
      {id: 'gp5', label: '¶11 · 01:52', sp: '林澈', text: '推测解码这条路我们试过三次，量化之后反而更稳。'},
    ],

    /* 库里还没有、但这一篇反复出现的疑似专名：真实实现由分析阶段给出，原型给一份固定候选。 */
    candidates: [
      {source: '推测解码', count: 5, sample: '推测解码这条路我们试过三次'},
      {source: 'MoE', count: 3, sample: 'MoE 的路由是另一个话题'},
      {source: '码与远方', count: 6, sample: '欢迎回到码与远方'},
      {source: 'Flash Attention', count: 4, sample: 'Flash Attention 之后这里就不是瓶颈了'},
    ],
  };

  /* Settings 左栏（2026-09-30 起按能力类型分）搬去 model-settings-nav.js */

  /* ---------- 状态徽章词表（沿 Mac，§8.1） ---------- */
  const BADGE = {
    ready:        {label: '未转录',   tone: 'neutral'},
    complete:     {label: '已转录',   tone: 'positive'},
    transcribing: {label: '转录中',   tone: 'accent'},
    queued:       {label: '排队中',   tone: 'info'},
    error:        {label: '失败',     tone: 'negative'},
  };

  /* ---------- 项目语言包切换（第 73 轮） ----------
     打开哪个项目就装哪门源语言的数据：cue 两列对调、段落连接符对调（英文按词
     补空格、中文直接相接）、默认轨集重落一对（源语言轨换宿主）、粗剪建议与
     「翻译完成」toast 的方向词跟着换。判据是项目的 `lang`——真产品里这是
     transcript 的 `sourceLanguage`，原型里演示项目只有中英两包。

     **只换真相层，不换样张**：画廊 specimen 是字体样张，按设计规矩在所有项目里
     长一个样（见 subtitle.sample 处的注释）。已知共享项（有意不随包换，量太大且
     不是这条演示的主角）：translate.live（中→日的翻译中样片）、translate.cards
     （审阅卡引中文原文）、modelActivity 的调用台账、章节标题（AI 产出语言跟随
     产品语言，中文 UI 出中文章节名是成立的）。 */
  /* ---------- 短视频项目（§15.12）----------
     从别的项目切出来的一支：清单里的 `origin {project, in, out}` 是出身，`used` 是它现在用到的
     原片区间（多留一句、再加一段之后会变）。打开时时间轴与字幕都按 `used` 排出来：每段一个
     引用原片的视频片段，字幕取来源项目文稿里落在这一段的句子，时间换成这一支自己的。 */
  const isCut = (proj) => !!(proj && proj.origin && typeof proj.origin === 'object' && proj.origin.project);
  const cutRanges = (proj) => (proj.used && proj.used.length ? proj.used : [{in: proj.origin.in, out: proj.origin.out}]);
  /** 来源项目的整份文稿（句子）。来源项目不在库里时返回空表。 */
  function sourceCues(proj, list) {
    if (!isCut(proj)) return [];
    const parent = (list || projects).find((p) => p.id === proj.origin.project);
    return parent ? makeCues(parent.lang === '英语') : [];
  }
  function cutLayout(proj, list) {
    const SC = window.BC_SHORTS_CUT;
    const source = sourceCues(proj, list);
    const out = {clips: [], cues: [], duration: 0};
    cutRanges(proj).forEach((r, i) => {
      const at = out.duration;
      out.clips.push({id: 'k' + (i + 1), start: at, end: +(at + r.out - r.in).toFixed(2), src: r.in});
      if (SC) out.cues = SC.insertCues(out.cues, source, r, at, 'k' + (i + 1));
      out.duration = +(at + r.out - r.in).toFixed(2);
    });
    return out;
  }

  function projectSetup(proj) {
    const entry = entries.find(e => e.k === proj.entry) || entries[0];
    if (isCut(proj)) {
      const lay = cutLayout(proj);
      const parent = projects.find((p) => p.id === proj.origin.project);
      const main = {...sources.video[0], name: proj.src.name, dur: parent ? parent.duration : lay.duration};
      return {entry, tab: 'video', transcript: true, music: false, score: [], duration: lay.duration,
        clips: lay.clips, chapters: [], sources: {image: [], video: [main], audio: []}};
    }
    const elementLab = proj.focus === 'elements';
    const movie = !!proj.preview;
    const main = {...sources.video[0], name: proj.src.name, dur: proj.duration,
      ...(movie ? {url: proj.preview.url, poster: proj.preview.poster, meta: proj.src.format} : {})};
    return {
      entry, tab: movie ? 'video' : elementLab ? 'elements' : entry.tab,
      transcript: !elementLab && !movie, captions: proj.captions !== false, music: !proj.bare, score: proj.score || [],
      duration: movie ? proj.duration : DUR,
      clips: movie ? [{id: 'k1', start: 0, end: proj.duration, src: 0}] : clips,
      chapters: elementLab || movie ? [] : proj.entry === 'clean'
        ? [{id: 'c1', title: '开场', start: 0, end: 22},
           {id: 'c2', title: '正文', start: 22, end: 158},
           {id: 'c3', title: '收尾', start: 158, end: DUR}] : chapters,
      sources: proj.bare ? {image: [], video: [main], audio: []}
        : {...sources, video: [main, ...sources.video.slice(1)]},
    };
  }

  let activeProjectKey = null;
  function activateProject(id, currentProject) {
    const D = window.BC_DATA;
    const proj = currentProject || projects.find((x) => x.id === id);
    const src = proj && proj.lang === '英语' ? 'en' : 'zh';
    const cut = isCut(proj) ? cutRanges(proj).map((r) => r.in + '-' + r.out).join(',') : '';
    const key = src + ':' + (proj && proj.entry === 'clean' ? 'monologue' : 'interview') + (cut ? ':' + proj.id + ':' + cut : '');
    if (activeProjectKey === key) return;
    activeProjectKey = key;
    const dst = src === 'en' ? 'zh' : 'en';
    D.srcLang = LANG[src];
    D.dstLang = LANG[dst];
    D.cues = makeCues(src === 'en');
    if (proj && proj.entry === 'clean') {
      // 同语言项目也需换内容包；剪口位置与稳定 cue id 保留供 AI 扫描演示。
      const lines = {
        1: '这一期聊聊我为什么选择本地的视频工具。',
        2: '嗯，就是，我先从语音识别说起。',
        3: '接下来讲渲染，再讲字幕和导出。',
        20: '今天先讲到这里，下期再见。',
      };
      D.cues = D.cues.map((c, i) => ({...c, sp: 's1', text: src === 'zh' ? lines[i % 21] || c.text : c.text, trans: ''}));
    }
    // 短视频项目只有切出来的那几段（§15.12）：句子取自来源项目，时间换成这一支自己的
    if (cut) D.cues = cutLayout(proj).cues;
    D.paras = makeParas(D.cues, src === 'en' ? ' ' : '', src === 'en' ? '' : ' ');
    D.initialSegments.paragraphs = D.paras.length;
    D.cutSuggestions = window.BC_CUT.fromSpecs(cutSpecs, D.cues, src);
    D.subtitle.defaults.tracks = defaultTracks(LANG[src], LANG[dst]);
    // 翻译面板里带方向性的两份演示数据也跟着换；中文版正身写在 translate 里
    D.translate.live = src === 'en' ? translateLiveEn : translateLiveZh;
    D.translate.cards = src === 'en' ? translateCardsEn : translateCardsZh;
    const tr = entries.find((e) => e.k === 'trans');
    tr.toast = '翻译完成 · ' + LANG[src].abbr + ' → ' + LANG[dst].abbr + ' · 双语字幕已开启';
  }

  /* 内置 Agent 自己使用的 skills（设置 › Skills；语义与形状见 model-agent-skills.js）。
     全部是虚构的演示内容：每条是一个文件夹，`files` 里至少有 SKILL.md。第三方默认关（只在选用时生效）。 */
  const skillDoc = (name, description, body) => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body.trim()}\n`;
  const agentSkills = [
    {id: 'caption-layout', name: '字幕排版规范', source: 'builtin', author: 'BaoCut', category: '字幕', enabled: true, updated: '2026-09-28',
      summary: '按每行字数、断句位置与停留时长整理字幕，读起来不赶。',
      description: '整理字幕时用：控制每行字数和行数，在语义停顿处断行，过短的字幕并到相邻一条，保证每条停留时间够读完。只改排版与时间，不改原话。',
      examples: ['把这部视频的字幕按规范重排一遍，每行不超过 18 个字', '检查字幕里有没有停留不到 1 秒的，帮我合并'],
      files: [
        {path: 'SKILL.md', body: skillDoc('caption-layout', '整理字幕的每行字数、断句与停留时长。用户说「字幕太挤」「重排字幕」「字幕闪得太快」时使用。', `
# 字幕排版规范

## 什么时候用

- 用户要求整理、重排或检查字幕的可读性。
- 转录或翻译刚完成，字幕还没有人工看过。
- 不要用在只想改某一句话的措辞时，那是文稿编辑。

## 步骤

1. 读取当前字幕轨，统计每条的字数、行数与停留时长。
2. 按 references/line-rules.md 的上限找出超长的条目，在语义停顿处拆成两条。
3. 停留不到 1 秒、且与相邻条目间隔很短的，合并到相邻一条。
4. 双语字幕时，译文跟随原文的拆分点，不单独拆。
5. 写回之前列出改动数量，等用户确认。

## 不做的事

- 不改写原话，不删内容。
- 不移动已经被用户手动调过时间的字幕。`)},
        {path: 'references/line-rules.md', body: `# 每行上限

- 中文：横屏每行不超过 18 个字，竖屏不超过 12 个字。
- 英文：横屏每行不超过 42 个字符，竖屏不超过 28 个字符。
- 每条最多两行。

## 断行优先级

1. 句号、问号之后
2. 逗号、顿号之后
3. 连词之前
4. 实在没有停顿时，在词与词之间断，不拆开一个词`},
      ]},
    {id: 'talking-head-cut', name: '口播精剪', source: 'builtin', author: 'BaoCut', category: '剪辑', enabled: true, updated: '2026-09-30',
      summary: '剪掉口癖、长停顿和说错重来的句子，保留自然的呼吸。',
      description: '处理一个人对着镜头讲的视频：找出口癖、超过阈值的停顿和重复的坏镜头，给出剪口建议，确认后再剪。剪完节奏更紧，但不把话剪碎。',
      examples: ['把这条口播里的口癖和长停顿剪掉', '找出我说错重来的地方，只留最后一遍'],
      files: [
        {path: 'SKILL.md', body: skillDoc('talking-head-cut', '精剪口播视频：口癖、长停顿、说错重来。用户说「剪口播」「去掉嗯啊」「节奏紧一点」时使用。', `
# 口播精剪

## 什么时候用

- 视频主体是一个人连续讲话，已经有转录文稿。
- 用户想让节奏更紧，或明确提到口癖、停顿、重来。

## 步骤

1. 确认转录已完成；没有就先等转录。
2. 在文稿里标出三类可剪的地方：口癖词、超过 0.8 秒的停顿、同一句话说了多遍。
3. 同一句话的多遍只留最后一遍完整的；拿不准时留给用户选。
4. 停顿不整段剪掉，保留约 0.2 秒呼吸。
5. 汇总成一张清单（类型、位置、省下的时长），等用户确认后一次写入。

## 判断标准

- 口癖词在句子中间才剪；作为语气转折的「那么」「所以」保留。
- 剪完一句话不足 3 个字的，连同前后句一起看，避免剪碎。`)},
      ]},
    {id: 'shorts-slicing', name: '短视频切片', source: 'builtin', author: 'BaoCut', category: '剪辑', enabled: true, updated: '2026-09-21',
      summary: '从长视频里挑出能独立成篇的段落，切成几条竖屏短视频。',
      description: '读完整份文稿，挑出有开头、有结论、单独看得懂的段落，每段切成一部新的竖屏视频，并记下它来自原片的哪一段。',
      examples: ['从这期访谈里切 3 条竖屏短视频', '挑一个最有争议的观点，做成 60 秒以内的切片'],
      files: [
        {path: 'SKILL.md', body: skillDoc('shorts-slicing', '把长视频切成几条竖屏短视频。用户说「切片」「做成短视频」「挑几个看点」时使用。', `
# 短视频切片

## 什么时候用

- 原片超过 5 分钟，用户想要若干条短的。
- 用户指定了条数或时长上限。

## 步骤

1. 通读文稿与章节，列出候选段落，每段写一句「这段讲了什么」。
2. 按 references/hook-checklist.md 给候选打分，留下得分最高的几段。
3. 每段的起点放在一句完整的话开头，终点放在结论说完之后。
4. 每段新建一部 9:16 的视频，画面按说话人居中裁切，并记下来源片段。
5. 回报每一条的标题建议、时长与来源时间码。

## 不做的事

- 不把两段不相邻的内容硬拼成一条，除非用户要求。`)},
        {path: 'references/hook-checklist.md', body: `# 看点检查表

每满足一条记 1 分：

- 开头 3 秒内出现问题、反差或结论
- 不依赖前文也能看懂
- 有一个明确的结论或建议
- 时长在 20 到 60 秒之间
- 说话人情绪有变化`},
      ]},
    {id: 'cover-and-title', name: '封面与标题', source: 'builtin', author: 'BaoCut', category: '发布', enabled: true, updated: '2026-09-12',
      summary: '根据内容给出几组标题和封面文案，再生成封面图。',
      description: '读文稿提炼主题，给出几组风格不同的标题与封面大字，用户选定后按画幅生成封面图，放进这部视频的产物里。',
      examples: ['给这部视频起 5 个标题，再配一张封面', '封面大字控制在 8 个字以内，给我三版'],
      files: [
        {path: 'SKILL.md', body: skillDoc('cover-and-title', '为视频写标题、封面文案并生成封面。用户说「起个标题」「做封面」时使用。', `
# 封面与标题

## 步骤

1. 读文稿，用一句话概括这部视频对观众的价值。
2. 给出 5 个标题：直述、提问、数字、反差、引语各一个，每个不超过 24 个字。
3. 每个标题配一行封面大字，不超过 8 个字，不重复标题原话。
4. 用户选定后，按视频画幅生成封面：人物或主体在一侧，大字在另一侧。
5. 封面存为这部视频的产物，并说明用了哪一帧或哪张图。

## 注意

- 标题里的数字和结论必须能在文稿里找到出处。
- 不使用夸张的断言。`)},
      ]},
    /* 2026-10-09：AI 工具 Tab 的每个工具各配一个内置 skill（product-design §5.10、§6.9）：工具页的提示词框默认挂着它，
       可以摘掉（摘掉就只剩提示词），也可以再挂别的已添加 skill。剪口播 → talking-head-cut，做封面 → cover-and-title，
       剪成短视频 → shorts-slicing，其余在这里。 */
    {id: 'transcribe-captions', name: '转录与字幕', source: 'builtin', author: 'BaoCut', category: '文稿', enabled: true, updated: '2026-10-09',
      summary: '用合适的语音模型转录，按词级时间整理成文稿与字幕。',
      description: '转录或重新转录时用：按视频语言挑语音模型，保留词级时间，按语义停顿切句，专有名词按术语库写法。只换掉选定范围的文稿，其余不动。',
      examples: ['把第 2 章重新转录一遍', '换一个更准的模型重跑整篇'],
      files: [
        {path: 'SKILL.md', body: skillDoc('transcribe-captions', '转录或重新转录一段音频并整理成文稿与字幕。用户说「重新转录」「识别不准」时使用。', `
# 转录与字幕

## 步骤

1. 看清范围：整篇还是某一章、某一段；只换掉范围内的文稿。
2. 按视频语言与时长挑语音模型，保留词级时间。
3. 按语义停顿切句，专有名词按术语库的写法。
4. 转完对一遍译文、字幕与配音哪些要结转，列出来给用户看。

## 注意

- 用户改过的句子要先提醒再覆盖。`)},
      ]},
    {id: 'transcript-polish', name: '润色转写', source: 'builtin', author: 'BaoCut', category: '文稿', enabled: true, updated: '2026-10-09',
      summary: '修错字、补标点、自动分段，不改写说话人的表达。',
      description: '润色转录文稿时用：只修能确定是识别错误的字词，补标点并按话题分段，不改写口语表达、不删内容；逐段给出对照，用户可以逐段还原。',
      examples: ['把这篇文稿润色一遍，保留口语感', '只修错字和标点，不要改我的说法'],
      files: [
        {path: 'SKILL.md', body: skillDoc('transcript-polish', '润色转录文稿：错字、标点、分段。用户说「润色」「修错字」「分一下段」时使用。', `
# 润色转写

## 步骤

1. 通读文稿，标出能确定是识别错误的字词（同音错字、英文拼错）。
2. 补标点：句末按语气，长句在停顿处断开。
3. 按话题分段，每段三到六句。
4. 逐段给出修改前后的对照，不改写表达，不删内容。

## 判断标准

- 拿不准是不是错字的保留原文。
- 品牌名、人名按术语库写法。`)},
      ]},
    {id: 'chaptering', name: '分章节', source: 'builtin', author: 'BaoCut', category: '文稿', enabled: true, updated: '2026-10-09',
      summary: '按话题聚合段落，给每章一个短标题与起点时间。',
      description: '生成章节时用：先看文稿是否已分段，按话题把段落聚成章，每章一个不超过 12 个字的标题，起点落在句子边界上；长视频 5–8 章，短视频 2–4 章。',
      examples: ['给这部视频分章节', '章节太碎了，合并成 5 章'],
      files: [
        {path: 'SKILL.md', body: skillDoc('chaptering', '给视频分章节并起标题。用户说「分章」「生成章节」「加时间点」时使用。', `
# 分章节

## 步骤

1. 文稿还没分段时先润色分段，章节按段落聚合。
2. 按话题把相邻段落聚成章；一章讲一件事。
3. 每章起一个不超过 12 个字的标题，起点对到句子开头。
4. 写回前列出章节清单与时间点。

## 判断标准

- 长视频 5–8 章，短视频 2–4 章。
- 开场寒暄并入第一章。`)},
      ]},
    {id: 'speaker-labeling', name: '说话人标注', source: 'builtin', author: 'BaoCut', category: '文稿', enabled: true, updated: '2026-10-09',
      summary: '按声纹区分说话人，结合自我介绍起名字，确认后再写入。',
      description: '识别说话人时用：按声纹聚成几位，从文稿里的自我介绍、称呼推断名字，推不出的用「说话人 1」；每位给几段试听片段，用户确认后才写进字幕与文稿。',
      examples: ['标一下这段访谈里是谁在说', '把两位嘉宾的名字标到字幕上'],
      files: [
        {path: 'SKILL.md', body: skillDoc('speaker-labeling', '识别并标注说话人。用户说「谁在说话」「识别说话人」「标名字」时使用。', `
# 说话人标注

## 步骤

1. 按声纹把句子聚成几位说话人。
2. 从自我介绍、称呼里推断名字，推不出的写「说话人 1」。
3. 每位挑三段代表片段给用户试听确认。
4. 确认后写进字幕与文稿，译文只按新边界重切，不重译。

## 注意

- 一位说话人在两段里声音差别大时，先问用户是不是同一个人。`)},
      ]},
    {id: 'subtitle-translation', name: '翻译字幕', source: 'builtin', author: 'BaoCut', category: '字幕', enabled: true, updated: '2026-10-09',
      summary: '逐句翻译并对齐时间码，术语按术语库，过期的只重译那几句。',
      description: '翻译字幕或刷新过期译文时用：逐句翻译、按词级数据对齐时间，术语按术语库的固定译法；原文改过或被剪的句子只重译那几句，其余一个字不动。',
      examples: ['把字幕翻成英文', '原文改过的那几句重新翻一下'],
      files: [
        {path: 'SKILL.md', body: skillDoc('subtitle-translation', '翻译字幕与刷新过期译文。用户说「翻译」「翻成英文」「译文过期」时使用。', `
# 翻译字幕

## 步骤

1. 逐句翻译，一句原文对一句译文，不合并不拆分。
2. 术语按术语库的固定译法。
3. 按词级时间对齐译文的时间码。
4. 只刷新过期译文时，只改原文改过或被剪的句子。

## 注意

- 整句被剪掉的译文随句一起剪。`)},
      ]},
    {id: 'video-summary', name: '视频内容总结', source: 'builtin', author: 'BaoCut', category: '文稿', enabled: true, updated: '2026-10-09',
      summary: '先给结论，再列带时间码的要点，用文稿的语言写。',
      description: '写总结时用：读完整份文稿，先用两三句给结论，再列要点，每条带时间码（mm:ss）并能在文稿里找到出处；用 Markdown、文稿的语言，不加文稿里没有的信息。',
      examples: ['给这部视频写一份总结', '要点带时间，我发给没看过的人'],
      files: [
        {path: 'SKILL.md', body: skillDoc('video-summary', '为视频写要点总结。用户说「总结」「写个摘要」「要点」时使用。', `
# 视频内容总结

## 步骤

1. 读完整份文稿和章节。
2. 先写两三句结论：这部视频讲了什么、给谁看。
3. 列要点，每条带时间码（mm:ss），按出现顺序。
4. 用 Markdown、文稿的语言写；不加文稿里没有的信息。

## 判断标准

- 要点每条一句话，能在文稿里找到出处。`)},
      ]},
    {id: 'blog-from-video', name: '写成博客文章', source: 'builtin', author: 'BaoCut', category: '文稿', enabled: true, updated: '2026-10-09',
      summary: '把文稿改写成一篇能单独读的文章，视角按视频来源定。',
      description: '写博客时用：按章节组织成文章，口语改成书面语但保留原意；自己的视频以作者口吻写，别人的视频以观众视角写；引用原话时带时间码。',
      examples: ['把这期播客改写成一篇文章', '以观众的视角写一篇观后记'],
      files: [
        {path: 'SKILL.md', body: skillDoc('blog-from-video', '把视频改写成博客文章。用户说「写成文章」「博客」「图文版」时使用。', `
# 写成博客文章

## 步骤

1. 判断视角：自己的视频以作者口吻，别人的视频以观众视角。
2. 按章节组织段落，每章一个小标题。
3. 口语改书面语，保留原意与关键原话，原话带时间码。
4. 开头一段说明这篇文章来自哪部视频。

## 注意

- 风格平实，不用营销腔。`)},
      ]},
    {id: 'title-and-description', name: '起标题与写简介', source: 'builtin', author: 'BaoCut', category: '发布', enabled: true, updated: '2026-10-09',
      summary: '几个角度不同的标题候选，简介带章节时间码与标签。',
      description: '起标题或写简介时用：标题给几个角度各不相同的候选并各带一句理由，最后推荐一个；简介先一段概述，再列章节时间码，末尾一行标签；指定了平台就按平台的字数与格式写。',
      examples: ['给这部视频起 6 个标题', '写一段带章节时间的简介，发 YouTube'],
      files: [
        {path: 'SKILL.md', body: skillDoc('title-and-description', '为视频起标题、写简介。用户说「起标题」「写简介」「视频描述」时使用。', `
# 起标题与写简介

## 步骤

1. 读文稿，用一句话概括这部视频对观众的价值。
2. 标题：按直述、提问、数字、反差、引语等不同角度各给一个，每个带一句理由，最后推荐一个。
3. 简介：先一段概述，再列章节时间码，末尾一行标签。
4. 指定了平台就按它的字数与格式写，写完提醒用户核对。

## 注意

- 数字和结论必须能在文稿里找到出处。`)},
      ]},
    {id: 'bilingual-proofread', name: '双语字幕校对', source: 'builtin', author: 'BaoCut', category: '字幕', enabled: false, updated: '2026-09-25',
      summary: '逐条对照原文和译文，找出漏译、误译与术语不一致。',
      description: '翻译完成后使用：逐条比对原文与译文，核对术语库里的固定译法，标出漏译、误译和前后不一致的地方，给出修改建议而不直接覆盖。',
      examples: ['校对一遍英文字幕，重点看术语是不是统一', '找出译文比原文短很多的字幕，看看有没有漏译'],
      files: [
        {path: 'SKILL.md', body: skillDoc('bilingual-proofread', '校对双语字幕：漏译、误译、术语一致性。用户说「校对翻译」「检查译文」时使用。', `
# 双语字幕校对

## 什么时候用

- 视频已有原文字幕和至少一门译文。
- 用户要求检查翻译质量，或准备导出双语成片之前。

## 步骤

1. 读取这部视频启用的术语表，建立「原文 → 固定译法」对照。
2. 逐条比对：译文长度明显偏短的标为疑似漏译；术语不符合对照的标为术语不一致。
3. 数字、人名、单位逐一核对。
4. 按 references/severity.md 分级，先列严重的。
5. 每条给出建议译文，等用户逐条或批量接受。`)},
        {path: 'references/severity.md', body: `# 问题分级

- 严重：意思相反、数字或人名错误、整句漏译
- 一般：术语与术语表不一致、漏掉修饰成分
- 轻微：标点、大小写、空格`},
      ]},
    {id: 'channel-intro', name: '频道片头规范', source: 'personal', author: '你', category: '品牌', enabled: true, updated: '2026-10-02',
      summary: '每部视频开头加 3 秒片头：标志、栏目名和这一期的标题。',
      description: '我的频道统一片头：前 3 秒放标志动画和栏目名，随后一行本期标题淡入。新做的视频和切片都按这份来。',
      examples: ['给这部视频加上频道片头', '按片头规范检查这部视频的开头'],
      files: [
        {path: 'SKILL.md', body: skillDoc('channel-intro', '按频道规范添加或检查片头。做新视频、切片或用户提到「片头」时使用。', `
# 频道片头规范

## 步骤

1. 在时间轴开头留出 3 秒。
2. 第 0 到 2 秒：标志动画居中，背景用品牌主色。
3. 第 2 到 3 秒：栏目名在上，本期标题在下，淡入。
4. 标题从视频名称里取，超过 14 个字时请用户给一个短的。
5. 片头结束后正片直接开始，不加转场。

## 素材位置

见 references/assets.md。`)},
        {path: 'references/assets.md', body: `# 素材位置

- 标志动画：~/BaoCut/品牌素材/标志动画.mov
- 片头音效：~/BaoCut/品牌素材/片头音效.wav
- 栏目名字体：与正文字幕相同，字重加粗`},
      ]},
    {id: 'interview-notes', name: '访谈纪要模板', source: 'personal', author: '你', category: '文稿', enabled: false, updated: '2026-09-18',
      summary: '把访谈整理成一页纪要：背景、三个要点、原话摘录和待办。',
      description: '访谈类视频转录完成后，按固定的四段结构出一份纪要文档，原话摘录带时间码，方便回看。',
      examples: ['按纪要模板整理这期访谈'],
      files: [
        {path: 'SKILL.md', body: skillDoc('interview-notes', '把访谈文稿整理成固定结构的一页纪要。用户说「出纪要」「整理访谈」时使用。', `
# 访谈纪要模板

## 结构

1. 背景：谁、什么时候、聊什么，两三句话。
2. 三个要点：每个要点一句结论加一段说明。
3. 原话摘录：最多 5 句，每句带说话人和时间码。
4. 待办：访谈里提到要跟进的事。

## 规则

- 结论只来自文稿，不补充文稿里没有的信息。
- 纪要存成这个项目里的一份文档。`)},
      ]},
    {id: 'podcast-chapters', name: '播客章节标记', source: 'third-party', author: '示例作者 A', category: '社区', enabled: false, updated: '2026-08-30',
      summary: '给长音频自动分章节，并写出每章一句话的摘要。',
      description: '社区贡献的 skill：按话题转折给长音频或长视频分章节，每章起一个短标题和一句摘要。',
      examples: ['给这期节目分章节，每章起个标题'],
      files: [
        {path: 'SKILL.md', body: skillDoc('podcast-chapters', '给长音频或长视频分章节并写摘要。', `
# 播客章节标记

## 步骤

1. 通读文稿，找出话题转折的位置。
2. 每 5 到 15 分钟一章，章节起点对齐到一句话的开头。
3. 每章写一个不超过 12 个字的标题和一句摘要。
4. 把章节写入视频的章节轨。`)},
      ]},
    {id: 'lower-third-pack', name: '人名条样式包', source: 'third-party', author: '示例作者 B', category: '社区', enabled: false, updated: '2026-07-16',
      summary: '说话人第一次出场时加人名条，带三种版式。',
      description: '社区贡献的 skill：在每位说话人第一次开口时加一条人名条，停留 4 秒；版式有简洁、双行、带职位三种。',
      examples: ['给每位说话人加人名条，用双行版式'],
      files: [
        {path: 'SKILL.md', body: skillDoc('lower-third-pack', '为说话人添加人名条。用户说「加人名条」「标一下谁在说话」时使用。', `
# 人名条样式包

## 步骤

1. 读取说话人列表与每位第一次开口的时间。
2. 在那一刻加一条人名条，停留 4 秒，放在画面左下。
3. 版式见 references/layouts.md，用户没指定时用「简洁」。
4. 说话人没有名字时，先问用户。`)},
        {path: 'references/layouts.md', body: `# 版式

- 简洁：只有名字
- 双行：名字加一行身份
- 带职位：名字、职位与所在机构`},
      ]},
  ];
  /* 「从本地文件夹添加」的演示文件夹：最后一个故意没有 SKILL.md，用来演示校验的错误态。 */
  const agentSkillFolders = [
    {path: '~/BaoCut/skills/片尾致谢/', skill: {id: 'outro-credits', name: '片尾致谢', author: '你', category: '品牌',
      summary: '片尾加 5 秒致谢：出镜者、制作与一句订阅提醒。',
      description: '每部视频结尾统一加 5 秒致谢页：出镜者名单、制作人员和一句订阅提醒，背景用视频最后一帧的模糊图。',
      examples: ['给这部视频加片尾致谢'],
      files: [{path: 'SKILL.md', body: skillDoc('outro-credits', '在视频结尾添加致谢页。用户说「加片尾」「致谢」时使用。', `
# 片尾致谢

## 步骤

1. 在正片结束后追加 5 秒。
2. 背景用最后一帧的模糊图。
3. 依次列出出镜者与制作人员，名单从说话人列表里取。
4. 最后一行是订阅提醒。`)}]}},
    {path: '~/BaoCut/skills/课程录屏整理/', skill: {id: 'screencast-tidy', name: '课程录屏整理', author: '你', category: '剪辑',
      summary: '录屏课程按知识点分段，剪掉等待加载的空白。',
      description: '整理录屏课程：按知识点分章节，剪掉等待和误操作的片段，鼠标操作密集处自动放大。',
      examples: ['把这节录屏课按知识点分段'],
      files: [{path: 'SKILL.md', body: skillDoc('screencast-tidy', '整理录屏课程：分段、剪空白、放大操作区域。', `
# 课程录屏整理

## 步骤

1. 按讲解内容分章节，每个知识点一章。
2. 画面超过 3 秒没有变化且没有讲话的片段，标为可剪。
3. 鼠标连续点击的区域放大到画面的一半。`)},
        {path: 'references/zoom-rules.md', body: '# 放大规则\n\n- 放大与还原各用 0.3 秒过渡\n- 同一区域连续操作时不反复缩放'}]}},
    {path: '~/Downloads/剪辑笔记/', skill: null},
  ];

  const app = {version: '2.2.1', build: 56, skillVersion: '1.4.2'};   // 2026-10-01：对齐自动更新契约的示例，演示 feed 的新版本是 2.3.0（Build 57）

  window.BC_DATA = {
    DUR, speakers, chapters, projectTitle, clips, cues, paras, initialSegments,
    srcLang: LANG.zh, dstLang: LANG.en, activateProject, projectSetup, sourceCues,
    elements, textGroup, ELEMENT_HUE_STOPS,
    projects, ptypes, templates, agentProjects, spaceOutputs,
    agentSkills, agentSkillFolders,
    models, transModels, sttLangs, transLangs,
    tasks, modelActivity, rail, ratios, speeds, zoomMenu, BADGE, app,
    glossary,
    subtitle, fonts, translate, sources, brand, agent, remote, services, skill,
    setModels, setComponents, setSources, setShortcuts, setCrashes,
    canvasStyle, templateItems, elementSpecs,
    textCats, textPresets, textAnims, textStylePresets,
    entries, cutSuggestions,
  };
})();
