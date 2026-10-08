/* Web 服务 › OpenAI 兼容 API 的纯模型 —— §17.6（2026-09-27 第二版，设计稿 docs/design/cli/bcut-serve-openai-api-design.md）。
   路径与 OpenAI 一字不差：Base URL 是 `http://127.0.0.1:<端口>/v1`，只有主机和端口不同。
   `model` 与 OpenAI 一样必填（出图可不写，用默认）；本机模型的 id 直接能用，别的名字要在「模型映射」里登记，
   都不是就 404 model_not_found（设计稿 §3）。映射是多对多：一个名字可以指向几只模型（每一类按顺序取第一只已下载的），
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
    [/^gpt-sovits/, {reference_audio: true, reference_text: true}],
    [/^voxcpm/, {reference_audio: true, reference_text: true, instructions: true}],
    [/^omnivoice/, {reference_audio: true, reference_text: true, instructions: true}],
  ];
  const ttsSupport = (id) => { const hit = TTS_SUPPORT.find(([re]) => re.test(id || '')); return hit ? hit[1] : {}; };
  /** 这个参数这只模型收不收：参数没标 `by` 时回 true。 */
  const supports = (p, modelId) => !p.by || !!ttsSupport(modelId)[p.by];
  /** OpenAI 自家音色名：本机模型没有这些说话人，收到按默认音色念（内核 OPENAI_VOICES）。 */
  const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'fable', 'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

  /* ---------- 端点表 ----------
     group: 'models' 或能力键；path 与 OpenAI 相同（相对 /v1）。
     param: {name, loc: 'path'|'form'|'json', kind: 'file'|'model'|'voice'|'text'|'longtext'|'enum'|'multi'|'int',
             req, dflt, values, doc, ext（OpenAI 没有、BaoCut 加的字段）, more（折进「更多参数」）, by（只有部分模型收，键见 TTS_SUPPORT）,
             ignored（接受但忽略）, reject（只认 values 里的值，其余 400）}
     resp: 'models' | 'model' | 'text'（随 response_format）| 'audio' | 'image' */
  const MODEL_DOC = '本机模型的 id，或「模型映射」里登记的名字；都不是返回 404 model_not_found。';
  const ENDPOINTS = [
    {id: 'models.list', group: 'models', method: 'GET', path: '/models', title: '列出模型', resp: 'models',
      summary: '这台电脑上已下载、能用的模型，加上映射里能落到已下载模型的名字。在某一类的独立端口上只列那一类。', params: [],
      errors: []},
    {id: 'models.retrieve', group: 'models', method: 'GET', path: '/models/{model}', title: '查一只模型', resp: 'model',
      summary: '按 id 或映射名查一只模型：本机模型返回它自己，映射名返回它在每一类实际落到哪只。', params: [
        {name: 'model', loc: 'path', kind: 'model', req: true, doc: MODEL_DOC},
      ],
      errors: ['model_not_found']},

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
      errors: ['invalid_request', 'file_too_large', 'model_not_found', 'model_wrong_capability', 'queue_full', 'transcription_failed']},

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
          doc: 'wav 是模型原生采样率；pcm 是 24 kHz 16 位单声道裸流；mp3 / opus / aac / flac 要这台电脑上有 ffmpeg，没有时返回 400 audio_encoding_failed。'},
        {name: 'instructions', loc: 'json', kind: 'text', more: true, by: 'instructions', placeholder: '比如：放慢一点，语气温和',
          doc: '风格指令。不收指令的模型忽略。'},
        {name: 'language', loc: 'json', kind: 'text', more: true, ext: true, placeholder: '按文字判断',
          doc: '文字的语言，如 zh、en。不写按文字判断。'},
        {name: 'reference_audio', loc: 'json', kind: 'file', more: true, ext: true, by: 'reference_audio',
          doc: '参考音频的 base64（可带 data: 前缀），按它克隆声音，最大 32 MB。给不收参考音频的模型返回 400 unsupported_param。'},
        {name: 'reference_text', loc: 'json', kind: 'text', more: true, ext: true, by: 'reference_text',
          doc: '参考音频里说的话，帮模型对齐。不收的模型忽略。'},
        {name: 'speed', loc: 'json', ignored: true},
        {name: 'stream_format', loc: 'json', ignored: true, note: '写 sse 也拿到一次性返回的音频'},
      ],
      errors: ['invalid_request', 'unsupported_param', 'model_not_found', 'model_wrong_capability', 'queue_full', 'speech_failed', 'audio_encoding_failed']},

    {id: 'image.generations', group: 'image', method: 'POST', path: '/images/generations', title: '生成图片', resp: 'image',
      body: 'application/json',
      summary: '传入一句描述，在这台电脑上画一张图。本机出图一张要几十秒，请求会一直等到画完。',
      params: [
        {name: 'prompt', loc: 'json', kind: 'longtext', req: true, dflt: '清晨的海边小镇，水彩风格，柔和的光',
          doc: '要画的画面。有中文字时建议把 steps 调到 40。'},
        {name: 'model', loc: 'json', kind: 'model', optionalModel: true,
          doc: '与 OpenAI 一样可以不写，不写用 设置 › 模型 › 本地模型 里的默认图像模型；写了就按本机 id 或映射名找，都不是返回 404。'},
        {name: 'size', loc: 'json', kind: 'enum', dflt: 'auto', values: ['auto', '1024x1024', '1344x768', '768x1344'], tryValues: ['auto', '1024x1024', '1344x768', '768x1344', '1000x1000'],
          doc: '宽x高，或 auto（模型的缺省尺寸，Qwen-Image 是 1024x576）。宽高都要是 32 的倍数、最长边不超过 1536、宽高比不超过 3，不合规时返回 400 invalid_size 并给建议尺寸。'},
        {name: 'n', loc: 'json', kind: 'int', dflt: 1, more: true, doc: '一次几张。本机模型只能 1，大于 1 返回 400 unsupported_param。'},
        {name: 'response_format', loc: 'json', kind: 'enum', dflt: 'b64_json', values: ['b64_json'], more: true, reject: true,
          doc: '只有 b64_json。url 返回 400 unsupported_param。'},
        {name: 'output_format', loc: 'json', kind: 'enum', dflt: 'png', values: ['png'], more: true, reject: true,
          doc: '只有 png。jpeg / webp 返回 400 unsupported_param。'},
        {name: 'background', loc: 'json', kind: 'enum', dflt: 'auto', values: ['auto', 'opaque'], more: true, reject: true,
          doc: 'transparent 返回 400 unsupported_param：本机模型画不了透明底。'},
        {name: 'seed', loc: 'json', kind: 'int', more: true, ext: true, doc: '种子。同一模型、同一描述、同一种子画出同一张。'},
        {name: 'steps', loc: 'json', kind: 'int', dflt: 20, more: true, ext: true, doc: '采样步数，越多越细也越慢。'},
        {name: 'quality', loc: 'json', ignored: true},
        {name: 'style', loc: 'json', ignored: true},
        {name: 'moderation', loc: 'json', ignored: true},
        {name: 'output_compression', loc: 'json', ignored: true},
        {name: 'user', loc: 'json', ignored: true},
      ],
      errors: ['invalid_request', 'prompt_too_long', 'invalid_size', 'unsupported_param', 'model_not_found', 'model_wrong_capability', 'queue_full', 'image_failed']},
  ];
  ENDPOINTS.forEach((e) => {
    e.cap = capBy(e.group) ? e.group : null;
    e.errors = ['local_requests_only', 'invalid_api_key'].concat(e.cap ? ['capability_disabled'] : [], e.errors);
  });
  const epBy = (id) => ENDPOINTS.find((e) => e.id === id) || null;
  const epsOf = (group) => ENDPOINTS.filter((e) => e.group === group);

  /** 错误码 → [状态, OpenAI 的 error.type, 一句人话]（详情页「错误码」、试用区的失败说明共用）。 */
  const ERRORS = {
    local_requests_only: [403, 'permission_error', '请求不是从这台电脑发出的，或来自网页'],
    invalid_api_key: [401, 'authentication_error', '开了「需要 API key」，而请求没带 key 或 key 不对'],
    capability_disabled: [404, 'invalid_request_error', '这一类能力在 API 页被关掉了'],
    invalid_request: [400, 'invalid_request_error', '缺必填字段，或字段值不合法'],
    model_not_found: [404, 'invalid_request_error', 'model 不是已下载的本机模型，也不是映射里能落到已下载模型的名字'],
    model_wrong_capability: [400, 'invalid_request_error', 'model 是另一类的模型，这个端点用不了'],
    unsupported_param: [400, 'invalid_request_error', '这只模型不支持这个参数或取值'],
    file_too_large: [413, 'invalid_request_error', '上传超过 512 MB'],
    prompt_too_long: [400, 'invalid_request_error', '描述超过这只模型的上限'],
    invalid_size: [400, 'invalid_request_error', '尺寸不合这只模型的规则，错误信息里有建议尺寸'],
    queue_full: [503, 'server_error', '排队的请求太多，稍后再试（带 Retry-After）'],
    transcription_failed: [500, 'server_error', '模型识别失败'],
    speech_failed: [500, 'server_error', '模型合成失败'],
    audio_encoding_failed: [400, 'invalid_request_error', '合成成功，但转不成要的格式（多半是缺 ffmpeg，改用 wav / pcm）'],
    image_failed: [500, 'server_error', '模型出图失败'],
  };

  /* ---------- 地址 ---------- */
  const apiBase = (port) => `${HOST}:${port || WEB_PORT}/v1`;
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
      message 是返回体里的英文（与内核同），hint 是界面上的一句中文。 */
  function resolveModel(requested, cap, ctx, optional) {
    const w = String(requested == null ? '' : requested).trim();
    const c = capBy(cap);
    const notFound = (hint) => ({error: 'model_not_found', message: `The model \`${w}\` does not exist or is not mapped to a downloaded model.`, hint});
    if (!w) {
      if (!optional) return {error: 'invalid_request', param: 'model', message: 'Missing required field `model`.', hint: '没写 model。'};
      const d = ctx.dflt[cap];
      return d ? {model: d, via: 'default'} : {error: 'model_not_found', message: `No ${cap} model is downloaded.`, hint: `还没有下载${c.name}模型。`};
    }
    const hit = ctx.byId[w];
    if (hit) {
      if (hit.cap !== cap) return {error: 'model_wrong_capability', param: 'model', message: `The model \`${w}\` is a ${hit.cap} model and cannot serve this endpoint.`, hint: `${w} 是${capBy(hit.cap).name}模型。`};
      if (!isReady(ctx, cap, w)) return notFound(`${hit.m.name} 还没有下载，去 设置 › 模型 › 本地模型 下载。`);
      return {model: hit.m, via: 'exact'};
    }
    const row = ctx.map.find((r) => r.name === w);
    if (row) {
      const mine = row.to.filter((t) => capOfTarget(t, ctx) === cap);
      const m = mine.map((t) => landOf(t, ctx)).find(Boolean);
      if (m) return {model: m, via: 'map', alias: w};
      return notFound(mine.length ? `${w} 指向的${c.name}模型都还没有下载。` : `${w} 在模型映射里，但没有指向${c.name}模型。`);
    }
    return notFound(`${w} 不是本机模型，也不在模型映射里。`);
  }

  /** GET /models 的 data：已下载的本机模型 + 能落到已下载模型的映射名。`onlyCap` = 某一类的独立端口。 */
  function listModels(ctx, onlyCap) {
    const caps = CAPS.filter((c) => !onlyCap || c.k === onlyCap).map((c) => c.k);
    const out = [];
    caps.forEach((cap) => ctx.ready[cap].forEach((m) => out.push({id: m.id, object: 'model', created: 0, owned_by: 'baocut',
      x_baocut: {task: cap, name: m.name, default: !!ctx.dflt[cap] && ctx.dflt[cap].id === m.id}})));
    ctx.map.forEach((r) => {
      const lands = {};
      caps.forEach((cap) => { const hit = resolveModel(r.name, cap, ctx); if (hit.model) lands[cap] = hit.model.id; });
      if (Object.keys(lands).length) out.push({id: r.name, object: 'model', created: 0, owned_by: 'baocut', x_baocut: {mapsTo: lands}});
    });
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
  /** 按先后顺序只报第一条挡住的原因，并给对应的按钮。null = 可以发（没下载模型不挡：那正好演示 404）。 */
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
  function transcriptBody(fmt, words) {
    const text = DEMO_SEGS.map((s) => s[2]).join('');
    if (fmt === 'text') return {type: 'text/plain', text};
    if (fmt === 'srt') return {type: 'text/plain', text: DEMO_SEGS.map((s, i) => `${i + 1}\n${tc(s[0], ',')} --> ${tc(s[1], ',')}\n${s[2]}\n`).join('\n')};
    if (fmt === 'vtt') return {type: 'text/vtt', text: 'WEBVTT\n\n' + DEMO_SEGS.map((s) => `${tc(s[0], '.')} --> ${tc(s[1], '.')}\n${s[2]}\n`).join('\n')};
    if (fmt === 'verbose_json') {
      const o = {task: 'transcribe', language: 'zh', duration: 12.4, text,
        segments: DEMO_SEGS.map((s, i) => ({id: i, start: s[0], end: s[1], text: s[2]}))};
      if (words) o.words = [{word: '大家', start: 0.0, end: 0.42}, {word: '好', start: 0.42, end: 0.61}, {word: '…', start: 0.61, end: 12.4}];
      return {type: 'application/json', json: o};
    }
    return {type: 'application/json', json: {text}};
  }
  const errBody = (code, message, param) => ({type: 'application/json',
    json: {error: {message, type: ERRORS[code][1], param: param || null, code}}});
  const fail = (code, message, param, hint) => ({status: ERRORS[code][0], ms: 12, body: errBody(code, message, param), hint});

  /** ctx: ctxOf 的结果 + {seed, onlyCap}。返回 {status, ms, model?, alias?, body: {type, text?|json?|audio?|image?}, meta?, hint?}。 */
  function demoResponse(ep, values, ctx) {
    const v = values || {};
    if (ep.id === 'models.list') return {status: 200, ms: 18, body: {type: 'application/json', json: {object: 'list', data: listModels(ctx, ctx.onlyCap)}}};
    if (ep.id === 'models.retrieve') {
      const hit = listModels(ctx, ctx.onlyCap).find((m) => m.id === String(v.model || '').trim());
      if (!hit) {
        const known = ctx.byId[String(v.model || '').trim()];
        return fail('model_not_found', `The model \`${v.model || ''}\` does not exist.`, 'model',
          known ? `${known.m.name} 还没有下载。` : `${v.model || '（空）'} 不是已下载的本机模型，也不是能落到已下载模型的映射名。`);
      }
      return {status: 200, ms: 9, body: {type: 'application/json', json: hit}};
    }
    const mp = ep.params.find((p) => p.kind === 'model');
    const r = resolveModel(v.model, ep.cap, ctx, !!mp.optionalModel);
    if (r.error) return fail(r.error, r.message, r.param || (r.error === 'invalid_request' ? 'model' : null), r.hint);
    const model = r.model.id;
    const ok = (ms, body, meta) => ({status: 200, ms, model, alias: r.alias || null, body, meta});
    const missing = ep.params.find((p) => p.req && p.kind !== 'model' && (v[p.name] == null || String(p.kind === 'file' ? (v[p.name] || {}).name || '' : v[p.name]).trim() === ''));
    if (missing) return fail('invalid_request', `Missing required field \`${missing.name}\`.`, missing.name, `没写 ${missing.name}。`);
    const bad = ep.params.find((p) => p.reject && v[p.name] != null && v[p.name] !== '' && p.values.indexOf(v[p.name]) < 0);
    if (bad) return fail(ep.cap === 'image' ? 'unsupported_param' : 'invalid_request', `\`${v[bad.name]}\` is not a supported ${bad.name}.`, bad.name, `${bad.name} 不收 ${v[bad.name]}。`);

    if (ep.id === 'asr.transcriptions') {
      return ok(2400, transcriptBody(v.response_format || 'json', (v['timestamp_granularities[]'] || []).indexOf('word') >= 0));
    }
    if (ep.id === 'tts.speech') {
      const sup = ttsSupport(model);
      if (v.reference_audio && !sup.reference_audio) {
        return fail('unsupported_param', `${model} does not accept \`reference_audio\`.`, 'reference_audio', `${r.model.name} 不收参考音频，换一只能克隆的模型。`);
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
      if (Number(v.n) > 1) return fail('unsupported_param', `${model} can only generate 1 image per request.`, 'n', `${r.model.name} 一次只能画 1 张。`);
      const size = v.size && v.size !== 'auto' ? v.size : '1024x576';
      const [w, h] = size.split('x').map(Number);
      if (w % 32 || h % 32) {
        const fix = (n) => Math.round(n / 32) * 32;
        return fail('invalid_size', `\`${size}\` is not a valid size for \`${model}\`: width and height must be multiples of 32, the longer edge at most 1536 and the aspect ratio at most 3:1. Try \`${fix(w)}x${fix(h)}\`, or \`auto\` (1024x576).`, 'size', `宽高要是 32 的倍数，建议 ${fix(w)}x${fix(h)}，或者用 auto（1024x576）。`);
      }
      const steps = Number(v.steps) || 20;
      const seed = v.seed !== '' && v.seed != null ? Number(v.seed) : (ctx.seed || 20250927);
      return ok(steps * 2600, {type: 'application/json', image: {w, h, seed},
        json: {created: 1790000000, data: [{b64_json: 'iVBORw0KGgoAAAANSUhEUgAABUAAAAMA…（约 1.9 MB）'}], output_format: 'png', size: `${w}x${h}`,
          x_baocut: {model, seed, steps, elapsedMs: steps * 2600, license: 'non-commercial'}}},
        `${w} × ${h} · PNG · 种子 ${seed} · ${steps} 步`);
    }
    return ok(10, {type: 'application/json', json: {}});
  }
  const fmtMs = (ms) => (ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(1) + ' s');

  const BC_OPENAI_API = {
    CAPS, capBy, ENDPOINTS, epBy, epsOf, ERRORS, OPENAI_VOICES, ttsSupport, supports,
    apiBase, epPath, epUrl, defaultOf, ctxOf, resolveModel, listModels,
    MAP_SEED, mapRows, mapIssues, mapSummary, targetInfo, targetsOf, capOfTarget,
    suggestPort, parseCapPort, blocker, suggestModel, modelChoices,
    initialValues, formGroups, sentFields, SNIPPETS, snippet, curl, maskKey, demoResponse, fmtMs,
    resolveEp: epBy,
  };
  if (typeof window !== 'undefined') Object.assign(window, {BC_OPENAI_API});
  if (typeof module !== 'undefined' && module.exports) module.exports = BC_OPENAI_API;
})();
