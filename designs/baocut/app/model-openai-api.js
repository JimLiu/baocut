/* Web 服务 › OpenAI 兼容 API 的纯模型 —— §17.6（2026-09-27 第二版，设计稿 docs/design/cli/bcut-serve-openai-api-design.md）。
   路径与 OpenAI 一字不差：Base URL 是 `http://127.0.0.1:<端口>/v1`，只有主机和端口不同；
   允许局域网访问时（GitHub issue 106，架构设计 §4.8 / §12.8 待改）局域网里的设备另用 `http://<本机局域网 IP>:<端口>/v1`。
   `model` 与 OpenAI 一样必填（出图可不写，用默认）；本机模型的 id 直接能用，别的名字要在「模型映射」里登记，
   都不是就 404 MODEL_NOT_FOUND（设计稿 §3）。映射是多对多：一个名字可以指向几只模型（每一类按顺序取第一只已下载的），
   一只模型也可以挂几个名字；目标写 `default:<能力>` 时跟着 设置 › 模型 › 本地模型 里那一类的默认走。
   参数表按内核实际收的字段手写（设计稿 §4），不做单一来源、不出 openapi.json。
   这里只算：能力与端点目录、地址、模型现场（ctxOf）、模型解析、映射校验、端口校验、试用区、代码片段、演示响应。 */
