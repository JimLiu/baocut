/* Open Artifact 的作品（docs/design/artifacts §4–§6）：会话里的作品回执、产物卡上的类型、功能区的作品标签与 `/artifacts` 命令。
   纯函数，无 React、无 DOM；只在 App 入口加载。window.BC_HOME_ARTIFACTS。
   「作品」是 Open Artifact 的 artifact，与 Job 的产物不同（术语表「作品」）。作品由智能体经 Open Artifact 的 daemon 做，
   BaoCut 不存它的内容：会话时间线上每份作品一条回执 `{role: 'artifact', url, title, type, taskId}`（原型把它记成一条消息），
   同一份作品之后再改，回执原地更新（卡片留在第一次出现的那一轮，标题与类型取最近一次的，见 BC_AGENT_PROJECTS.sessionArtifacts）。
   文案照 packages/ui 的 artifacts-copy.zh-Hans.ts；原型只写中文。 */
(function () {
  const COPY = {
    kind: '作品',
    untitled: '未命名作品',
    opening: '正在打开作品…',
    unavailable: '作品暂时不可用。',
    openFailed: '打不开这份作品。',
    retry: '重试',
  };

  /* Open Artifact 自带的八种类型：名字与图标（packages/ui artifact-icon.tsx）；别的类型（自装的）名字退回「作品」、图标用设计稿那一个 */
  const TYPES = {
    slides: {label: '幻灯片', icon: 'Layout'},
    docs: {label: '文档', icon: 'TextParagraph'},
    design: {label: '设计稿', icon: 'Shapes'},
    'design-system': {label: '设计系统', icon: 'ColorHarmony'},
    sheets: {label: '表格', icon: 'Table'},
    data: {label: '数据看板', icon: 'ChartBarVert'},
    whiteboard: {label: '白板', icon: 'Draw'},
    motion: {label: '动画', icon: 'Animation'},
  };
  const has = (type) => typeof type === 'string' && Object.prototype.hasOwnProperty.call(TYPES, type);
  const typeLabel = (type) => (has(type) ? TYPES[type].label : COPY.kind);
  const iconName = (type) => (has(type) ? TYPES[type].icon : 'Shapes');

  /* 作品链接 `open-artifact://artifact/<id>`；路由与标签只带 id */
  const PREFIX = 'open-artifact://artifact/';
  const urlOf = (id) => PREFIX + id;
  const idOf = (url) => (typeof url === 'string' && url.startsWith(PREFIX) && url.length > PREFIX.length ? url.slice(PREFIX.length) : null);

  /** 所有会话里这份作品最近一次的回执：{id, url, title, type, taskId, session}；没有返回 null。标签恢复时靠它找回标题与类型。 */
  function find(sessions, id) {
    const url = urlOf(id);
    let found = null;
    for (const s of sessions || []) {
      for (const m of s.messages || []) {
        if (m.role === 'artifact' && m.url === url) found = {id, url, title: m.title || '', type: m.type || '', taskId: m.taskId || null, session: s.id};
      }
    }
    return found;
  }

  /** 标签上的名字：作品标题，没有标题时「未命名作品」。 */
  const tabTitle = (info) => (info && info.title) || COPY.untitled;

  /** 产物卡上的一行字：类型名（认不出的类型是「作品」）。 */
  const cardDetail = (item) => typeLabel(item && item.type);

  /* `/artifacts` 命令（docs/design/artifacts §6）：开头的 `/artifacts`，后面是空白或结束，不分大小写 */
  const COMMAND = '/artifacts';
  const isCommand = (text) => /^\/artifacts(?:\s|$)/i.test(String(text || '').trim());
  const request = (text) => String(text || '').trim().replace(/^\/artifacts\b/i, '').trim();

  /* 原型模拟：按请求里的字眼猜一种类型（正式版由智能体自己定） */
  const GUESS = [
    [/设计系统|design system/i, 'design-system'],
    [/幻灯片|课件|演示稿|slides?|deck/i, 'slides'],
    [/表格|sheet/i, 'sheets'],
    [/看板|仪表|dashboard|数据/i, 'data'],
    [/白板|whiteboard/i, 'whiteboard'],
    [/动画|motion|animation/i, 'motion'],
    [/文档|计划|报告|doc/i, 'docs'],
  ];
  function guessType(text) {
    const hit = GUESS.find(([re]) => re.test(text));
    return hit ? hit[1] : 'design';
  }
  function titleOf(text) {
    const first = request(text).split(/[\n。！？!?]/)[0].trim();
    if (!first) return '新作品';
    return first.length > 24 ? first.slice(0, 24) + '…' : first;
  }

  /** 原型里发出 `/artifacts …` 之后的一轮：读 skill、调 Open Artifact 的 `Artifact` 工具建作品、回执、回复。
      `sessions` 用来给新作品挑一个没用过的 id。 */
  function replyPlan(text, sessions) {
    const type = guessType(request(text));
    const title = titleOf(text);
    let n = 1;
    while (find(sessions, 'art-new-' + n)) n += 1;
    const url = urlOf('art-new-' + n);
    return {
      kind: 'artifact', write: null, task: null,
      summary: `按 artifacts skill 做一份${typeLabel(type)}。`,
      reads: [
        {cmd: '读取 skill artifacts · SKILL.md', kind: 'read', summary: 'artifacts'},
        {cmd: `Artifact create · ${typeLabel(type)} · ${title}`, kind: 'other', summary: `Artifact create · ${title}`},
      ],
      close: `做好了：「${title}」。点下面的卡片在右侧打开；在页面上留的评论会直接回到这条会话。`,
      artifact: {url, title, type, taskId: null},
    };
  }

  const root = typeof window !== 'undefined' ? window : globalThis;
  root.BC_HOME_ARTIFACTS = {COPY, TYPES, typeLabel, iconName, PREFIX, urlOf, idOf, find, tabTitle, cardDetail, COMMAND, isCommand, request, guessType, replyPlan};
})();
