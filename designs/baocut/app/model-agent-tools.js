/* BaoCut 原型 — 会话线程里 BaoCut 自己的工具（架构设计 §3.5 的工具目录）在步骤行上怎么念
   window.BC_AGENT_TOOLS。无 React、无 DOM，node --test 直接 require。

   智能体经 MCP 调 BaoCut 的工具时，折叠的步骤行不写「其他工具」，而是这一类自己的名字加一句摘要：
   「读取视频 · 科浪访谈双语版」「检索文稿 · 口癖」「转录 · moss-transcribe · 3 分 26 秒」「翻译 · 英语 · 62 句」。
   同一个工具按参数可以是不同的类别：`edits_apply` 写一份译文是「翻译」，删区间是「剪辑」。

   参数是原型里的「参数摘要」，不是完整的请求：只带念得出来的几样（视频名、查询词、模型、时长、句数、处数……）。
   工具名两种写法都认：MCP 的 `models_synthesize_speech` 与网关的 `models.synthesizeSpeech`。认不出的返回 null，
   由 model-agent-turn.js 的 `toolStep` 按原来的写法推。 */
(function () {
  /** `3 分 26 秒`、`52 分钟`、`1 小时 2 分`、`45 秒`。 */
  function spoken(sec) {
    const total = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h) return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
    if (m) return s ? `${m} 分 ${s} 秒` : `${m} 分钟`;
    return `${s} 秒`;
  }
  /** `01:12`、`1:02:05`：画面截取的时间点。 */
  function at(sec) {
    const total = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(total / 3600);
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  const base = (p) => String(p || '').split('/').filter(Boolean).pop() || '';
  const join = (...xs) => xs.filter((x) => x != null && x !== '').join(' · ');
  const n = (v, unit) => (v == null || v === '' ? null : `${v} ${unit}`);

  /** 网关名与 MCP 名都归成 MCP 名：点换下划线、驼峰拆开。 */
  function normalize(name) {
    return String(name || '').trim().replace(/\./g, '_').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  }

  /* `edits_apply` / `edits_propose`：按参数里的操作分类别。剪辑的「处」带着原因（停顿、口癖），翻译带语言与句数。 */
  function editKind(a) {
    if (a.putDocument && /translation/.test(a.putDocument.schema || a.putDocument.kind || '')) {
      return {kind: 'translate', label: '翻译', icon: 'translate', summary: join(a.putDocument.language, n(a.putDocument.units, '句'))};
    }
    if (a.cut) return {kind: 'cut', label: '剪辑', icon: 'split', summary: a.cut.count != null ? `${a.cut.count} 处${a.cut.what || ''}` : a.cut.what || ''};
    if (a.importAsset) return {kind: 'import', label: '导入素材', icon: 'download', summary: a.importAsset.name || ''};
    if (a.putDocument) return {kind: 'document', label: '写入文稿', icon: 'transcript', summary: a.putDocument.name || ''};
    return {kind: 'edit-video', label: '修改视频', icon: 'edit', summary: a.ops != null ? `${a.ops} 项操作` : a.label || ''};
  }

  const CAPABILITY = {transcribe: '语音识别', synthesizeSpeech: '语音合成', generateImage: '图像生成', generateText: '文本生成', separateAudio: '音源分离'};

  /* 工具名 → (参数 → {kind, label, summary, icon})。kind 是步骤行的类别键，也是 `workKind` 归组的依据（都算「调用了工具」）。
     图标只用 icons.jsx 里已有的几何。 */
  const CATALOG = {
    videos_inspect: (a) => ({kind: 'video-read', label: '读取视频', icon: 'film', summary: a.video || base(a.path)}),
    timeline_query: (a) => ({kind: 'timeline', label: '查询时间线', icon: 'layers', summary: join(a.video, a.range || a.query)}),
    speech_search: (a) => ({kind: 'speech-search', label: '检索文稿', icon: 'search', summary: a.query || ''}),
    documents_read: (a) => ({kind: 'document-read', label: '读取文稿', icon: 'transcript', summary: join(a.document || a.name, n(a.sentences, '句'))}),
    edits_apply: editKind,
    edits_propose: (a) => Object.assign(editKind(a), {label: '提出修改', icon: 'edit'}),
    edits_undo: (a) => ({kind: 'undo', label: '撤销修改', icon: 'undo', summary: a.label || ''}),
    models_capabilities: (a) => ({kind: 'model-read', label: '查看模型能力', icon: 'settings', summary: CAPABILITY[a.capability] || a.capability || '全部能力'}),
    models_transcribe: (a) => ({kind: 'transcribe', label: '转录', icon: 'transcript', summary: join(a.model, a.duration != null ? spoken(a.duration) : null)}),
    models_synthesize_speech: (a) => ({kind: 'speech', label: '合成语音', icon: 'wave', summary: join(n(a.lines != null ? a.lines : 1, '句'), a.voice)}),
    models_generate_image: (a) => ({kind: 'image', label: '生成图片', icon: 'image', summary: n(a.count != null ? a.count : 1, '张')}),
    captions_create: (a) => ({kind: 'captions', label: '建字幕层', icon: 'captions', summary: a.bilingual ? `${a.pair || '中英'}双语` : a.language || a.document || '原文'}),
    exports_create: (a) => ({kind: 'export', label: '导出', icon: 'export', summary: join(a.resolution || a.format, a.what)}),
    jobs_inspect: (a) => ({kind: 'job', label: '查看任务', icon: 'tasks', summary: a.label || a.jobId || ''}),
    /* 等一件任务结束（架构设计 §3.5：一次最多 50 秒，没等到再调）；步骤行念任务名 */
    jobs_wait: (a) => ({kind: 'job', label: '等待任务', icon: 'tasks', summary: a.label || a.jobId || ''}),
    artifacts_save: (a) => ({kind: 'artifact', label: '保存产物', icon: 'download', summary: a.path || ''}),
    /* 从链接下载视频（这时视频还没创建；下载完成后建出视频记录，会话里那张下载卡原位换成视频卡） */
    downloads_fetch: (a) => ({kind: 'download', label: '下载视频', icon: 'download', summary: join(a.site, a.name || a.title || a.url)}),
    downloads_save: (a) => ({kind: 'download', label: '放到下载', icon: 'download', summary: a.name || base(a.path)}),
    space_list: (a) => ({kind: 'space', label: '浏览 Space', icon: 'asset', summary: a.filter || a.kind || ''}),
    space_search: (a) => ({kind: 'space-search', label: '搜索 Space', icon: 'search', summary: a.query || ''}),
    previews_capture: (a) => ({kind: 'capture', label: '截取画面', icon: 'image', summary: a.at != null ? at(a.at) : ''}),
  };
  const NAMES = Object.keys(CATALOG);

  /** 一次 BaoCut 工具调用在步骤行上的样子；不是 BaoCut 的工具返回 null。 */
  function describe(tool, args) {
    const f = CATALOG[normalize(tool)];
    if (!f) return null;
    const out = f(args || {});
    return {kind: out.kind, label: out.label, summary: String(out.summary || '').trim(), icon: out.icon};
  }

  /** 展开后「输入」一节的文字：MCP 名加参数摘要的 JSON。 */
  function callText(tool, args) {
    const a = args && Object.keys(args).length ? ' ' + JSON.stringify(args, null, 2) : '';
    return normalize(tool) + a;
  }

  window.BC_AGENT_TOOLS = {describe, callText, normalize, spoken, NAMES};
})();
