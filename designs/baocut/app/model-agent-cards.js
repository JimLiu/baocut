/* BaoCut 原型 — 会话线程里的卡片（product-design §3.2.2、§3.2.7、§4.2）里「算出来的东西」
   window.BC_AGENT_CARDS。无 React、无 DOM，node --test 直接 require。只在 App 入口加载。

   线程里只有三种卡（c7df73f5 的阶段卡 / 变更卡 / 交付卡 / 问题卡已并进视频卡）：
   - 视频卡（home-session.jsx 的 SessionArtifactCard）：视频记录一存在就出现，「打开编辑器」始终可用。
     一条会话一部视频一张，挂在最后一条引用它的消息后面；卡上的活在后一轮开始时还在跑，就跟到最新一轮
     （BC_AGENT_PROJECTS.sessionArtifacts）。列这条会话在它上面的全部活。
     头上一枚状态（BADGE 词表：未转录 / 已转录 / 转录中 / 排队中 / 失败，翻译在跑时是「翻译中」，`badge`），下面是这部视频上的活（`jobRow`）：
     转录、重新转录、翻译、导出，运行中是阶段 + 百分比 + 计数 + 已用与剩余 + 取消，
     完成后那一行换成结果事实，失败写原因与去处，取消写已取消。§4.2：进行中的生成以占位出现，完成后原位变成结果。
     卡上只摊开正在进行的活（可能几件同时在跑），都结束了就只摊开最后结束的那一件；别的收进一行「之前的 N 项」，
     展开才看到；收起的里有失败待处理的（`needsAction`），那一行写「N 项待处理」（`foldRows`，product-design §3.2.2 视频卡）。
   - 下载卡（`download`）：Agent 调下载工具时视频还没创建，单独一张；下载完成、视频记录建好后，
     那个位置换成视频卡（`rowCards`），之后跟着新的引用往下挪。
   - 候选卡（`candidate`）：合成语音 / 生成图片完成后的候选。运行中只在步骤行上带百分比，失败留在步骤行。
   卡片内容只从视频记录与任务记录算（`app.projects`、`app.tasks`，与步骤行、后台任务页同源），不从回复正文推断。

   任务记录在原型里的字段（正式应用的 JobRecord 对照见交付说明）：
   - 通用：kind、project（视频 id）、session、status（queued / running / done / error）、outcome、canceled、pct、
     elapsedMs、leftMs、model、runsOn、error、errorCode、cancellable、queuePos
   - 阶段：转录与导出是 Job 阶段 `jobPhase`，翻译是流程步骤 `step`；智能体自己翻译（`byAgent`）没有步骤与百分比
   - 计数：转录 `mediaSec`（按 pct 折算已识别的时长）、翻译 `linesDone / linesTotal`、导出 `framesDone / framesTotal`、
     下载 `sizeMB`（按 pct 折算已下）
   - 结果：转录 `result`（句数、说话人数、警告）、翻译 `lang` 与 `result`（条数、过期、未对齐）、导出 `files` 与 `checks`、
     候选 `outputs` 与 `picked`；下载 `url`、`site`、`name`、`issue`（BC_IMPORT 的失败种类）

   阶段与进度的说法沿用正式应用（packages/ui 的 copy.ts JOB_PHASE_LABEL、translate-progress、export-job、task-facts）。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /* 视频卡上一件活一行的几种；合成语音与生成图片不进视频卡（它们的结果是候选，不写进视频） */
  const ROW_KINDS = {
    transcribe: {name: '转录', icon: 'transcript'},
    retranscribe: {name: '重新转录', icon: 'transcript'},
    translate: {name: '翻译', icon: 'translate'},
    export: {name: '导出', icon: 'export'},
  };
  const CANDIDATE_KINDS = {tts: {name: '语音候选', action: '试听'}, image: {name: '图片候选', action: '预览'}};
  const TRANSCRIBE_KINDS = ['transcribe', 'retranscribe'];

  /* Job 的阶段 → 一句话（copy.ts JOB_PHASE_LABEL）。导出的「生成」说编码，发布说保存文件（export-job.ts）。 */
  const PHASE_LABEL = {
    queued: '排队中', starting: '准备中', loading: '加载模型', decoding: '解码音频', vad: '检测人声', transcribing: '识别中',
    aligning: '对齐时间', diarizing: '区分说话人', finalizing: '整理结果', generating: '生成中', validating: '校验结果',
    publishing: '保存结果', applying: '写入视频',
  };
  /* 翻译流程的四步（jobs/src/pipelines/translate.ts 的步骤名与标签） */
  const TRANSLATE_STEP = {'freeze-source': '读取原文', translate: '翻译', assemble: '组装译文', write: '写入视频'};

  const WARNINGS = {
    'diarization-unavailable': '说话人区分不可用，保留了分块内的说话人标签',
    'alignment-failed': '有几段对齐失败，词时间是估计的',
    'no-speech': '没有识别到人声',
  };

  /* 修复路径（task-facts.ts jobRemedy 的去处）：没配置的去设置启用，登录过期的去登录，输入过期或进程意外退出的重试。 */
  const SETTINGS_TAB = {transcribe: ['local', 'asr', 'cloud', 'stt'], retranscribe: ['local', 'asr', 'cloud', 'stt'],
    tts: ['local', 'tts', 'cloud', 'tts'], image: ['local', 'image', 'cloud', 'image'], translate: [null, null, 'cloud', 'llm']};
  const RETRY_CODES = ['STALE_JOB_INPUT', 'MODEL_CRASHED'];

  const pad2 = (n) => String(n).padStart(2, '0');
  /** `0:42`、`12:40`、`1:02:05`。 */
  function clock(ms) {
    const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return h ? `${h}:${pad2(m)}:${pad2(total % 60)}` : `${m}:${pad2(total % 60)}`;
  }
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const has = (v) => v != null && v !== '';
  const pctOf = (t) => Math.max(0, Math.min(100, Math.round(Number(t.pct) || 0)));

  function state(task) {
    if (task.status === 'queued') return 'queued';
    if (task.status === 'running') return 'running';
    if (task.status === 'done') return 'done';
    return task.canceled || task.outcome === 'canceled' ? 'canceled' : 'failed';
  }
  const live = (task) => task.status === 'running' || task.status === 'queued';

  /** 失败的去处；没有确定去处的返回 null（那一行只写原因）。 */
  function remedy(task) {
    const code = task.errorCode;
    const tabs = SETTINGS_TAB[task.kind] || [];
    const local = task.remedy && task.remedy.local;
    if (code === 'CAPABILITY_NOT_CONFIGURED') {
      const route = local && tabs[0] ? {r: 'settings', sec: tabs[0], tab: tabs[1]} : {r: 'settings', sec: tabs[2] || 'cloud', tab: tabs[3] || undefined};
      return {k: 'settings', label: '去设置启用', route};
    }
    if (code === 'AGENT_AUTH_REQUIRED') return {k: 'login', label: '去登录', route: {r: 'settings', sec: 'agent'}};
    if (code === 'PROVIDER_AUTH_FAILED') return {k: 'login', label: '去登录', route: {r: 'settings', sec: 'cloud', tab: tabs[3] || 'stt'}};
    if (RETRY_CODES.indexOf(code) >= 0) return {k: 'retry', label: '重试', route: null};
    return null;
  }

  /** 进行中的一句阶段文字：转录与导出读 Job 阶段，翻译读流程的步骤。 */
  function phaseLabel(task) {
    if (task.status === 'queued') return task.queuePos ? `排队中 · 第 ${task.queuePos} 位` : '排队中';
    if (task.kind === 'download') return task.pct >= 100 ? '验证媒体' : '下载中';
    if (task.kind === 'translate' && task.byAgent) return '智能体逐句翻译';
    if (task.kind === 'translate') return TRANSLATE_STEP[task.step] || '准备中';
    if (task.kind === 'export' && task.jobPhase === 'generating') return '编码中';
    if (task.kind === 'export' && task.jobPhase === 'publishing') return '保存文件';
    return PHASE_LABEL[task.jobPhase] || '准备中';
  }

  /** 计数那一句：已识别 11:58 / 26:00、已译 38 / 62 句、已画 2,719 / 6,180 帧、已下 86 / 320 MB。
      智能体自己翻译（`byAgent`）没有逐句进度，只写一共多少句。 */
  function countLabel(task) {
    switch (task.kind) {
      case 'translate':
        if (task.byAgent) return has(task.linesTotal) ? `共 ${task.linesTotal} 句` : null;
        return has(task.linesTotal) ? `已译 ${task.linesDone || 0} / ${task.linesTotal} 句` : null;
      case 'export': return has(task.framesTotal) ? `已画 ${num(task.framesDone)} / ${num(task.framesTotal)} 帧` : null;
      case 'download': return has(task.sizeMB) ? `已下 ${num(Math.round(task.sizeMB * pctOf(task) / 100))} / ${num(task.sizeMB)} MB` : null;
      case 'transcribe': case 'retranscribe':
        return has(task.mediaSec) && task.jobPhase === 'transcribing' && task.pct != null
          ? `已识别 ${clock(task.mediaSec * 1000 * Math.min(1, task.pct / 100))} / ${clock(task.mediaSec * 1000)}` : null;
      default: return null;
    }
  }

  /** 用时与剩余：「已用 4:12 · 剩余 1:30」（与导出窗口同一个说法）；没有剩余时间就只写已用，什么都没有返回 null。 */
  function timeLabel(task) {
    const parts = [];
    if (has(task.elapsedMs)) parts.push(`已用 ${clock(task.elapsedMs)}`);
    if (has(task.leftMs) && task.status === 'running') parts.push(`剩余 ${clock(task.leftMs)}`);
    return parts.length ? parts.join(' · ') : null;
  }

  /** 完成后的事实：转录「62 句 · 3 位说话人」，翻译「英语 · 62 条 · 2 条未对齐」。 */
  function facts(task) {
    const r = task.result || {};
    if (TRANSCRIBE_KINDS.indexOf(task.kind) >= 0) {
      return [has(r.sentences) ? `${r.sentences} 句` : null, has(r.speakers) ? `${r.speakers} 位说话人` : null].filter(Boolean);
    }
    if (task.kind === 'translate') {
      return [task.lang, has(r.units) ? `${r.units} 条` : null, r.stale ? `${r.stale} 条过期` : null,
        r.unaligned ? `${r.unaligned} 条未对齐` : null].filter(Boolean);
    }
    return [];
  }

  function warnings(task) {
    const r = task.result || {};
    return (r.warnings || []).map((w) => WARNINGS[w] || w);
  }

  /** 导出的文件：名字与「1920×1080 · 3:26 · 482 MB」。 */
  function files(task) {
    return (task.files || []).map((f) => ({name: f.name, path: f.path || null,
      meta: [f.width && f.height ? `${f.width}×${f.height}` : null, has(f.durationSec) ? clock(f.durationSec * 1000) : null, f.size].filter(Boolean).join(' · ')}));
  }

  /* ---------- 视频卡 ---------- */

  /** 翻译在跑时卡头的状态（product-design §3.2.2 视频卡）。只是这张卡上的一枚状态，不进 BADGE 词表：
      BADGE 是视频自己的转录状态，Space 与视频选择器也读它，翻译不改视频的转录状态。 */
  const TRANSLATING = {label: '翻译中', tone: 'accent'};

  /** 视频卡头上的状态（BADGE 的键与说法，data.js；Space 的视频状态同一套字，model-space.js）。
      视频记录是底；指向它的转录任务在跑 / 排队时，以任务为准（一份真相：进度只在任务记录上）。
      转录没在跑、有翻译在跑（任何会话、App 或智能体自己译的都算）时写「翻译中」：只有一件、知道百分比时带上它；
      智能体自己翻译没有百分比。 */
  function badge(movie, tasks) {
    const B = (root.BC_DATA && root.BC_DATA.BADGE) || {};
    const mine = (tasks || []).filter((t) => movie && t.project === movie.id && TRANSCRIBE_KINDS.indexOf(t.kind) >= 0);
    const run = mine.find((t) => t.status === 'running');
    const queued = mine.find((t) => t.status === 'queued');
    const translating = run || queued ? [] : (tasks || []).filter((t) => movie && t.project === movie.id && t.kind === 'translate' && t.status === 'running');
    if (translating.length) {
      const one = translating.length === 1 && !translating[0].byAgent ? pctOf(translating[0]) : null;
      return {k: 'translating', label: TRANSLATING.label, tone: TRANSLATING.tone,
        text: one != null ? `${TRANSLATING.label} · ${one}%` : TRANSLATING.label};
    }
    const k = run ? 'transcribing' : queued ? 'queued' : movie && B[movie.status] ? movie.status : 'ready';
    const b = B[k] || {label: k, tone: 'neutral'};
    const pct = run ? pctOf(run) : k === 'transcribing' && movie.progress != null ? movie.progress : null;
    const pos = queued ? queued.queuePos : k === 'queued' ? movie.queuePos : null;
    const text = pct != null ? `${b.label} · ${pct}%` : pos ? `${b.label} · 第 ${pos} 位` : b.label;
    return {k, label: b.label, tone: b.tone, text};
  }

  /** 这条会话里指向这部视频的活：会话自己起的（`session`），或这条会话的工具行引用过的（`taskId`）。
      按第一次被引用的先后排；会话没引用、只是记在会话上的排在后面。线程里的卡与「产物」弹层同一份。 */
  function sessionJobs(movieId, sess, tasks) {
    const order = new Map();
    ((sess && sess.messages) || []).forEach((m, i) => { if (m.taskId && !order.has(m.taskId)) order.set(m.taskId, i); });
    const list = (tasks || []).filter((t) => t.project === movieId && ROW_KINDS[t.kind]
      && !(t.kind === 'export' && t.purpose === 'preview')
      && (order.has(t.id) || (sess && t.session === sess.id)));
    const at = (t) => (order.has(t.id) ? order.get(t.id) : Infinity);
    return list.map((t, i) => [t, i]).sort((a, b) => (at(a[0]) - at(b[0])) || (a[1] - b[1])).map((x) => x[0]);
  }

  /** 转录用的是什么（product-design §3.2.2 视频卡）：「MOSS Transcribe · 本机 · 中文 · 识别说话人」。
      模型名取设置里的模型表（BC_DATA.models，云端写「服务商 · 模型」），表里没有的原样写 id；不是转录、没记模型的返回 null。 */
  function asrLine(task) {
    if (TRANSCRIBE_KINDS.indexOf(task.kind) < 0 || !task.model) return null;
    const M = (root.BC_DATA && root.BC_DATA.models) || {};
    const cloud = (M.cloud || []).find((m) => m.id === task.model);
    const local = (M.local || []).find((m) => m.id === task.model);
    const name = cloud ? `${cloud.provider} · ${cloud.name}` : local ? local.name : task.model;
    const where = cloud ? '云端' : local ? '本机' : null;
    return [name, where, task.lang || null, task.diarize ? '识别说话人' : null].filter(Boolean).join(' · ');
  }

  /** 能播放的导出：成片和音频可以播放，文件可以在文件夹中显示（product-design §3.2.2 视频卡）。看第一个文件的扩展名。 */
  const PLAYABLE = /\.(mp4|mov|m4v|webm|mkv|mp3|m4a|wav|aac|flac|ogg)$/i;

  /** 一件活一行：运行中阶段与进度，完成后结果事实，失败原因与去处。 */
  function jobRow(task) {
    const s = state(task);
    const k = ROW_KINDS[task.kind] || {name: task.kind, icon: 'tasks'};
    const running = s === 'running';
    const fix = s === 'failed' ? remedy(task) : null;
    const done = s === 'done';
    /* 智能体自己翻译（`byAgent`，正式应用的 JobKind `agentTranslate`）：没有逐句进度，进度条是不确定的；
       卡上不给取消——译文是智能体这一轮在写，要停就停那条会话（后台任务页的「停止」）。 */
    const self = task.kind === 'translate' && !!task.byAgent;
    const pct = running && !self ? pctOf(task) : null;
    const actions = [];
    if ((running || s === 'queued') && task.cancellable !== false && !self) actions.push({k: 'cancel', label: '取消'});
    if (fix) actions.push({k: fix.k, label: fix.label, route: fix.route});
    const outs = done && task.kind === 'export' ? task.files || [] : [];
    if (outs.length && PLAYABLE.test(outs[0].name || '')) actions.push({k: 'play', label: '播放'});
    if (outs.length) actions.push({k: 'reveal', label: '在文件夹中显示'});
    return {
      id: task.id, kind: task.kind, icon: k.icon, state: s,
      name: task.kind === 'translate' && task.lang ? `${k.name} · ${task.lang}` : k.name,
      /* 头上的右侧：运行中是百分比（没有百分比时不写），其余一个状态词 */
      tail: running ? (pct != null ? `${pct}%` : null) : s === 'queued' ? '排队中' : s === 'canceled' ? '已取消' : s === 'failed' ? '失败' : '完成',
      /* 运行中没有百分比时是 null：画不确定的细条 */
      pct,
      asr: asrLine(task),
      line: running ? [phaseLabel(task), countLabel(task)].filter(Boolean).join(' · ') : s === 'queued' ? phaseLabel(task) : null,
      time: running ? timeLabel(task) : null,
      facts: done ? facts(task) : [],
      warnings: done ? warnings(task) : [],
      file: done ? files(task)[0] || null : null,
      checks: done ? (task.checks || []).map((c) => ({label: c.label, ok: c.ok !== false})) : [],
      error: s === 'failed' ? task.error || '这一步没有完成' : null,
      actions,
    };
  }

  /** 视频卡上摊开哪几行、收起哪几行（`rows` 是 jobRow 的结果，按 sessionJobs 的先后）。
      - 有活在跑或排队：摊开全部进行中的（翻译与导出可以同时跑），按原先后；这时不再摊开已结束的。
      - 都结束了（完成 / 失败 / 已取消）：只摊开最后一件。任务记录没有结束时间，「最后」取列表里的最后一件，
        也就是最后一次被引用的先后（提交先后）；会话起了却没被消息引用的排在最末，算作最后。
      - 其余收进 `earlier`，**新的在前**（读起来是历史）。
      - `pending`：`earlier` 里待处理的件数（needsAction）。较早一件失败的活连同它的去处也收在里面，
        收起的那一行就写「N 项待处理」，看得出要点开处理；摊开着的不算。 */
  function foldRows(rows) {
    const list = rows || [];
    const isLive = (r) => r.state === 'running' || r.state === 'queued';
    const liveRows = list.filter(isLive);
    const shown = liveRows.length ? liveRows : list.slice(-1);
    const earlier = list.filter((r) => shown.indexOf(r) < 0).reverse();
    return {shown, earlier, pending: earlier.filter(needsAction).length};
  }

  /** 这一行要不要人去处理：失败了、而且有去处（重试 / 去设置 / 去登录）。失败但没有去处的、已取消的都不算。 */
  const FIX_KS = ['retry', 'settings', 'login'];
  function needsAction(row) {
    return !!row && row.state === 'failed' && (row.actions || []).some((a) => FIX_KS.indexOf(a.k) >= 0);
  }

  /** 视频卡的全部内容：状态（视频此刻的状态）+ 这条会话在这部视频上的活（sessionJobs）。
      `rows` 是全部，按 sessionJobs 的先后；卡上画的是 `shown` 与收起的 `earlier`，`pending` 是收起里待处理的件数（foldRows）。 */
  function movieCard(movie, sess, tasks) {
    const rows = movie ? sessionJobs(movie.id, sess, tasks).map(jobRow) : [];
    const fold = foldRows(rows);
    return {badge: badge(movie, tasks), rows, shown: fold.shown, earlier: fold.earlier, pending: fold.pending};
  }

  /* ---------- 下载卡 ---------- */

  /** 下载卡：来源、进度与已下多少、已用与剩余、取消；失败写原因（BC_IMPORT 的失败种类）与重试。 */
  function download(task) {
    const s = state(task);
    const running = s === 'running';
    const issue = task.issue && root.BC_IMPORT ? root.BC_IMPORT.issues[task.issue] : null;
    const retryable = s === 'failed' ? !issue || issue.retryable : s === 'canceled';
    const actions = [];
    if ((running || s === 'queued') && task.cancellable !== false) actions.push({k: 'cancel', label: '取消'});
    if (retryable) actions.push({k: 'retry', label: '重试'});
    return {
      id: task.id, state: s,
      title: s === 'done' ? '下载完成' : s === 'failed' ? '下载没有完成' : s === 'canceled' ? '下载已取消' : s === 'queued' ? '等待下载' : '正在下载视频',
      name: task.title || task.name || '视频',
      source: task.url || [task.site, task.name].filter(has).join(' · '),
      pct: running ? pctOf(task) : null,
      line: running ? [phaseLabel(task), countLabel(task)].filter(Boolean).join(' · ') : null,
      time: running ? timeLabel(task) : null,
      error: s === 'failed' ? (issue ? issue.title : task.error || '下载没有完成') : null,
      hint: s === 'failed' && issue ? issue.body : null,
      actions,
    };
  }

  /* ---------- 候选卡 ---------- */

  /** 候选：语音是「0:06 · 温和女声」，图片是「768×1344」。 */
  function candidates(task) {
    return (task.outputs || []).map((o, i) => ({i, name: o.name, text: o.text || null, art: o.art != null ? o.art : null,
      meta: [has(o.durationSec) ? clock(o.durationSec * 1000) : null, o.width && o.height ? `${o.width}×${o.height}` : null, o.voice].filter(Boolean).join(' · '),
      picked: task.picked === i}));
  }

  /** 合成语音 / 生成图片完成后的候选卡；没完成或没有候选的返回 null（运行中与失败都留在步骤行上）。 */
  function candidate(task) {
    const k = task && CANDIDATE_KINDS[task.kind];
    if (!k || task.status !== 'done' || !(task.outputs || []).length) return null;
    return {id: task.id, kind: task.kind, title: k.name, sub: [task.model, task.runsOn].filter(has).join(' · '),
      action: k.action, candidates: candidates(task)};
  }

  /* ---------- 锚点：哪一行后面挂哪几张卡 ---------- */

  /** 消息 id → 它所在的线程行 id（工具消息折进前一条回复的 `work` 或 `work-` 组，不是自己一行）。 */
  function rowIndex(rows) {
    const out = new Map();
    (rows || []).forEach((row) => {
      out.set(row.id, row.id);
      (row.items || []).forEach((m) => out.set(m.id, row.id));
      (row.work || []).forEach((m) => out.set(m.id, row.id));
    });
    return out;
  }

  /** 线程里每一行后面挂的卡：会话产物（视频卡等，`artifacts` 来自 BC_AGENT_PROJECTS.sessionArtifacts）、
      还没建出视频的下载、完成的候选。视频卡一条会话一部视频一张，挂在 sessionArtifacts 算出的锚点；
      下载卡挂在最后一条引用它的工具行，候选卡挂在第一次引用它的那一行；下载建出视频后，
      视频卡挂在同一条工具消息上（sessionArtifacts 的锚点），下载卡就不再出。
      返回 Map(行 id → [{k: 'artifact', item} | {k: 'download', taskId} | {k: 'candidate', taskId}])，行内按消息先后。 */
  function rowCards(rows, messages, artifacts, tasks) {
    const idx = rowIndex(rows);
    const order = new Map((messages || []).map((m, i) => [m.id, i]));
    const byId = new Map((tasks || []).map((t) => [t.id, t]));
    const shown = new Set((artifacts || []).map((a) => a.id));
    const list = [];
    (artifacts || []).forEach((a) => { if (idx.has(a.messageId)) list.push({at: order.get(a.messageId), row: idx.get(a.messageId), card: {k: 'artifact', item: a}}); });
    const seen = new Map();
    (messages || []).forEach((m, i) => {
      if (m.role !== 'tool' || !m.taskId || !idx.has(m.id)) return;
      const t = byId.get(m.taskId);
      if (!t) return;
      /* 下载卡是视频卡的占位，跟视频卡一样挪到最新一条引用；候选卡留在第一次引用处 */
      if (t.kind === 'download' && !(t.project && shown.has(t.project))) {
        const at = {at: i, row: idx.get(m.id), card: {k: 'download', taskId: t.id}};
        if (seen.has(t.id)) Object.assign(seen.get(t.id), at);
        else { seen.set(t.id, at); list.push(at); }
      } else if (!seen.has(t.id) && candidate(t)) {
        seen.set(t.id, true);
        list.push({at: i, row: idx.get(m.id), card: {k: 'candidate', taskId: t.id}});
      }
    });
    const out = new Map();
    list.sort((a, b) => (a.at == null ? Infinity : a.at) - (b.at == null ? Infinity : b.at)).forEach((x) => {
      if (!out.has(x.row)) out.set(x.row, []);
      out.get(x.row).push(x.card);
    });
    return out;
  }

  root.BC_AGENT_CARDS = {
    ROW_KINDS, CANDIDATE_KINDS, PHASE_LABEL, WARNINGS,
    state, remedy, phaseLabel, countLabel, timeLabel, facts, warnings, files, clock, asrLine,
    badge, sessionJobs, jobRow, foldRows, needsAction, movieCard, download, candidates, candidate, rowIndex, rowCards,
  };
})();
