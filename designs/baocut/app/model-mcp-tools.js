/* MCP 工具目录 —— §17.6「MCP 服务 › 工具」（2026-09-17）。
   MCP 服务对 Agent 暴露的就是这张表：每个工具一个名字、一句给模型看的描述、一份类型化的
   参数（→ tools/list 里的 inputSchema）和注解（readOnlyHint 等）。页面、演示请求、文档都读这里，
   不再各写一份工具名。

   形状照 MCP Rust SDK（rmcp）的落法来：一个工具 = 一个 `#[tool(description = …)]` 方法，
   参数是一个 `Parameters<T>`（T: Deserialize + JsonSchema），inputSchema 由类型生成 ——
   所以这里不允许「options: object」这种不透明参数，每个字段都要有类型和说明。

   项目是参数：服务默认开放所有项目，Agent 先用 list_projects 拿到项目 id，再把它作为 `project`
   传给其他工具；用户在「开放范围」里收窄过的话，范围外的 id 一律按「不存在」拒绝。

   2026-09-27：权限多一档「直接放行」（access = 'auto'，写入与任务不用确认）；新增「生成」组
   （synthesize_speech / generate_image，不需要项目）、两个读模型表的工具与 cancel_job，17 → 22 个。
   生成类的输出位置永远由服务端定，调用方只能给文件名；参考图只认项目内相对路径。 */
