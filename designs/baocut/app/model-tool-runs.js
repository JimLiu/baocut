/* 工具运行（product-design §2.7「进度与失败」「结果页的下一步」「授权在当场完成」，architecture §7.9 工具与流程的对应）——
   window.BC_TOOL_RUNS。纯函数，无 React、无 DOM；只在 App 入口加载。

   一次运行是任务中心里的一条任务，按步骤显示进度：
   - 步骤表（`plan`）照 architecture §7.9 的首批流程：转录 = 解析目标 → 转写 →（开了「识别说话人」、
     而且模型不自带区分时）识别说话人 → 结果落点。落点按输入与 `target` 分三种（§2.7 表二「转录」）：
     文件、Space 里的媒体与链接缺省不建视频，最后一步「保存文稿和字幕」产出文档与字幕两个 Space 条目；
     改选「新建视频」（target = 'create'）时先新建视频，最后应用文稿、建立字幕层；可编辑的视频没有文稿时写进它（打开视频 → … → 建立字幕层）；
     已有文稿时按落点（product-design §5.11）：'new-video' 在同项目新建一部视频（新建视频 → … → 建立字幕层），
     'replace' 走换用文稿（打开视频 → 转写 → 换用文稿 → 结转译文与字幕）。
     翻译字幕 = 打开视频 → 逐批翻译 → 核对译文 → 应用译文 → 建立字幕层（字幕文件 / Space 字幕：翻译 → 核对 → 保存字幕文件）；
     翻译配音 = 打开视频 →（缺译文时）逐批翻译 → 核对译文 → 逐句合成 → 时间对齐 → 应用配音；
     下载视频 = 解析链接 → 下载媒体 → 校验可解码 → 放进 Space →（勾了下载后转录时）转写 → 保存文稿和字幕。
   - 推进（`advance`）、停在某一步（`fail`）、从那一步重试（`retry`）：已完成的步骤保留，重试只从失败的那一步开始。
   - 产物与保存位置（`withOutputs`、`taskPatch`、`outputsPatch`）：任务记录带 `outputs`（产物条目 id 列表）与 `saveDir`，
     任务详情读它们列出同样的产物与结果操作（§2.7「进度与失败」）。
   - 结果页每个产物能接着做什么（`followUps`，§2.7「结果与下一步」）。
   - 当场授权（`grantNeeds`）：所选模型是在线服务时要发什么、发给谁、预计多少钱；已同意过的同一收件方与数据种类不再问。

   任务记录上与工具运行有关的字段（tool-runs.jsx、tool-tts / tool-llm / image-gen / tool-video 的直接任务都写这一份）：
     {kind, tool, toolId, runId?, title, sub, project, pct, steps?, attempt?, status, outcome, phase, error, errorCode?,
      params: object       —— 这次运行的参数（工具页的表单），「再做一次 / 重试」经 openToolWith(toolId, {rerun: true, params}) 填回表单
      outputs: string[]   —— 这次运行产出的 Space 条目 id（BC_HOME_TOOLS.output 的 `tool-<种类>-<id>`；写进视频的是视频 id），没有产物时是 []
      saveDir: string|null —— 结果保存到的目录（BC_SAVE_DIR.current）；写进已有视频的运行是 null} */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /* 步骤 id 是写入时机的钩子（视图在某一步完成时做那一步的写入），label 是界面上的字 */
  const STEP = {
    probe: '解析链接', download: '下载媒体', verify: '校验可解码', import: '导入视频', store: '放进 Space',
    create: '新建视频', open: '打开视频', asr: '转写', diarize: '识别说话人', applyTx: '应用文稿', layer: '建立字幕层',
    switchTx: '换用文稿', carry: '结转译文与字幕',
    translate: '逐批翻译', check: '核对译文', applyTr: '应用译文', save: '保存字幕文件', publish: '保存文稿和字幕',
    synth: '逐句合成', align: '时间对齐', applyDub: '应用配音',
  };

  /**
   * 这次运行的步骤。
   * @param {string} tool transcribe / translate / dub / link
   * @param {{input: 'file'|'link'|'video', translate?: boolean, target?: 'none'|'create'|'new-video'|'replace'|'first', transcribe?: boolean, diarize?: boolean}} o
   *   `input`：Space 里的条目按 BC_TOOL_SPACE_INPUT.runInput 折成 'video'（可编辑的视频）或 'file'（媒体、字幕）；
   *   transcribe 的 `target` = 文件与链接的结果落在哪：缺省 'none' 只生成文稿和字幕，'create' 新建视频；
   *   可编辑的视频：'first'（缺省，没有文稿，直接写进）、'new-video'（已有文稿，同项目新建视频）、'replace'（换用文稿）；
   *   dub 的 `translate` = 没有现成译文，要先翻译；link 的 `transcribe` = 下载后转录；
   *   transcribe 的 `diarize` = 转写之后单独跑一步「说话人区分」（模型自带区分时不单列，见 `speakerSwitch`）。
   *   从链接导入的「下载后转录」用默认语音模型、没有这只开关（§2.7），步骤表不变。
   */
  /* 从链接拿到媒体并落到目标：转录的链接输入与从链接导入共用这一段 */
  const LINK_TARGET = {create: 'create', video: 'import', none: 'store'};
  const linkSteps = (target) => ['probe', 'download', 'verify', LINK_TARGET[target] || 'create'];
  function plan(tool, o) {
    const input = (o && o.input) || 'video';
    let ids = [];
    if (tool === 'transcribe') {
      const asr = o && o.diarize ? ['asr', 'diarize'] : ['asr'];
      const create = input !== 'video' && o && o.target === 'create';
      const tgt = o && o.target;
      if (input === 'video' && tgt === 'new-video') ids = ['create'].concat(asr, ['applyTx', 'layer']);
      else if (input === 'video' && tgt === 'replace') ids = ['open'].concat(asr, ['switchTx', 'carry']);
      else if (input === 'video') ids = ['open'].concat(asr, ['applyTx', 'layer']);
      else if (create) ids = (input === 'link' ? linkSteps('create') : ['create']).concat(asr, ['applyTx', 'layer']);
      else ids = (input === 'link' ? linkSteps('none') : []).concat(asr, ['publish']);
    }
    else if (tool === 'link') {
      ids = linkSteps('none').concat(o && o.transcribe ? ['asr', 'publish'] : []);
    }
    else if (tool === 'translate') ids = input === 'file' ? ['translate', 'check', 'save'] : ['open', 'translate', 'check', 'applyTr', 'layer'];
    else if (tool === 'dub') ids = ['open'].concat(o && o.translate ? ['translate', 'check'] : ['check'], ['synth', 'align', 'applyDub']);
    return ids.map((id) => ({id, label: STEP[id]}));
  }

  /** 新的一次运行：第一步在跑，其余等着。`o.saveDir`：结果保存到的目录（写进已有视频的运行不给） */
  function create(tool, o) {
    const steps = plan(tool, o).map((s, i) => Object.assign({}, s, {status: i === 0 ? 'running' : 'pending', pct: 0}));
    return {tool, input: (o && o.input) || (tool === 'link' ? 'link' : 'video'), steps, cur: 0, status: steps.length ? 'running' : 'done', error: null, attempt: 1,
      saveDir: (o && o.saveDir) || null, outputs: []};
  }
  /** 记下产物条目（按 id 去重，保持先后）；返回新的运行 */
  function withOutputs(run, ids) {
    const out = (run.outputs || []).slice();
    (ids || []).filter(Boolean).forEach((id) => { if (out.indexOf(id) < 0) out.push(id); });
    return Object.assign({}, run, {outputs: out});
  }
  /** 直接任务（生成语音、生成图片、文本生成、压缩 / 合并 / 提取音频）写进任务记录的产物字段：`{outputs, saveDir}` */
  function outputsPatch(entries, saveDir) {
    return {outputs: (entries || []).filter(Boolean).map((e) => (typeof e === 'string' ? e : e.id)).filter(Boolean), saveDir: saveDir || null};
  }

  const clamp = (v) => Math.max(0, Math.min(100, v));

  /**
   * 推进当前这一步 `d` 个百分点。满了就记完成、下一步开始；最后一步完成整次运行就完成。
   * 返回 `{run, finished}`：`finished` 是这一下刚完成的步骤 id（视图据此做写入），没有就是 null。
   */
  function advance(run, d) {
    if (!run || run.status !== 'running') return {run, finished: null};
    const steps = run.steps.map((s) => Object.assign({}, s));
    const s = steps[run.cur];
    s.pct = clamp(s.pct + d);
    if (s.pct < 100) return {run: Object.assign({}, run, {steps}), finished: null};
    s.status = 'done';
    const cur = run.cur + 1;
    if (cur < steps.length) steps[cur].status = 'running';
    return {run: Object.assign({}, run, {steps, cur: Math.min(cur, steps.length - 1), status: cur < steps.length ? 'running' : 'done'}), finished: s.id};
  }

  /** 停在当前这一步：这一步记失败，之前完成的保留 */
  function fail(run, error) {
    if (!run || run.status !== 'running') return run;
    const steps = run.steps.map((s, i) => (i === run.cur ? Object.assign({}, s, {status: 'failed'}) : s));
    return Object.assign({}, run, {steps, status: 'failed', error: error || `${steps[run.cur].label}没有完成`});
  }

  /** 从失败的那一步重试：那一步从头再跑，之前完成的步骤不重做（§2.7，architecture §7.9 重试语义） */
  function retry(run) {
    if (!run || run.status !== 'failed') return run;
    const steps = run.steps.map((s, i) => (i === run.cur ? Object.assign({}, s, {status: 'running', pct: 0}) : s));
    return Object.assign({}, run, {steps, status: 'running', error: null, attempt: run.attempt + 1});
  }

  /** 整次运行的进度（0–100）：完成的步骤 + 当前这一步的比例 */
  function pct(run) {
    if (!run || !run.steps.length) return 0;
    if (run.status === 'done') return 100;
    const done = run.steps.filter((s) => s.status === 'done').length;
    return Math.round(((done + run.steps[run.cur].pct / 100) / run.steps.length) * 100);
  }

  /** 状态短语：正在转写 · 第 2 / 4 步；失败时说停在哪一步 */
  function phase(run) {
    if (!run) return '';
    const s = run.steps[run.cur];
    const at = `第 ${run.cur + 1} / ${run.steps.length} 步`;
    if (run.status === 'done') return '已完成';
    if (run.status === 'failed') return `停在「${s.label}」· ${at}`;
    return `正在${s.label} · ${at}`;
  }

  /** 写到任务记录上的那几个字段（任务中心与工具页读同一条记录） */
  function taskPatch(run) {
    const base = Object.assign({pct: pct(run), steps: run.steps.map((s) => ({id: s.id, label: s.label, status: s.status, pct: s.pct})), attempt: run.attempt},
      outputsPatch(run.outputs, run.saveDir));
    if (run.status === 'done') return Object.assign(base, {status: 'done', outcome: 'done', phase: null, error: null});
    if (run.status === 'failed') return Object.assign(base, {status: 'error', outcome: 'error', phase: null, error: run.error});
    return Object.assign(base, {status: 'running', outcome: null, phase: phase(run), error: null});
  }

  /* ---------- 结果页的下一步（§2.7「结果与下一步」） ---------- */
  const NEXT_LABEL = {'open-movie': '打开编辑', transcribe: '转录', translate: '翻译字幕', dub: '翻译配音', tts: '生成语音',
    'new-movie': '以此新建视频', 'add-to-movie': '加到视频'};
  /* 每种产物接着用的工具与动作；工具项只在那个工具收这种条目时才列（与工具目录的 Space 输入声明一致） */
  const FOLLOW = {
    doc: ['translate', 'tts', 'new-movie'],
    subtitle: ['translate', 'tts', 'new-movie'],
    audio: ['new-movie', 'add-to-movie'],
    image: ['new-movie', 'add-to-movie'],
    final: ['new-movie', 'add-to-movie'],
  };
  const FOLLOW_MOVIE = {transcribe: ['translate', 'dub'], translate: ['dub'], dub: []};
  const isTool = (id) => !!(root.BC_TOOLS && root.BC_TOOLS.toolById(id));
  const takes = (tool, kind) => {
    const t = root.BC_TOOLS && root.BC_TOOLS.toolById(tool);
    return !!t && t.inputs.some((i) => i.kind === 'space' && i.kinds.indexOf(kind) >= 0);
  };
  /**
   * 一个产物接着能做什么：`[{id, label, kind: 'tool'|'action'}]`。`tool` 项用 openToolWith 进那个工具（这个产物已经选好），
   * `action` 项是结果页上的动作。在 Space 中查看、在文件夹中显示、交给 Agent 每行都有，不在这张表里。
   * @param {{kind: string}} entry 产物条目；写进视频的结果是视频条目（kind = 'movie'）
   * @param {string} [fromTool] 产出它的工具：写进视频之后，转录接翻译字幕与翻译配音，翻译字幕接翻译配音
   */
  function followUps(entry, fromTool) {
    if (!entry) return [];
    const ids = entry.kind === 'movie' ? ['open-movie'].concat(FOLLOW_MOVIE[fromTool] || []) : (FOLLOW[entry.kind] || []);
    return ids.filter((id) => !isTool(id) || takes(id, entry.kind))
      .map((id) => ({id, label: NEXT_LABEL[id], kind: isTool(id) ? 'tool' : 'action'}));
  }
  /** 结果是不是写进了一部视频（有「打开编辑」）：可编辑的视频，或转录改选了新建视频 */
  const opensMovie = (tool, input, o) => input === 'video' || (tool === 'transcribe' && !!o && o.target === 'create');

  /* ---------- 当场授权 ---------- */
  /** 价目串里的数：`$0.006 / 分钟` → {amount: 0.006, unit: '分钟', currency: '$'}；读不出 → null */
  function parsePrice(s) {
    const m = String(s || '').match(/([$¥€])\s*([\d.]+)\s*\/\s*(分钟|千字|字)/);
    return m ? {currency: m[1], amount: Number(m[2]), unit: m[3]} : null;
  }
  const money = (cur, v) => `约 ${cur}${v < 0.01 ? v.toFixed(3) : v.toFixed(2)}`;
  const minutes = (sec) => Math.max(1, Math.ceil((+sec || 0) / 60));

  /**
   * 一项要发出去的数据：`{key, recipient, data, what, cost}`。
   * `key` = 收件方 + 数据种类：同意过一次，同一家同一种数据之后不再问（原型只记在内存里）。
   * @param {{recipient, data: 'audio'|'transcript', seconds?, chars?, price?}} o
   */
  function need(o) {
    const what = o.data === 'audio'
      ? `这段素材的音轨，约 ${minutes(o.seconds)} 分钟`
      : `文稿文字，约 ${Math.max(1, Math.round(o.chars || 0)).toLocaleString('en-US')} 字`;
    const p = parsePrice(o.price);
    /* 中文里夹西文名字时两边留空格 */
    const who = /^[\x20-\x7e]+$/.test(o.recipient) ? ` ${o.recipient} ` : o.recipient;
    let cost = `按${who}的价目计费，这里估不出金额`;
    if (p && p.unit === '分钟' && o.data === 'audio') cost = `${money(p.currency, p.amount * minutes(o.seconds))}（${o.price}）`;
    else if (p && p.unit === '千字' && o.chars) cost = `${money(p.currency, p.amount * o.chars / 1000)}（${o.price}）`;
    return {key: `${o.recipient}:${o.data}`, recipient: o.recipient, data: o.data === 'audio' ? '音频' : '文稿', what, cost};
  }

  /** 去掉已同意过的项；同一收件方与数据种类只列一次 */
  function grantNeeds(needs, granted) {
    const has = typeof granted === 'function' ? granted : (k) => (granted || []).indexOf(k) >= 0;
    const seen = new Set();
    return (needs || []).filter(Boolean).filter((n) => {
      if (seen.has(n.key) || has(n.key)) return false;
      seen.add(n.key);
      return true;
    });
  }

  /* ---------- 识别说话人（转录设置的「更多选项」） ---------- */

  const DIARIZE_PACK = 'speaker-diarization';
  /**
   * 「识别说话人」开关此刻的样子。转录工具页与重新转录共用。
   * - `builtin`：模型自带区分（MOSS Transcribe、部分在线服务）——开着、锁住，不另跑一步；
   * - `pack`：要本机的「说话人区分」包。没拨过（`pick` 为 null）时装了就开、没装就关：
   *   默认不替人下载，也不让一个没下载的包挡住开始；拨开了又没装 → `missing`，就地给下载；
   * - `none`：在线服务不区分说话人——关着、锁住。
   * @param {{speakers?: 'builtin'|'pack'}|null} model D.models 的一行；本机模型缺这个字段按 `pack`，在线服务缺它按 `none`
   * @param {boolean|null} pick 用户亲手拨的值
   * @param {(id: string) => boolean} installed
   * @returns {{kind: 'builtin'|'pack'|'none', on: boolean, locked: boolean, missing: boolean, step: boolean}}
   *   `step`：要不要在转写之后单列「识别说话人」一步
   */
  function speakerSwitch(model, pick, installed) {
    const m = model || {};
    const cloud = !!m.provider || String(m.id || '').startsWith('cloud:');
    const kind = m.speakers === 'builtin' ? 'builtin' : m.speakers === 'pack' || (!m.speakers && !cloud) ? 'pack' : 'none';
    if (kind === 'builtin') return {kind, on: true, locked: true, missing: false, step: false};
    if (kind === 'none') return {kind, on: false, locked: true, missing: false, step: false};
    const has = !!(installed && installed(DIARIZE_PACK));
    const on = pick == null ? has : !!pick;
    return {kind, on, locked: false, missing: on && !has, step: on};
  }
  /**
   * 开关下面那一句，与折叠标题上的状态。`name`：语音模型名；`pack`：说话人区分包那一行（D.setModels，体积按 MB）。
   * @returns {{note: string, summary: string}}
   */
  function speakerCopy(s, name, pack) {
    const size = pack && pack.size ? `（${pack.size} MB）` : '';
    if (s.kind === 'builtin') return {note: `${name} 自带说话人区分，转录时一起完成`, summary: '识别说话人 · 模型自带'};
    if (s.kind === 'none') return {note: `${name} 不区分说话人；需要时换一只本机模型，或自带区分的服务`, summary: '不识别说话人'};
    if (s.missing) return {note: `要先下载「${(pack && pack.name) || '说话人区分'}」${size}，下完才能区分说话人`, summary: '识别说话人 · 要先下载模型'};
    if (s.on) return {note: '转写之后用「说话人区分」给每句标上说话人，字幕与文稿都会带名字', summary: '识别说话人'};
    return {note: '不区分说话人，字幕与文稿不标名字', summary: '不识别说话人'};
  }

  root.BC_TOOL_RUNS = {
    DIARIZE_PACK, speakerSwitch, speakerCopy,
    STEP, plan, create, withOutputs, outputsPatch, advance, fail, retry, pct, phase, taskPatch, NEXT_LABEL, followUps, opensMovie, parsePrice, need, grantNeeds,
  };
})();