(function () {
  const HOST = 'http://127.0.0.1';
  const WEB_PORT = 24320;                               // 与 BC_SERVICES.WEB_DEFAULT_PORT 同
  const RESERVED = {24350: '远端算力', 24351: 'MCP 服务'}; // 与 BC_SERVICES 的保留端口同

  /* 顺序就是 API 页能力块的顺序。`cat` = 设置 › 模型 › 本地模型的分类键。 */
  const CAPS = [
    {k: 'asr', name: '语音识别', icon: 'mic', cat: 'asr', desc: '上传音频或视频，返回文字、字幕或带时间的 JSON'},
    {k: 'tts', name: '语音合成', icon: 'audio', cat: 'tts', desc: '传入文字，返回语音'},
    {k: 'image', name: '图像生成', icon: 'image', cat: 'image', desc: '传入一句描述，返回一张图'},
  ];
  const capBy = (k) => CAPS.find((c) => c.k === k) || null;

  /* ---------- 语音合成：按模型收哪些字段（与 bcut-tts 的能力表同，设计稿 §4.2） ----------
     voice: 'preset' = 把 voice 当模型自带说话人名；其余模型不看 voice。 */
  const TTS_SUPPORT = [
    [/customvoice$/, {voice: 'preset', instructions: true}],
    [/voicedesign$/, {instructions: true}],
    [/^qwen3-tts-.*-base$/, {reference_audio: true, reference_text: true}],
    [/^index-?tts/, {reference_audio: true}],
    [/^voxcpm/, {reference_audio: true, reference_text: true, instructions: true}],
    [/^omnivoice/, {reference_audio: true, reference_text: true, instructions: true}],
  ];
  const ttsSupport = (id) => { const hit = TTS_SUPPORT.find(([re]) => re.test(id || '')); return hit ? hit[1] : {}; };
  /** 这个参数这只模型收不收：参数没标 `by` 时回 true。 */
  const supports = (p, modelId) => !p.by || !!ttsSupport(modelId)[p.by];
  /** OpenAI 自家音色名：本机模型没有这些说话人，收到按默认音色念（内核 OPENAI_VOICES）。 */
  const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'fable', 'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

  /* ---------- 出图：按模型的步数范围（与 BC_CLOUD_IMAGE 的 caps.steps 同）。上下限相同 = 蒸馏模型固定步数 ---------- */
  const IMAGE_STEPS = {
    'qwen-image-2.1': {min: 8, max: 40, dflt: 20},
    'qwen-image-2.1-turbo': {min: 8, max: 8, dflt: 8},
  };
  const imageSteps = (id) => IMAGE_STEPS[id] || IMAGE_STEPS['qwen-image-2.1'];

  /* ---------- 端点表 ----------
     group: 'models' 或能力键；path 与 OpenAI 相同（相对 /v1）。
     param: {name, loc: 'path'|'form'|'json', kind: 'file'|'model'|'voice'|'text'|'longtext'|'enum'|'multi'|'int',
             req, dflt, values, doc, ext（OpenAI 没有、BaoCut 加的字段）, more（折进「更多参数」）, by（只有部分模型收，键见 TTS_SUPPORT）,
             ignored（接受但忽略）, reject（只认 values 里的值，其余 400）}
     resp: 'models' | 'model' | 'text'（随 response_format）| 'audio' | 'image' */
  const MODEL_DOC = '本机模型的 id（可带 local/ 前缀，/v1/models 列的就是带前缀的写法），或「模型映射」里登记的名字；都不是返回 404 MODEL_NOT_FOUND。';
  const ENDPOINTS = [
    {id: 'models.list', group: 'models', method: 'GET', path: '/models', title: '列出模型', resp: 'models',
      summary: '映射里能落到已下载模型的名字在前，然后是这台电脑上已下载、能用的模型（写成 local/<id>）。在某一类的独立端口上只列那一类。', params: [],
      errors: []},
    {id: 'models.retrieve', group: 'models', method: 'GET', path: '/models/{model}', title: '查一只模型', resp: 'model',
      summary: '按 /v1/models 里的 id（映射名或 local/<id>）查一只模型，也认不带前缀的本机 id；返回的 id 就是请求里写的。', params: [
        {name: 'model', loc: 'path', kind: 'model', req: true, doc: MODEL_DOC},
      ],
      errors: ['MODEL_NOT_FOUND']},

    {id: 'asr.transcriptions', group: 'asr', method: 'POST', path: '/audio/transcriptions', title: '转录音频', resp: 'text',
      body: 'multipart/form-data',
      summary: '上传一段音频或视频，返回识别出的文字。可以直接要 SRT / VTT 字幕，或带分段与逐词时间的 JSON。',
      params: [
        {name: 'file', loc: 'form', kind: 'file', req: true,
          doc: '要转录的音频或视频，常见格式都行（m4a、mp3、wav、mp4、mov…），最大 512 MB。'},
        {name: 'model', loc: 'form', kind: 'model', req: true, doc: MODEL_DOC},
        {name: 'language', loc: 'form', kind: 'text', placeholder: '自动识别',
          doc: '音频的语言，如 zh、en、ja。不写就自动识别。'},
        {name: 'response_format', loc: 'form', kind: 'enum', dflt: 'json', values: ['json', 'verbose_json', 'text', 'srt', 'vtt'], reject: true,
          doc: 'json 只有文字；verbose_json 带分段、语言与时长；text 是纯文本；srt / vtt 是字幕。diarized_json 不支持，返回 400。'},
        {name: 'timestamp_granularities[]', loc: 'form', kind: 'multi', values: ['segment', 'word'], more: true,
          doc: '含 word 时 verbose_json 里多返回逐词时间 words。只在 verbose_json 下有效。'},
        {name: 'prompt', loc: 'form', kind: 'text', more: true, placeholder: '专有名词、上下文',
          doc: '识别提示：人名、术语、上下文。不支持提示的模型忽略。'},
        {name: 'temperature', loc: 'form', ignored: true},
        {name: 'stream', loc: 'form', ignored: true, note: '写 true 也拿到一次性返回的完整结果，不是 SSE'},
        {name: 'include[]', loc: 'form', ignored: true},
        {name: 'chunking_strategy', loc: 'form', ignored: true},
      ],
      errors: ['INVALID_REQUEST', 'UNSUPPORTED_PARAMETER', 'PAYLOAD_TOO_LARGE', 'MODEL_NOT_FOUND', 'TOO_MANY_REQUESTS', 'JOB_CANCELLED', 'INTERNAL']},

    {id: 'tts.speech', group: 'tts', method: 'POST', path: '/audio/speech', title: '合成语音', resp: 'audio',
      body: 'application/json',
      summary: '传入一段文字，返回念出来的音频。',
      params: [
        {name: 'model', loc: 'json', kind: 'model', req: true, doc: MODEL_DOC},
        {name: 'input', loc: 'json', kind: 'longtext', req: true, dflt: '你好，这是 BaoCut 在这台电脑上合成的声音。',
          doc: '要念的文字。'},
        {name: 'voice', loc: 'json', kind: 'voice', by: 'voice',
          doc: 'OpenAI 里必填，这里可不写。只有 CustomVoice 模型看它，填模型自带的说话人名（Vivian、Eric…）；alloy 这类 OpenAI 音色名、不写，都用默认音色。其余模型不看 voice，换声音用 reference_audio。'},
        {name: 'response_format', loc: 'json', kind: 'enum', dflt: 'mp3', values: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'], reject: true,
          doc: 'wav 是模型原生采样率；pcm 是 24 kHz 16 位单声道裸流；mp3 / opus / aac / flac 要这台电脑上有 ffmpeg，没有时任务失败，返回 500（code 是任务的错误码）。'},
        {name: 'instructions', loc: 'json', kind: 'text', more: true, by: 'instructions', placeholder: '比如：放慢一点，语气温和',
          doc: '风格指令。不收指令的模型忽略。'},
        {name: 'language', loc: 'json', kind: 'text', more: true, ext: true, placeholder: '按文字判断',
          doc: '文字的语言，如 zh、en。不写按文字判断。'},
        {name: 'reference_audio', loc: 'json', kind: 'file', more: true, ext: true, by: 'reference_audio',
          doc: '参考音频的 base64（可带 data: 前缀），按它克隆声音，最大 32 MB。给不收参考音频的模型返回 400 UNSUPPORTED_PARAMETER。'},
        {name: 'reference_text', loc: 'json', kind: 'text', more: true, ext: true, by: 'reference_text',
          doc: '参考音频里说的话，帮模型对齐。不收的模型忽略。'},
        {name: 'speed', loc: 'json', ignored: true},
        {name: 'stream_format', loc: 'json', ignored: true, note: '写 sse 也拿到一次性返回的音频'},
      ],
      errors: ['INVALID_REQUEST', 'UNSUPPORTED_PARAMETER', 'PAYLOAD_TOO_LARGE', 'MODEL_NOT_FOUND', 'TOO_MANY_REQUESTS', 'JOB_CANCELLED', 'INTERNAL']},

    {id: 'image.generations', group: 'image', method: 'POST', path: '/images/generations', title: '生成图片', resp: 'image',
      body: 'application/json',
      summary: '传入一句描述，在这台电脑上画一张图。本机出图一张要几十秒，请求会一直等到画完。',
      params: [
        {name: 'prompt', loc: 'json', kind: 'longtext', req: true, dflt: '清晨的海边小镇，水彩风格，柔和的光',
          doc: '要画的画面。有中文字时，Qwen-Image-2.1 建议把 steps 调到 40；Turbo 固定 8 步，不用调。'},
        {name: 'model', loc: 'json', kind: 'model', optionalModel: true,
          doc: '与 OpenAI 一样可以不写，不写用 设置 › 模型 › 本地模型 里的默认图像模型；写了就按本机 id 或映射名找，都不是返回 404 MODEL_NOT_FOUND。一只图像模型都没下载时返回 503 CAPABILITY_NOT_CONFIGURED。'},
        {name: 'size', loc: 'json', kind: 'enum', dflt: 'auto', values: ['auto', '1024x1024', '1344x768', '768x1344'], tryValues: ['auto', '1024x1024', '1344x768', '768x1344', '1000x1000'],
          doc: '宽x高，或 auto（模型的缺省尺寸，Qwen-Image 是 1024x576）。宽高都要是 32 的倍数、最长边不超过 1536、宽高比不超过 3，不合规时返回 400 INVALID_REQUEST，说明里给建议尺寸。'},
        {name: 'n', loc: 'json', kind: 'int', dflt: 1, more: true, doc: '一次几张。本机模型只能 1，大于 1 返回 400 INVALID_REQUEST。'},
        {name: 'response_format', loc: 'json', kind: 'enum', dflt: 'b64_json', values: ['b64_json'], more: true, reject: true,
          doc: '只有 b64_json。url 返回 400 UNSUPPORTED_PARAMETER。'},
        {name: 'output_format', loc: 'json', kind: 'enum', dflt: 'png', values: ['png'], more: true, reject: true,
          doc: '只有 png。jpeg / webp 返回 400 UNSUPPORTED_PARAMETER。'},
        {name: 'background', loc: 'json', kind: 'enum', dflt: 'auto', values: ['auto', 'opaque'], more: true, reject: true,
          doc: 'transparent 返回 400 UNSUPPORTED_PARAMETER：本机模型画不了透明底。'},
        {name: 'seed', loc: 'json', kind: 'int', more: true, ext: true, doc: '种子，0 到 4294967295。同一模型、同一描述、同一种子画出同一张。不写时抽一个，响应里带回。'},
        {name: 'steps', loc: 'json', kind: 'int', more: true, ext: true, placeholder: '按模型',
          doc: '采样步数，越多越细也越慢。不写用模型的默认值：Qwen-Image-2.1 是 20，可写 8–40；Turbo 是蒸馏版，固定 8 步。超出模型的范围返回 400 INVALID_REQUEST。'},
        {name: 'quality', loc: 'json', ignored: true},
        {name: 'style', loc: 'json', ignored: true},
        {name: 'moderation', loc: 'json', ignored: true},
        {name: 'output_compression', loc: 'json', ignored: true},
        {name: 'user', loc: 'json', ignored: true},
      ],
      errors: ['INVALID_REQUEST', 'UNSUPPORTED_PARAMETER', 'PAYLOAD_TOO_LARGE', 'MODEL_NOT_FOUND', 'TOO_MANY_REQUESTS', 'JOB_CANCELLED', 'INTERNAL']},
  ];
  ENDPOINTS.forEach((e) => {
    e.cap = capBy(e.group) ? e.group : null;
    e.errors = ['ORIGIN_NOT_ALLOWED', 'HOST_NOT_ALLOWED', 'SOURCE_NOT_ALLOWED', 'AUTHENTICATION_REQUIRED'].concat(e.cap ? ['CAPABILITY_NOT_CONFIGURED'] : [], e.errors);
  });
  const epBy = (id) => ENDPOINTS.find((e) => e.id === id) || null;
  const epsOf = (group) => ENDPOINTS.filter((e) => e.group === group);

  /** OpenAI 的 error.type 按 HTTP 状态取（同内核 errorType）。 */
  const errType = (status) => ({401: 'authentication_error', 403: 'permission_error', 404: 'not_found_error', 429: 'rate_limit_error', 503: 'service_unavailable_error'})[status]
    || (status >= 500 ? 'server_error' : 'invalid_request_error');
  /** 错误码 → [状态, OpenAI 的 error.type, 一句人话]（详情页「错误码」、试用区的失败说明共用）。
      码取自命令与协议规范 §11.3 的封闭列表，只列本机路由会遇到的；在线 Provider 的授权、预算与供应商错误不在这里。 */
  const ERRORS = Object.fromEntries([
    ['ORIGIN_NOT_ALLOWED', 403, '请求带了 Origin：来自网页'],
    ['HOST_NOT_ALLOWED', 403, 'Host 是域名（防 DNS 重绑定）：只认回环地址；允许局域网访问时也认 IP 地址'],
    ['SOURCE_NOT_ALLOWED', 403, '允许局域网访问时，请求来自私有网段之外（公网地址）；没允许时只接受本机'],
    ['AUTHENTICATION_REQUIRED', 401, '开了「需要 API key」，而请求没带 key、key 不对或已作废（带 WWW-Authenticate: Bearer）'],
    ['CAPABILITY_NOT_CONFIGURED', 503, '这一类此刻没有能用的模型：还没下载，或在 API 页被关掉了；说明里写着怎么开启'],
    ['INVALID_REQUEST', 400, '请求体不是合法的 JSON 或 multipart、缺字段、取值不对（含尺寸、步数、张数、描述过长）'],
    ['UNSUPPORTED_PARAMETER', 400, '认识但不支持的参数或取值：url 形式的图片、不支持的格式、模型不收的字段'],
    ['PAYLOAD_TOO_LARGE', 413, '上传超过 256 MB，或 JSON 请求体超过 8 MB'],
    ['MODEL_NOT_FOUND', 404, 'model 不认识、没下载，或是另一类的模型（映射名指向的类不对也算）'],
    ['TOO_MANY_REQUESTS', 429, '这个客户端同时在途的请求到了上限，稍后再试（Retry-After: 1）'],
    ['JOB_CANCELLED', 409, '任务在 BaoCut 里被取消了'],
    ['INTERNAL', 500, '其余的失败；本机模型跑失败时 code 是任务的错误码（如 MODEL_WORKER_FAILED、MODEL_OUT_OF_MEMORY）'],
  ].map(([code, status, text]) => [code, [status, errType(status), text]]));

  /* ---------- 地址 ---------- */
  const apiBase = (port) => `${HOST}:${port || WEB_PORT}/v1`;
  /** 允许局域网访问时，局域网里的设备用的地址：本机的一个局域网 IP 换掉 127.0.0.1，端口与路径不变。 */
  const lanBase = (addr, port) => `http://${addr}:${port || WEB_PORT}/v1`;
  /** 路径参数 {model} 有值就代进去。 */
  const epPath = (ep, values) => ep.path.replace('{model}', (values && values.model) ? encodeURIComponent(values.model) : '{model}');
  const epUrl = (base, ep, values) => base + epPath(ep, values);

  /* ---------- 模型现场 ---------- */
  function defaultOf(ready, dflt) {
    if (!ready || !ready.length) return null;
    return ready.find((m) => m.id === dflt) || ready[0];
  }
  /** 一次算好三类的全部模型、已下载的、默认那只、id 索引与生效的映射行。`installed(id)` 由调用方给。 */
  function ctxOf(models, installed, defaults, api) {
    const all = {}, ready = {}, dflt = {}, byId = {};
    CAPS.forEach((c) => {
      all[c.k] = (models || []).filter((m) => (m.cat || 'asr') === c.cat && !m.pack && m.supported !== false);
      ready[c.k] = all[c.k].filter((m) => installed(m.id));
      dflt[c.k] = defaultOf(ready[c.k], (defaults || {})[c.cat]);
      all[c.k].forEach((m) => { byId[m.id] = {m, cap: c.k}; });
    });
    const ctx = {all, ready, dflt, byId};
    const rows = mapRows(api);
    const issues = mapIssues(rows, ctx);
    ctx.map = rows.filter((r, i) => !issues[i]);
    return ctx;
  }
  const isReady = (ctx, cap, id) => ctx.ready[cap].some((m) => m.id === id);

  /* ---------- 模型映射 ---------- */
  /** 预置：常见 SDK 与工具默认写的名字，指向各类默认模型。用户没动过映射时就是这张表。 */
  const MAP_SEED = [
    {name: 'whisper-1', to: ['default:asr']},
    {name: 'gpt-4o-transcribe', to: ['default:asr']},
    {name: 'gpt-4o-mini-transcribe', to: ['default:asr']},
    {name: 'tts-1', to: ['default:tts']},
    {name: 'tts-1-hd', to: ['default:tts']},
    {name: 'gpt-4o-mini-tts', to: ['default:tts']},
    {name: 'gpt-image-1', to: ['default:image']},
    {name: 'gpt-image-2', to: ['default:image']},
  ];
  const mapRows = (api) => ((api && Array.isArray(api.modelMap)) ? api.modelMap : MAP_SEED).map((r) => ({name: r.name || '', to: (r.to || []).slice()}));
  /** 目标属于哪一类：`default:<能力>` 看前缀，本机 id 查目录；已从目录消失的 id 回 null。 */
  const capOfTarget = (t, ctx) => (t.indexOf('default:') === 0 ? (capBy(t.slice(8)) ? t.slice(8) : null) : ((ctx.byId[t] || {}).cap || null));
  /** 一个目标此刻落到哪只已下载模型；落不到回 null。 */
  function landOf(t, ctx) {
    const cap = capOfTarget(t, ctx);
    if (!cap) return null;
    if (t === 'default:' + cap) return ctx.dflt[cap];
    return isReady(ctx, cap, t) ? ctx.byId[t].m : null;
  }
  /** 每行的问题（没有就是 null）。有问题的行服务端不用，界面标红。 */
  function mapIssues(rows, ctx) {
    const seen = {};
    return rows.map((r) => {
      const n = String(r.name || '').trim();
      let issue = null;
      if (!n) issue = {field: 'name', text: '名字不能空。'};
      else if (/\s/.test(n)) issue = {field: 'name', text: '名字里不能有空格。'};
      else if (seen[n]) issue = {field: 'name', text: `和上面一行重名，这一行不生效。`};
      else if (ctx.byId[n]) issue = {field: 'name', text: `${n} 是本机模型的 id，本来就能直接用，不用映射。`};
      else if (!r.to.length) issue = {field: 'to', text: '还没有指向任何模型。'};
      if (n) seen[n] = true;
      return issue;
    });
  }
  /** 一行在每一类实际落到哪只：[{cap, capName, model|null, why}]，只列这一行指向了的类。 */
  function mapSummary(row, ctx) {
    return CAPS.filter((c) => row.to.some((t) => capOfTarget(t, ctx) === c.k)).map((c) => {
      const mine = row.to.filter((t) => capOfTarget(t, ctx) === c.k);
      const hit = mine.map((t) => landOf(t, ctx)).find(Boolean) || null;
      return {cap: c.k, capName: c.name, model: hit,
        why: hit ? '' : (ctx.ready[c.k].length ? '指向的模型都还没下载' : `还没有下载${c.name}模型`)};
    });
  }
  /** chip 上显示的一个目标。 */
  function targetInfo(t, ctx) {
    const cap = capOfTarget(t, ctx);
    if (!cap) return {id: t, cap: null, capName: '未知', label: t, sub: '这只模型已不在本地模型目录里', ready: false};
    const c = capBy(cap);
    if (t === 'default:' + cap) {
      const d = ctx.dflt[cap];
      return {id: t, cap, capName: c.name, label: '默认模型', ready: !!d,
        sub: d ? `跟着 设置 › 模型 › 本地模型 走 · 现在是 ${d.name}` : `还没有下载${c.name}模型`};
    }
    const m = ctx.byId[t].m;
    const ok = isReady(ctx, cap, t);
    return {id: t, cap, capName: c.name, label: m.name, ready: ok, sub: m.id + (ok ? '' : ' · 还没下载')};
  }
  /** 「添加模型」菜单里一类的条目：先是「默认模型」，再是这一类的全部模型（没下载的也列，标出来）。 */
  function targetsOf(cap, ctx) {
    return ['default:' + cap].concat(ctx.all[cap].map((m) => m.id)).map((t) => targetInfo(t, ctx));
  }

  /* ---------- 模型解析（设计稿 §3） ---------- */
  /** 请求里的 model → {model, via: 'exact'|'map'|'default', alias?} 或 {error, message, hint}。
      顺序同内核 resolveModel：这一类一只能用的都没有 → 503；映射名；local/<id>；本机 id。另一类的模型与映射名都是 404。
      message 是返回体里的英文，hint 是界面上的一句中文。 */
  function resolveModel(requested, cap, ctx, optional) {
    const w = String(requested == null ? '' : requested).trim();
    const c = capBy(cap);
    const notFound = (hint) => ({error: 'MODEL_NOT_FOUND', message: `No ${CAPABILITY[cap]} model named \`${w}\` is available.`, hint});
    if (!w && !optional) return {error: 'INVALID_REQUEST', message: 'Missing required field `model`.', hint: '没写 model。'};
    if (!ctx.ready[cap].length) {
      return {error: 'CAPABILITY_NOT_CONFIGURED', message: `No ${CAPABILITY[cap]} model is available. Download one in Settings › Models › Local models.`,
        hint: `还没有下载${c.name}模型，去 设置 › 模型 › 本地模型 下载。`};
    }
    if (!w) return {model: ctx.dflt[cap], via: 'default'};
    const row = ctx.map.find((r) => r.name === w);
    const id = !row && w.indexOf('local/') === 0 ? w.slice('local/'.length) : w;
    const hit = row ? null : ctx.byId[id];
    if (hit) {
      if (hit.cap !== cap) return notFound(`${id} 是${capBy(hit.cap).name}模型，这个端点用不了。`);
      if (!isReady(ctx, cap, id)) return notFound(`${hit.m.name} 还没有下载，去 设置 › 模型 › 本地模型 下载。`);
      return {model: hit.m, via: 'exact'};
    }
    if (row) {
      const mine = row.to.filter((t) => capOfTarget(t, ctx) === cap);
      const m = mine.map((t) => landOf(t, ctx)).find(Boolean);
      if (m) return {model: m, via: 'map', alias: w};
      return notFound(mine.length ? `${w} 指向的${c.name}模型都还没有下载。` : `${w} 在模型映射里，但没有指向${c.name}模型。`);
    }
    return notFound(`${w} 不是本机模型，也不在模型映射里。`);
  }

  /** 能力键 → 内核的能力名（`baocut.capability`）。 */
  const CAPABILITY = {asr: 'transcribe', tts: 'synthesizeSpeech', image: 'generateImage'};
  /** GET /models 的一项，形状同内核：`owned_by` 是 Provider，`baocut` 写能力、Provider、落到的模型与是不是映射名。 */
  const modelEntry = (id, cap, modelId, alias) => ({id, object: 'model', created: 0, owned_by: 'local',
    baocut: {capability: CAPABILITY[cap], providerId: 'local', modelId, alias}});
  /** GET /models 的 data，顺序同内核：能落到已下载模型的映射名在前（落到几类就列几项），然后是已下载的本机模型，
      id 写成 local/<id>。`onlyCap` = 某一类的独立端口。 */
  function listModels(ctx, onlyCap) {
    const caps = CAPS.filter((c) => !onlyCap || c.k === onlyCap).map((c) => c.k);
    const out = [];
    ctx.map.forEach((r) => caps.forEach((cap) => {
      const hit = resolveModel(r.name, cap, ctx);
      if (hit.model) out.push(modelEntry(r.name, cap, hit.model.id, true));
    }));
    caps.forEach((cap) => ctx.ready[cap].forEach((m) => out.push(modelEntry('local/' + m.id, cap, m.id, false))));
    return out;
  }

  /* ---------- 独立端口 ---------- */
  const suggestPort = (cap, webPort) => (webPort || WEB_PORT) + 1 + CAPS.findIndex((c) => c.k === cap);
  /** 端口输入 → {port} 或 {error}。不能与 Web 端口、保留端口、其他能力的端口相同。 */
  function parseCapPort(text, cap, webPort, ports) {
    const t = String(text == null ? '' : text).trim();
    const n = /^\d{1,5}$/.test(t) ? Number(t) : NaN;
    if (!(n >= 1024 && n <= 65535)) return {error: '端口要填 1024–65535 之间的数字'};
    if (n === (webPort || WEB_PORT)) return {error: `${n} 是 Web 服务自己的端口`};
    if (RESERVED[n]) return {error: `${n} 已经留给${RESERVED[n]}，换一个端口`};
    const clash = CAPS.find((c) => c.k !== cap && (ports || {})[c.k] === n);
    if (clash) return {error: `${n} 已经给了${clash.name}`};
    return {port: n};
  }

  /* ---------- 试用区 ---------- */
  /** 按先后顺序只报第一条挡住的原因，并给对应的按钮。null = 可以发（没下载模型不挡：那正好演示 503）。 */
  function blocker(ctx) {
    if (!ctx.apiOn) return {text: 'OpenAI 兼容 API 还没打开。', action: 'api', label: '打开 API'};
    if (ctx.cap && !ctx.capOn) return {text: `「${capBy(ctx.cap).name}」这一类在 API 页被关掉了。`, action: 'cap', label: '打开这一类'};
    if (!ctx.svcOn) return {text: 'Web 服务没有启动，请求发不出去。', action: 'start', label: '启动服务'};
    return null;
  }
  /** 试用区 model 的初值：先挑映射里能落到这一类的第一个名字（最像客户端会写的），再退到默认模型的 id。 */
  function suggestModel(cap, ctx) {
    if (!cap) {
      const first = listModels(ctx)[0];
      return first ? first.id : 'whisper-1';
    }
    const named = ctx.map.find((r) => resolveModel(r.name, cap, ctx).model);
    if (named) return named.name;
    return ctx.dflt[cap] ? ctx.dflt[cap].id : '';
  }
  /** 试用区 model 下拉的条目：本机模型（全部，没下载的标出来）与映射里指向这一类的名字。 */
  function modelChoices(cap, ctx) {
    const caps = cap ? [cap] : CAPS.map((c) => c.k);
    const local = [];
    caps.forEach((k) => ctx.all[k].forEach((m) => local.push({id: m.id, name: m.name,
      sub: isReady(ctx, k, m.id) ? (cap ? m.id : `${m.id} · ${capBy(k).name}`) : `${m.id} · 还没下载`, ready: isReady(ctx, k, m.id)})));
    const named = ctx.map.filter((r) => r.to.some((t) => caps.indexOf(capOfTarget(t, ctx)) >= 0)).map((r) => {
      const lands = caps.map((k) => resolveModel(r.name, k, ctx).model).filter(Boolean);
      return {id: r.name, name: r.name, sub: lands.length ? '→ ' + lands.map((m) => m.name).join('、') : '指向的模型都还没下载', ready: !!lands.length};
    });
    return {local, named};
  }

  function initialValues(ep, ctx) {
    const v = {};
    ep.params.forEach((p) => {
      if (p.ignored) return;
      if (p.kind === 'file' && p.req) v[p.name] = {name: 'interview-sample.m4a', size: '1.2 MB', dur: 42};
      else if (p.kind === 'multi') v[p.name] = [];
      else if (p.kind === 'model') v[p.name] = p.optionalModel ? '' : (ctx ? suggestModel(ep.cap, ctx) : '');
      else v[p.name] = p.dflt !== undefined ? p.dflt : '';
    });
    return v;
  }
  /** 分成「总在」与「更多参数」两组；接受但忽略的不进表单。 */
  function formGroups(ep) {
    const live = ep.params.filter((p) => !p.ignored);
    return {main: live.filter((p) => !p.more), more: live.filter((p) => p.more)};
  }
  /** 该写进请求的字段：必填的、以及和缺省不一样的；空串、空数组、缺省值都不写。路径参数不算。 */
  function sentFields(ep, values) {
    const out = [];
    ep.params.forEach((p) => {
      if (p.ignored || p.loc === 'path') return;
      const v = (values || {})[p.name];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) return;
      if (!p.req && p.dflt !== undefined && v === p.dflt) return;
      out.push([p, v]);
    });
    return out;
  }

  /* ---------- 代码片段：五条端点都能用官方 openai SDK 表达；扩展字段走 extra_body ---------- */
  const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const fileName = (v) => (v && v.name) || 'audio.m4a';
  const outName = (ep, values) => (ep.resp === 'audio' ? 'speech.' + ((values && values.response_format) || 'mp3') : '');
  const lit = (p, v) => (p.kind === 'int' ? String(Number(v)) : JSON.stringify(v));

  /** curl。`key` 为空 = 没开校验，不带 Authorization。 */
  function curl(ep, base, values, key) {
    const url = epUrl(base, ep, values);
    const auth = key ? ` \\\n  -H "Authorization: Bearer ${key}"` : '';
    if (ep.method === 'GET') return `curl ${url}${auth}`;
    const fields = sentFields(ep, values);
    let cmd = `curl ${url}${auth}`;
    if (ep.body === 'application/json') {
      const o = {};
      fields.forEach(([p, v]) => { o[p.name] = p.kind === 'file' ? `<${fileName(v)} 的 base64>` : p.kind === 'int' ? Number(v) : v; });
      cmd += ` \\\n  -H "Content-Type: application/json" \\\n  -d ${shq(JSON.stringify(o))}`;
    } else {
      fields.forEach(([p, v]) => {
        if (p.kind === 'file') cmd += ` \\\n  -F file=@${fileName(v)}`;
        else if (Array.isArray(v)) v.forEach((x) => { cmd += ` \\\n  -F "${p.name}=${x}"`; });
        else cmd += ` \\\n  -F ${p.name}=${/\s/.test(v) ? shq(v) : v}`;
      });
    }
    if (ep.resp === 'image') cmd += ` \\\n  | jq -r '.data[0].b64_json' | base64 --decode > image.png`;
    else if (outName(ep, values)) cmd += ` \\\n  -o ${outName(ep, values)}`;
    return cmd;
  }

  function python(ep, base, values, key) {
    const k = key ? `"${key}"` : '"not-needed"';
    const fields = sentFields(ep, values);
    const b64 = fields.some(([p]) => p.kind === 'file' && p.loc === 'json') || ep.resp === 'image';
    const head = `${b64 ? 'import base64\n' : ''}from openai import OpenAI\n\nclient = OpenAI(base_url="${base}", api_key=${k})\n\n`;
    if (ep.id === 'models.list') return head + 'for m in client.models.list():\n    print(m.id)';
    if (ep.id === 'models.retrieve') return head + `print(client.models.retrieve(${JSON.stringify(values.model || '')}))`;
    const val = (p, v) => (p.kind === 'file' ? `base64.b64encode(open("${fileName(v)}", "rb").read()).decode()` : lit(p, v));
    const std = fields.filter(([p]) => !p.ext && !(p.kind === 'file' && p.loc === 'form')).map(([p, v]) => `${p.name.replace('[]', '')}=${val(p, v)},`);
    const ext = fields.filter(([p]) => p.ext).map(([p, v]) => `"${p.name}": ${val(p, v)}`);
    const args = (lead) => lead.concat(std, ext.length ? [`extra_body={${ext.join(', ')}},`] : []);
    const block = (lines, pad) => lines.map((l) => pad + l).join('\n');
    if (ep.id === 'asr.transcriptions') {
      return head + `with open("${fileName(values.file)}", "rb") as f:\n    result = client.audio.transcriptions.create(\n${block(args(['file=f,']), '        ')}\n    )\nprint(result)`;
    }
    if (ep.id === 'tts.speech') {
      return head + `with client.audio.speech.with_streaming_response.create(\n${block(args([]), '    ')}\n) as r:\n    r.stream_to_file("${outName(ep, values)}")`;
    }
    return head + `result = client.images.generate(\n${block(args([]), '    ')}\n)\nopen("image.png", "wb").write(base64.b64decode(result.data[0].b64_json))`;
  }

  function javascript(ep, base, values, key) {
    const fields = sentFields(ep, values);
    const fsNeeded = ep.method === 'POST';
    const head = `${fsNeeded ? 'import fs from "node:fs";\n' : ''}import OpenAI from "openai";\n\nconst client = new OpenAI({ baseURL: "${base}", apiKey: "${key || 'not-needed'}" });\n\n`;
    if (ep.id === 'models.list') return head + 'const list = await client.models.list();\nfor (const m of list.data) console.log(m.id);';
    if (ep.id === 'models.retrieve') return head + `console.log(await client.models.retrieve(${JSON.stringify(values.model || '')}));`;
    const val = (p, v) => (p.kind === 'file' ? `fs.readFileSync("${fileName(v)}").toString("base64")` : lit(p, v));
    const props = fields.filter(([p]) => !(p.kind === 'file' && p.loc === 'form'))
      .map(([p, v]) => `\n  ${/[^\w]/.test(p.name) ? JSON.stringify(p.name.replace('[]', '')) : p.name}: ${val(p, v)},`).join('');
    if (ep.id === 'asr.transcriptions') {
      return head + `const result = await client.audio.transcriptions.create({\n  file: fs.createReadStream("${fileName(values.file)}"),${props}\n});\nconsole.log(result);`;
    }
    if (ep.id === 'tts.speech') {
      return head + `const res = await client.audio.speech.create({${props}\n});\nfs.writeFileSync("${outName(ep, values)}", Buffer.from(await res.arrayBuffer()));`;
    }
    return head + `const result = await client.images.generate({${props}\n});\nfs.writeFileSync("image.png", Buffer.from(result.data[0].b64_json, "base64"));`;
  }
  const SNIPPETS = [{k: 'curl', label: 'curl'}, {k: 'python', label: 'Python'}, {k: 'js', label: 'JavaScript'}];
  function snippet(lang, ep, base, values, key) {
    return lang === 'python' ? python(ep, base, values, key) : lang === 'js' ? javascript(ep, base, values, key) : curl(ep, base, values, key);
  }
  const maskKey = (key) => (key ? '••••••••' + key.slice(-4) : '');

  /* ---------- 演示响应 ----------
     原型不监听端口：按表单值与模型现场算一份「服务会回什么」。状态码、错误码、响应形状照设计稿 §4 / §5。 */
  const DEMO_SEGS = [
    [0.0, 3.2, '大家好，欢迎收听这一期节目。'],
    [3.2, 7.9, '今天我们聊聊怎么在自己的电脑上做字幕。'],
    [7.9, 12.4, '音频不用上传，模型就在本地跑。'],
  ];
  const tc = (s, sep) => {
    const ms = Math.round(s * 1000);
    const p = (n, w) => String(n).padStart(w, '0');
    return `${p(Math.floor(ms / 3600000), 2)}:${p(Math.floor(ms / 60000) % 60, 2)}:${p(Math.floor(ms / 1000) % 60, 2)}${sep}${p(ms % 1000, 3)}`;
  };
  /** JSON 响应的 `baocut`（同内核）：这次的任务与实际用的 Provider、模型；任务号也在响应头 X-BaoCut-Job-Id。 */
  const DEMO_JOB = 'job_01k7demo4p2x';
  const trace = (modelId) => ({jobId: DEMO_JOB, providerId: 'local', modelId});
  function transcriptBody(fmt, words, baocut) {
    const text = DEMO_SEGS.map((s) => s[2]).join('');
    if (fmt === 'text') return {type: 'text/plain', text};
    if (fmt === 'srt') return {type: 'text/plain', text: DEMO_SEGS.map((s, i) => `${i + 1}\n${tc(s[0], ',')} --> ${tc(s[1], ',')}\n${s[2]}\n`).join('\n')};
    if (fmt === 'vtt') return {type: 'text/vtt', text: 'WEBVTT\n\n' + DEMO_SEGS.map((s) => `${tc(s[0], '.')} --> ${tc(s[1], '.')}\n${s[2]}\n`).join('\n')};
    if (fmt === 'verbose_json') {
      const o = {task: 'transcribe', language: 'zh', duration: 12.4, text,
        segments: DEMO_SEGS.map((s, i) => ({id: i, start: s[0], end: s[1], text: s[2]}))};
      if (words) o.words = [{word: '大家', start: 0.0, end: 0.42}, {word: '好', start: 0.42, end: 0.61}, {word: '…', start: 0.61, end: 12.4}];
      return {type: 'application/json', json: {...o, baocut}};
    }
    return {type: 'application/json', json: {text, baocut}};
  }
  /** 错误体同内核：`param` 恒为 null（说明写在 message 里）。 */
  const errBody = (code, message) => ({type: 'application/json',
    json: {error: {message, type: ERRORS[code][1], param: null, code}}});
  const fail = (code, message, hint) => ({status: ERRORS[code][0], ms: 12, body: errBody(code, message), hint});

  /** ctx: ctxOf 的结果 + {seed, onlyCap}。返回 {status, ms, model?, alias?, body: {type, text?|json?|audio?|image?}, meta?, hint?}。 */
  function demoResponse(ep, values, ctx) {
    const v = values || {};
    if (ep.id === 'models.list') return {status: 200, ms: 18, body: {type: 'application/json', json: {object: 'list', data: listModels(ctx, ctx.onlyCap)}}};
    if (ep.id === 'models.retrieve') {
      // 同内核：先按列表里的 id 找，再按不是映射名的那些项的 modelId 找；返回的 id 是请求里写的。
      const w = String(v.model || '').trim();
      const listed = listModels(ctx, ctx.onlyCap);
      const hit = listed.find((m) => m.id === w) || listed.find((m) => !m.baocut.alias && m.baocut.modelId === w);
      if (!hit) {
        const known = ctx.byId[w];
        return fail('MODEL_NOT_FOUND', `The model \`${w}\` does not exist.`,
          known ? `${known.m.name} 还没有下载。` : `${w || '（空）'} 不是已下载的本机模型，也不是能落到已下载模型的映射名。`);
      }
      return {status: 200, ms: 9, body: {type: 'application/json', json: {...hit, id: w}}};
    }
    const mp = ep.params.find((p) => p.kind === 'model');
    const r = resolveModel(v.model, ep.cap, ctx, !!mp.optionalModel);
    if (r.error) return fail(r.error, r.message, r.hint);
    const model = r.model.id;
    const ok = (ms, body, meta) => ({status: 200, ms, model, alias: r.alias || null, body, meta});
    const missing = ep.params.find((p) => p.req && p.kind !== 'model' && (v[p.name] == null || String(p.kind === 'file' ? (v[p.name] || {}).name || '' : v[p.name]).trim() === ''));
    if (missing) return fail('INVALID_REQUEST', `Missing required field \`${missing.name}\`.`, `没写 ${missing.name}。`);
    const bad = ep.params.find((p) => p.reject && v[p.name] != null && v[p.name] !== '' && p.values.indexOf(v[p.name]) < 0);
    if (bad) return fail('UNSUPPORTED_PARAMETER', `\`${v[bad.name]}\` is not a supported ${bad.name}.`, `${bad.name} 不收 ${v[bad.name]}。`);

    if (ep.id === 'asr.transcriptions') {
      return ok(2400, transcriptBody(v.response_format || 'json', (v['timestamp_granularities[]'] || []).indexOf('word') >= 0, trace(model)));
    }
    if (ep.id === 'tts.speech') {
      const sup = ttsSupport(model);
      if (v.reference_audio && !sup.reference_audio) {
        return fail('UNSUPPORTED_PARAMETER', `${model} does not accept \`reference_audio\`.`, `${r.model.name} 不收参考音频，换一只能克隆的模型。`);
      }
      const dropped = ep.params.filter((p) => p.by && p.by !== 'reference_audio' && v[p.name] && !supports(p, model)).map((p) => p.name);
      const voice = sup.voice === 'preset'
        ? (v.voice && OPENAI_VOICES.indexOf(String(v.voice).toLowerCase()) < 0 ? v.voice : '默认音色')
        : (v.reference_audio ? '参考音频克隆' : '模型默认声音');
      const fmt = v.response_format || 'mp3';
      const chars = String(v.input).length;
      return ok(1200 + chars * 30, {type: fmt === 'mp3' ? 'audio/mpeg' : fmt === 'pcm' ? 'audio/pcm' : 'audio/' + fmt, audio: true},
        `${fmt.toUpperCase()} · ${voice}${dropped.length ? ` · 这只模型不看 ${dropped.join('、')}，已忽略` : ''}`);
    }
    if (ep.id === 'image.generations') {
      if (Number(v.n) > 1) return fail('INVALID_REQUEST', `Model ${model} generates at most 1 image at a time`, `${r.model.name} 一次只能画 1 张。`);
      const size = v.size && v.size !== 'auto' ? v.size : '1024x576';
      const [w, h] = size.split('x').map(Number);
      if (w % 32 || h % 32) {
        const fix = (n) => Math.round(n / 32) * 32;
        return fail('INVALID_REQUEST', `\`${size}\` is not a valid size for \`${model}\`: width and height must be multiples of 32, the longer edge at most 1536 and the aspect ratio at most 3:1. Try \`${fix(w)}x${fix(h)}\`, or \`auto\` (1024x576).`, `宽高要是 32 的倍数，建议 ${fix(w)}x${fix(h)}，或者用 auto（1024x576）。`);
      }
      const range = imageSteps(model);
      const steps = v.steps !== '' && v.steps != null ? Number(v.steps) : range.dflt;
      if (!Number.isInteger(steps) || steps < range.min || steps > range.max) {
        const span = range.min === range.max ? `only runs at ${range.min} steps` : `takes ${range.min}–${range.max} steps`;
        return fail('INVALID_REQUEST', `\`${v.steps}\` is not a valid steps for \`${model}\`: this model ${span}.`,
          range.min === range.max ? `${r.model.name} 固定 ${range.min} 步，不写或写 ${range.min}。` : `步数要在 ${range.min}–${range.max} 之间。`);
      }
      const seed = v.seed !== '' && v.seed != null ? Number(v.seed) : (ctx.seed || 20250927);
      return ok(steps * 2600, {type: 'application/json', image: {w, h, seed},
        json: {created: 1790000000, data: [{b64_json: 'iVBORw0KGgoAAAANSUhEUgAABUAAAAMA…（约 1.9 MB）'}], output_format: 'png', size: `${w}x${h}`,
          baocut: {...trace(model), seed, ...(v.steps !== '' && v.steps != null ? {steps} : {})}}},
        `${w} × ${h} · PNG · 种子 ${seed} · ${steps} 步`);
    }
    return ok(10, {type: 'application/json', json: {}});
  }
  const fmtMs = (ms) => (ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(1) + ' s');

  const BC_OPENAI_API = {
    CAPS, capBy, ENDPOINTS, epBy, epsOf, ERRORS, OPENAI_VOICES, ttsSupport, supports, IMAGE_STEPS, imageSteps,
    apiBase, lanBase, epPath, epUrl, defaultOf, ctxOf, resolveModel, listModels,
    MAP_SEED, mapRows, mapIssues, mapSummary, targetInfo, targetsOf, capOfTarget,
    suggestPort, parseCapPort, blocker, suggestModel, modelChoices,
    initialValues, formGroups, sentFields, SNIPPETS, snippet, curl, maskKey, demoResponse, fmtMs,
    resolveEp: epBy,
  };
  if (typeof window !== 'undefined') Object.assign(window, {BC_OPENAI_API});
  if (typeof module !== 'undefined' && module.exports) module.exports = BC_OPENAI_API;
})();