(function (root) {
  'use strict';

  const GROUPS = [
    {k: 'read', label: '读取', hint: '只读，不改视频，直接应答'},
    {k: 'edit', label: '编辑', hint: '写入视频，按一次编辑入撤销栈，可以撤销'},
    {k: 'job', label: '任务', hint: '耗时的活，立即返回 jobId；普通客户端查 get_job，Tasks 扩展客户端查 tasks/get'},
    {k: 'generate', label: '生成', hint: '按文字合成语音、按提示词出图；不需要视频。给了视频就放进视频素材，否则放进 BaoCut 的生成记录'},
  ];

  /* 常用参数片段 */
  const P = {
    project: {name: 'project', type: 'string', required: true, desc: '视频 id，来自 list_projects'},
    lang: (desc) => ({name: 'lang', type: 'string', desc: desc || '语言代码，如 zh、en；省略为原文'}),
    from: {name: 'from', type: 'number', desc: '起点（秒，源素材时钟，与文稿时间同口径）'},
    to: {name: 'to', type: 'number', desc: '终点（秒，源素材时钟）'},
    baseRev: {name: 'baseRev', type: 'integer', desc: '读到的 rev；视频已被改过时以 stale 拒绝，省略则按当前版本写'},
    label: {name: 'label', type: 'string', desc: '撤销栈里显示的名字'},
  };
  const RANGE = {type: 'object', fields: [
    {name: 'from', type: 'number', required: true, desc: '起点（秒）'},
    {name: 'to', type: 'number', required: true, desc: '终点（秒）'},
  ]};
  /* 原文按字幕条（cue）改，译文按句改：这是内核两条编辑通道各自的粒度。 */
  const CUE_EDIT = {type: 'object', fields: [
    {name: 'cueId', type: 'string', required: true, desc: '字幕条 id（q-…），来自 get_transcript(includeCues=true)'},
    {name: 'text', type: 'string', required: true, desc: '改后的整条文字'},
  ]};
  const SENTENCE_EDIT = {type: 'object', fields: [
    {name: 'sentenceId', type: 'string', required: true, desc: '句子 id（s-…），来自 get_transcript'},
    {name: 'text', type: 'string', required: true, desc: '改后的整句译文'},
  ]};

  const CURSOR = {name: 'cursor', type: 'string', desc: '上一页 nextCursor；条件或版本变化时重新开始'};
  const BUDGET = {name: 'maxBytes', type: 'integer', min: 1024, max: 262144, dflt: 16384, desc: '单页业务 JSON 的 UTF-8 字节上限'};
  const TOOLS = [
    /* ---- 读取 ---- */
    {name: 'list_projects', group: 'read', title: '视频列表', noProject: true,
     desc: '列出 BaoCut 开放给你的视频：id、标题、时长、语言、最近编辑时间。其他工具的 project 参数用这里的 id。',
     params: [{name: 'query', type: 'string', desc: '按标题筛选；省略为全部视频的分页'}, CURSOR,
       {name: 'limit', type: 'integer', min: 1, max: 200, dflt: 50, desc: '最多返回几个，按最近编辑排序'}]},
    {name: 'get_project', group: 'read', title: '视频概况',
     desc: '返回一部视频的标题、时长、画幅、原文与译文语言、轨道一览和当前 rev。',
     params: []},
    {name: 'get_transcript', group: 'read', title: '读文稿',
     desc: '按句分页读文稿或译文，默认每句只带 id、起止时间、说话人和正文；编辑时才包含字幕条（cue）。长视频请用 cursor 翻页或用 from / to 限定范围。',
     params: [P.lang(), P.from, P.to, CURSOR, BUDGET,
       {name: 'includeCues', type: 'boolean', dflt: false, desc: '包含编辑所需的字幕条 id、时间及原文'},
       {name: 'sentenceIds', type: 'array', min: 1, max: 200, items: {type: 'string'}, desc: '只读指定句子'},
       {name: 'limit', type: 'integer', min: 1, max: 500, dflt: 20, desc: '每页句数'}]},
    {name: 'search_transcript', group: 'read', title: '搜文稿',
     desc: '在文稿或译文里找文字，返回命中的句子 id、时间和上下文。',
     params: [{name: 'query', type: 'string', required: true, desc: '要找的文字'}, P.lang(), P.from, P.to, CURSOR, BUDGET,
       {name: 'limit', type: 'integer', min: 1, max: 100, dflt: 20, desc: '最多返回几条'}]},
    {name: 'get_timeline', group: 'read', title: '读时间轴',
     desc: '返回源时钟窗口内的 clips 与 cuts，以及源时长和成片时长。',
     params: [P.from, P.to]},
    {name: 'get_chapters', group: 'read', title: '读章节', desc: '返回章节列表（时间点与标题）。', params: []},
    {name: 'list_speakers', group: 'read', title: '说话人', desc: '返回说话人 id、名字与各自的发言时长。', params: []},
    {name: 'list_jobs', group: 'read', title: '任务列表', noProject: true,
     desc: '返回转录、翻译、导出任务；不给 project 就是所有开放视频的任务。',
     params: [{name: 'project', type: 'string', desc: '只看这部视频；省略为所有开放视频'},
       {name: 'state', type: 'string', enum: ['running', 'done', 'failed'], desc: '只看某种状态；省略为全部'}, CURSOR,
       {name: 'limit', type: 'integer', min: 1, max: 200, dflt: 50, desc: '每页任务数'}]},
    {name: 'get_job', group: 'read', title: '任务进度', noProject: true,
     desc: '查一个任务的状态、进度百分比与产物路径。生成类任务结束后，结果里直接带上音频或图片（单个 4 MB 以内）。',
     params: [{name: 'jobId', type: 'string', required: true, desc: '任务 id，来自任务类工具的返回'}]},
    {name: 'list_tts_models', group: 'read', title: '语音模型', noProject: true,
     desc: '列出这台电脑上的语音合成模型：是否已下载、认哪些语言和参数、内置音色，以及用户保存的「我的声音」。调用 synthesize_speech 前先读它。',
     params: []},
    {name: 'list_image_models', group: 'read', title: '图像模型', noProject: true,
     desc: '列出可用的图像生成模型（本机模型与已配置的云端 API 提供方）：是否就绪、支持的比例与尺寸、价格。调用 generate_image 前先读它。',
     params: []},

    /* ---- 编辑 ---- */
    {name: 'edit_transcript', group: 'edit', title: '改文稿',
     desc: '改写若干条原文字幕。只换文字，时间由 BaoCut 重新对齐到词。',
     params: [{name: 'edits', type: 'array', required: true, items: CUE_EDIT, min: 1, max: 200, desc: '要改的字幕条'}, P.baseRev, P.label]},
    {name: 'edit_translation', group: 'edit', title: '改译文',
     desc: '改写某个语言的若干句译文。',
     params: [Object.assign({}, P.lang('译文语言代码'), {required: true}),
       {name: 'edits', type: 'array', required: true, items: SENTENCE_EDIT, min: 1, max: 200, desc: '要改的句子'}, P.baseRev, P.label]},
    {name: 'cut_ranges', group: 'edit', title: '剪掉 / 恢复片段',
     desc: '把若干时间区间从成片里剪掉（贯穿所有轨），或把已剪掉的恢复回来。不删素材。',
     params: [{name: 'ranges', type: 'array', required: true, items: RANGE, min: 1, max: 500, desc: '时间区间'},
       {name: 'restore', type: 'boolean', dflt: false, desc: 'true 为恢复与这些区间重叠的已有剪口'}, P.baseRev, P.label]},
    {name: 'set_chapters', group: 'edit', title: '写章节',
     desc: '整体替换章节列表。', idempotent: true,
     params: [{name: 'chapters', type: 'array', required: true, desc: '章节，按时间升序',
       items: {type: 'object', fields: [
         {name: 'at', type: 'number', required: true, desc: '起点（秒）'},
         {name: 'title', type: 'string', required: true, desc: '章节标题'}]}}, P.baseRev]},
    {name: 'rename_speaker', group: 'edit', title: '改说话人名字',
     desc: '给一个说话人改名。', idempotent: true,
     params: [{name: 'speakerId', type: 'string', required: true, desc: '说话人 id，来自 list_speakers'},
       {name: 'name', type: 'string', required: true, desc: '新名字'}]},

    /* ---- 任务 ---- */
    {name: 'start_transcribe', group: 'job', title: '转录',
     desc: '为视频媒体生成文稿。已有文稿时会整体重做，属于破坏性操作。', destructive: true,
     params: [{name: 'language', type: 'string', desc: '媒体语言代码；省略为自动识别'},
       {name: 'diarize', type: 'boolean', dflt: true, desc: '是否区分说话人'}]},
    {name: 'start_translate', group: 'job', title: '翻译',
     desc: '把文稿翻译成目标语言并对齐成字幕。',
     params: [{name: 'target', type: 'string', required: true, desc: '目标语言代码'}]},
    {name: 'export', group: 'job', title: '导出',
     desc: '导出成片或字幕文件，只写进视频的 exports/ 目录。',
     params: [{name: 'kind', type: 'string', required: true, enum: ['mp4', 'srt', 'vtt'], desc: '导出格式'},
       {name: 'name', type: 'string', desc: '文件名（不含目录）；省略用默认名'},
       P.lang('字幕语言；省略跟随视频当前字幕设置'),
       {name: 'range', type: 'object', fields: RANGE.fields, desc: '只导出这一段（成片时钟，剪完之后的时间）；省略为整片'}]},
    {name: 'cancel_job', group: 'job', title: '取消任务', noProject: true, direct: true,
     desc: '取消一个经 MCP 发起、已经拿到任务 id 的任务：能停就停，停不了会明确说明。还在等你确认的调用没有任务 id，由 Agent 用 tasks/cancel 撤回，或你在 BaoCut 里拒绝。',
     params: [{name: 'jobId', type: 'string', required: true, desc: '任务 id，只认经 MCP 发起的任务'}]},

    /* ---- 生成（不需要项目；输出位置由 BaoCut 定，只能给文件名） ---- */
    {name: 'synthesize_speech', group: 'generate', title: '合成语音', noProject: true,
     desc: '把一段文字合成语音（WAV）。先用 list_tts_models 看有哪些模型和音色；不给 model 按语言挑默认模型。另有采样与云端 API 提供方的调参（temperature、topP、pitch、stability…），模型不认的参数会被拒绝。',
     params: [{name: 'text', type: 'string', required: true, desc: '要念的文字'},
       {name: 'model', type: 'string', desc: '模型 id，来自 list_tts_models；省略按语言挑默认'},
       {name: 'voice', type: 'string', desc: '音色：list_tts_models 里的内置音色名，或「我的声音」my:<id>；省略用模型默认'},
       {name: 'language', type: 'string', desc: '文字的语言代码（zh、en、ja…）；省略为自动识别'},
       {name: 'instruct', type: 'string', desc: '说话风格或音色描述，模型支持时生效'},
       {name: 'emotion', type: 'string', desc: '情绪名（neutral、happy…），模型支持时生效'},
       {name: 'duration', type: 'number', min: 0.1, max: 3600, desc: '目标时长（秒），模型能钉时长时生效'},
       {name: 'speed', type: 'number', min: 0.1, max: 10, desc: '语速倍数（云端模型）'},
       {name: 'seed', type: 'integer', desc: '随机种子，固定后可复现'},
       {name: 'annotate', type: 'string', enum: ['auto', 'off'], dflt: 'auto', desc: '中文多音字注音：auto 按词典定，off 只认文中已有的标注'},
       {name: 'align', type: 'boolean', dflt: false, desc: '同时对齐出逐词、逐句时间'},
       {name: 'offline', type: 'boolean', dflt: false, desc: '缺权重时报错而不是下载'},
       {name: 'project', type: 'string', desc: '放进这部视频的 media/tts/；省略则放进 BaoCut 的语音生成目录'},
       {name: 'name', type: 'string', desc: '文件名（不含目录）；省略自动命名，同名不覆盖'}]},
    {name: 'generate_image', group: 'generate', title: '生成图片', noProject: true,
     desc: '按一句提示词生成 PNG 图片。先用 list_image_models 看哪些模型就绪、支持什么尺寸；不给 model 用设置里的默认。',
     params: [{name: 'prompt', type: 'string', required: true, desc: '要画什么'},
       {name: 'model', type: 'string', desc: '模型 id，来自 list_image_models；省略用默认'},
       {name: 'aspect', type: 'string', desc: '画面比例，如 16:9、1:1'},
       {name: 'size', type: 'array', min: 2, max: 2, items: {type: 'integer', desc: '像素'}, desc: '[宽, 高]，与 aspect 二选一'},
       {name: 'quality', type: 'string', desc: '清晰度档位，模型支持时生效'},
       {name: 'n', type: 'integer', min: 1, max: 16, dflt: 1, desc: '生成几张；给了 name 时只能是 1'},
       {name: 'seed', type: 'integer', desc: '随机种子，固定后可复现'},
       {name: 'steps', type: 'integer', desc: '采样步数，本机模型生效'},
       {name: 'transparent', type: 'boolean', dflt: false, desc: '透明背景，模型支持时生效'},
       {name: 'negative', type: 'string', desc: '不想出现的内容，模型支持时生效'},
       {name: 'refs', type: 'array', max: 4, items: {type: 'string', desc: '视频内相对路径'}, desc: '参考图，只认视频里的文件，要同时给 project'},
       {name: 'project', type: 'string', desc: '放进这部视频的素材（media/ai-images/）；省略则放进 BaoCut 的生成记录'},
       {name: 'name', type: 'string', desc: '文件名（不含目录）；省略自动命名'}]},
  ];

  /* 除了标 noProject 的，其余工具第一个参数都是必填的 project。 */
  TOOLS.forEach((t) => { if (!t.noProject) t.params = [P.project].concat(t.params); });

  const byName = (name) => TOOLS.find((t) => t.name === name) || null;
  const isWrite = (t) => t.group !== 'read';

  /* 参数描述 → JSON Schema 片段 */
  function schemaOf(p) {
    const s = {type: p.type};
    if (p.desc) s.description = p.desc;
    if (p.enum) s.enum = p.enum.slice();
    if (p.dflt !== undefined) s.default = p.dflt;
    if (p.type === 'array') {
      s.items = schemaOf(p.items);
      if (p.min != null) s.minItems = p.min;
      if (p.max != null) s.maxItems = p.max;
    } else {
      if (p.min != null) s.minimum = p.min;
      if (p.max != null) s.maximum = p.max;
    }
    if (p.type === 'object') Object.assign(s, objectSchema(p.fields || []));
    return s;
  }
  function objectSchema(fields) {
    const props = {};
    fields.forEach((f) => { props[f.name] = schemaOf(f); });
    const req = fields.filter((f) => f.required).map((f) => f.name);
    const s = {type: 'object', properties: props, additionalProperties: false};
    if (req.length) s.required = req;
    return s;
  }
  /** tools/list 里这个工具的 inputSchema。 */
  const inputSchema = (t) => objectSchema(t.params);

  /** MCP 工具注解。写工具默认非破坏（可撤销），只有整体重做类标 destructive。 */
  function annotations(t) {
    if (!isWrite(t)) return {title: t.title, readOnlyHint: true, openWorldHint: false};
    return {title: t.title, readOnlyHint: false, destructiveHint: !!t.destructive, idempotentHint: !!t.idempotent, openWorldHint: false};
  }

  /** tools/list 的一项。 */
  const descriptor = (t) => ({name: t.name, description: t.desc, inputSchema: inputSchema(t), annotations: annotations(t)});

  /** 一个工具在当前设置下的去向（access：read 只读 / ask 修改前询问 / auto 直接放行）：
      off     用户关掉了，不进 tools/list
      hidden  「只读」权限下的写工具，不进 tools/list
      auto    直接执行（读取类是直接应答）
      ask     调用先在 BaoCut 里确认
      cancel_job 只撤 MCP 自己起的任务、不改项目内容，在 ask 下也不用确认。 */
  function gate(t, access, off) {
    if ((off || []).indexOf(t.name) >= 0) return 'off';
    if (!isWrite(t)) return 'auto';
    if (access === 'auto' || (access === 'ask' && t.direct)) return 'auto';
    return access === 'ask' ? 'ask' : 'hidden';
  }
  const GATE_LABEL = {off: '已关闭', hidden: '只读权限下不提供', auto: '直接执行', ask: '调用前询问'};
  /** 去向 chip 的字：读取类的 auto 叫「直接应答」，写入类的 auto 叫「直接执行」。 */
  const gateLabel = (g, t) => (g === 'auto' && t && !isWrite(t)) ? '直接应答' : GATE_LABEL[g];

  /** Agent 在 tools/list 里看得到的工具。 */
  const exposed = (access, off) => TOOLS.filter((t) => { const g = gate(t, access, off); return g === 'auto' || g === 'ask'; });

  /** 标题右侧的一句话：「提供 16 个工具 · 8 个调用前询问」。 */
  function summary(access, off) {
    const ex = exposed(access, off);
    const writes = ex.filter(isWrite);
    const ask = writes.filter((t) => gate(t, access, off) === 'ask').length;
    if (!ex.length) return '没有提供任何工具';
    const tail = ask ? ' · ' + ask + ' 个调用前询问' : writes.length ? ' · 不需要确认' : ' · 全部只读';
    return '提供 ' + ex.length + ' / ' + TOOLS.length + ' 个工具' + tail;
  }

  const groups = () => GROUPS.map((g) => Object.assign({}, g, {tools: TOOLS.filter((t) => t.group === g.k)}));

  /** 参数类型的短写：string、integer 1–500、enum、object[] … */
  function typeLabel(p) {
    if (p.enum) return p.enum.map((v) => '"' + v + '"').join(' | ');
    if (p.type === 'array') return (p.items.type === 'object' ? '{' + p.items.fields.map((f) => f.name).join(', ') + '}' : p.items.type) + '[]';
    if (p.type === 'object') return '{' + (p.fields || []).map((f) => f.name).join(', ') + '}';
    if (p.min != null && p.max != null) return p.type + ' ' + p.min + '–' + p.max;
    return p.type;
  }

  /** 校验一次调用的实参（演示与测试用；真实校验由 schema 反序列化完成）。返回错误文案数组。 */
  function validate(name, args) {
    const t = byName(name);
    if (!t) return ['未知工具 ' + name];
    const a = args || {};
    const errs = [];
    const known = t.params.map((p) => p.name);
    Object.keys(a).forEach((k) => { if (known.indexOf(k) < 0) errs.push('多余的参数 ' + k); });
    t.params.forEach((p) => {
      const v = a[p.name];
      if (v === undefined) { if (p.required) errs.push('缺少必填参数 ' + p.name); return; }
      const ok = p.type === 'array' ? Array.isArray(v)
        : p.type === 'integer' ? Number.isInteger(v)
        : p.type === 'object' ? (v && typeof v === 'object' && !Array.isArray(v))
        : typeof v === p.type;
      if (!ok) { errs.push(p.name + ' 应为 ' + p.type); return; }
      if (p.enum && p.enum.indexOf(v) < 0) errs.push(p.name + ' 只能是 ' + p.enum.join(' / '));
      if (p.type === 'array') {
        if (p.min != null && v.length < p.min) errs.push(p.name + ' 至少 ' + p.min + ' 项');
        if (p.max != null && v.length > p.max) errs.push(p.name + ' 最多 ' + p.max + ' 项');
      } else if (typeof v === 'number') {
        if (p.min != null && v < p.min) errs.push(p.name + ' 不能小于 ' + p.min);
        if (p.max != null && v > p.max) errs.push(p.name + ' 不能大于 ' + p.max);
      }
    });
    return errs;
  }

  /** 请求记录里的一行：`get_transcript {lang: "en", limit: 20}`；数组只写长度。 */
  function callLine(name, args) {
    const keys = Object.keys(args || {});
    if (!keys.length) return name;
    const val = (v) => Array.isArray(v) ? '[' + v.length + ' 项]' : (v && typeof v === 'object') ? '{…}' : JSON.stringify(v);
    return name + ' {' + keys.map((k) => k + ': ' + val(args[k])).join(', ') + '}';
  }

  /* 演示调用（原型没有真服务）：一个客户端连进来后的头几次请求，和一条等确认的写入。 */
  const DEMO = {
    requests: [
      {id: 'q4', tool: 'get_transcript', args: {project: '$project', lang: 'en', limit: 20}},
      {id: 'q3', tool: 'get_project', args: {project: '$project'}},
      {id: 'q2', tool: 'list_projects', args: {}},
      {id: 'q1', method: 'tools/list'},
      {id: 'q0', method: 'initialize'},
    ],
    pending: {tool: 'edit_translation', args: {project: '$project', lang: 'en', label: '润色英文译文',
      edits: Array.from({length: 12}, (_, i) => ({sentenceId: 's' + (i + 41), text: 'This sentence explains how the workflow stays reliable.'}))},
      summary: '改写 12 句英文译文。允许后按一次编辑写入，可以撤销。'},
  };

  /** 演示调用里的 `$project` 换成一个真的项目 id。 */
  const withProject = (args, id) => { const o = Object.assign({}, args); if (o.project === '$project') o.project = id; return o; };

  const api = {DEMO, withProject, GROUPS, TOOLS, byName, isWrite, inputSchema, annotations, descriptor, gate, gateLabel, exposed, summary, groups, typeLabel, validate, callLine};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BC_MCPTOOLS = api;
})(typeof window !== 'undefined' ? window : globalThis);
