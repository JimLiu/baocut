/* BaoCut 原型 — Agent 会话里「下载 / 转录 / 翻译 / 导出」这几件活怎么演（只在 App 入口加载）
   window.BC_AGENT_SIM。无 React、无 DOM，node --test 直接 require；计时器在 store-agent-sim.jsx。

   在 BC_AGENT.planFor 的脚本之上补三件事：
   1. 「下载」脚本：话里有链接（且说了下载，或会话还没有视频）时，Agent 调 `downloads_fetch`。这时视频还没创建，
      会话可以没有视频；下载完成后建出视频记录（BC_IMPORT.movieRecord），接着用本机模型转录。
   2. 「转录」脚本：说「转录 / 转写 / 加字幕」且这条会话有视频时，Agent 调 `models_transcribe`。
      「重新转录」仍走原来那份 retranscribe 脚本。
   3. 视频卡上一件活一行的几种（转录、重新转录、翻译、导出）与下载在计划上带 `sim`：写入那一步的工具调用
      （BaoCut 工具名 + 参数摘要，步骤行据此念「转录 · moss-transcribe · 3 分 26 秒」）、任务记录要补的字段，
      以及按进度推出的阶段与计数。翻译没有单独的工具：Agent 自己译完，用 `edits_apply` 写一份译文文稿。
      失败后点「重试」的那一行由 `retrySim` 按任务记录重建一份，从头再推。
   4. 转录记下用的语音模型与参数（`model`、`runsOn`、`lang` / `langCode`、`diarize`），视频卡那一行只读地写出来。
   5. 「边转边问」：转录还在跑、Agent 先问一句就收掉这一轮（预置会话 s23）；用户回话时转录没完，
      这一轮调 `jobs_wait` 等它（`waitPlan`），视频卡跟到这一轮（product-design §3.2.2）。

   任务记录的阶段键沿用正式应用：转录与导出是 Job 阶段（`jobPhase`），翻译是流程步骤（`step`）；
   `phase` 仍写后台任务页念的那句话。时长是演示值，按进度线性推，不读真时钟，测试可以逐点断言。 */
(function () {
  const TRANSCRIBE_RE = /转录|转写|加字幕|出字幕/;
  const LANG = {en: '英语', ja: '日语', ko: '韩语'};
  const MEDIA_SEC = 206;
  const LINES = 62;
  const FRAMES = 6180;

  /* 阶段表：进度到 `upto` 之前处在这一阶段。最后一格的 upto 是 101，进度 100 也落在它里面。 */
  const SCHEDULE = {
    transcribe: [
      {upto: 8, jobPhase: 'decoding', phase: '解码音频'}, {upto: 70, jobPhase: 'transcribing', phase: '识别中'},
      {upto: 84, jobPhase: 'aligning', phase: '对齐时间'}, {upto: 96, jobPhase: 'diarizing', phase: '区分说话人'},
      {upto: 101, jobPhase: 'finalizing', phase: '整理结果'},
    ],
    translate: [
      {upto: 10, step: 'freeze-source', phase: '读取原文'}, {upto: 86, step: 'translate', phase: '翻译'},
      {upto: 95, step: 'assemble', phase: '组装译文'}, {upto: 101, step: 'write', phase: '写入视频'},
    ],
    export: [
      {upto: 88, jobPhase: 'generating', phase: '编码中'}, {upto: 96, jobPhase: 'validating', phase: '校验结果'},
      {upto: 101, jobPhase: 'publishing', phase: '保存文件'},
    ],
  };
  SCHEDULE.retranscribe = SCHEDULE.transcribe;

  /* 每一拍涨多少、整件活演示上算多长（毫秒）。转录走慢一点，四个阶段都看得到。 */
  const PACE = {transcribe: {step: 4, totalMs: 252000}, retranscribe: {step: 4, totalMs: 41000}, translate: {step: 5, totalMs: 31400},
    export: {step: 6, totalMs: 94000}, download: {step: 3, totalMs: 48000}};

  const slug = (s) => String(s || '视频').replace(/[\\/:*?"<>|]/g, ' ').trim();

  /* 下载：话里的链接；演示的失败链接（带 fail）在 34% 断网，下载卡写原因与重试 */
  const URL_RE = /https?:\/\/[^\s，。、）)」]+/i;
  const DOWNLOAD_RE = /下载|拉下来|保存这个视频/;
  const FAIL_AT = 34;
  const hostOf = (u) => { const m = /^https?:\/\/([^/?#]+)/i.exec(u); return m ? m[1].replace(/^www\./i, '').toLowerCase() : ''; };
  function fileOf(u) {
    const m = /\/([^/?#]+\.(mp4|mov|mkv|webm|m4v))(?:[?#]|$)/i.exec(u);
    if (m) return decodeURIComponent(m[1]);
    /* 没有文件名就取路径最后一段（watch?v= 这类取参数值），都没有才退回站点名 */
    const path = u.replace(/^https?:\/\/[^/?#]+/i, '');
    const q = /[?&](?:v|id)=([^&#]+)/i.exec(path);
    const seg = q ? q[1] : (path.split(/[?#]/)[0].split('/').filter(Boolean).pop() || hostOf(u).split('.')[0]);
    const slugged = decodeURIComponent(seg || '').replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40).toLowerCase();
    return (slugged || 'download') + '.mp4';
  }
  /** 演示用的探测结果：标题、体积与时长从链接哈希出来（不联网）。 */
  function probe(u) {
    let h = 0;
    for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) >>> 0;
    const name = fileOf(u);
    return {url: u, site: hostOf(u) || '网页', name, title: name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '),
      sizeMB: 180 + (h % 360), durationSec: 300 + (h % 1500), hue: h % 360};
  }

  function downloadPlan(u) {
    const p = probe(u);
    return {
      kind: 'download', re: URL_RE,
      summary: '这条链接里的视频还没下载。我先把它下载下来；下载完建一部视频，接着用本机语音模型转录。视频一建好你就能打开编辑器，不用等转录。',
      reads: [],
      write: {cmd: `bcut download ${u}`, why: '会把视频下载到会话所在的项目，不用项目时放在会话自己的文件夹；建一部新视频并开始转录。原有的视频与文件不动。'},
      step: {verb: '下载', count: p.sizeMB, unit: 'MB', llm: false, engine: '本机下载工具'},
      task: {kind: 'download', title: '下载视频'},
      receipt: null,
      close: null,
      sim: {kind: 'download', tool: 'downloads_fetch', args: {site: p.site, name: p.name},
        task: {url: u, site: p.site, name: p.name, title: p.title, sizeMB: p.sizeMB, mediaSec: p.durationSec, hue: p.hue,
          scenario: /fail|broken/i.test(u) ? 'network' : 'success'},
        result: {}},
    };
  }

  function transcribePlan(title) {
    return {
      kind: 'transcribe', re: TRANSCRIBE_RE,
      summary: '我先看一眼视频的音轨，再用本机语音模型转录：解码音频、识别、把每个词对到时间上、区分说话人。转完写进视频的文稿，写入前会先问你。',
      reads: [{tool: 'videos_inspect', args: {video: title}, out: '3 分 26 秒 · 1920×1080 · 1 条音轨 · 还没有文稿'}],
      write: {cmd: 'bcut transcribe project.bcut --model moss-transcribe', why: '会把文稿写进视频（transcript.json）；原片与时间轴不动，可整条撤销。'},
      step: {verb: '转录', count: MEDIA_SEC, unit: '秒音频', llm: false, engine: '本机语音模型'},
      task: {kind: 'transcribe', title: '转录', undoBody: '这一份文稿会被移除，视频回到没有文稿的状态。原片与时间轴不动。'},
      receipt: '已写入文稿 · 62 句 · 3 位说话人',
      close: '转完了：62 句、1,180 词、3 位说话人。文稿已经写进视频；要在画面上看到字幕，点卡片上的「放到画面上」。',
    };
  }

  /** 演示挡位「会话里没有可用的转写服务」：Agent 先查能力，查到没有可用的服务就停下，用设置链接告诉用户去哪里装或启用
      （product-design §3.2.2 的设置链接；正式客户端里这句话来自 models_capabilities 与 CAPABILITY_NOT_CONFIGURED 给的位置）。 */
  function noTranscriberPlan() {
    const L = window.BC_SETTINGS_LINK;
    const local = L.capabilityHref('transcribe');
    const cloud = '/settings/models/providers';
    return {
      kind: 'unavailable', write: null, task: null,
      summary: '我先看一下现在有哪些语音识别服务能用，能用再开始转录。',
      reads: [{tool: 'models_capabilities', args: {capability: 'transcribe'}, out: '语音识别 · 没有可用的服务'}],
      close: `现在没有可用的语音识别服务：本机的语音识别模型都没有安装，云端的语音识别服务也没有启用，所以还不能转录。\n\n`
        + `可以在[${L.parse(local).trail}](${local})里下载一个本机模型，或者在[${L.parse(cloud).trail}](${cloud})里添加一家能做语音识别的 API 提供方。弄好后告诉我，我接着转录。`,
    };
  }

  /** 转录的结果事实：句数与词数按时长折算（3 分 26 秒 ≈ 62 句、1,180 词）。 */
  function transcript(sec, speakers) {
    return {language: '中文', durationSec: sec, sentences: Math.max(1, Math.round(sec / 3.3)), words: Math.round(sec * 5.73), speakers, warnings: []};
  }

  /** 转录用的语音模型与参数写进任务记录的样子。缺省是本机的 MOSS Transcribe、中文、识别说话人（它自带区分）。 */
  function asrTask(asr) {
    const a = asr || {};
    return {model: a.model || 'moss-transcribe', runsOn: a.runsOn || '本机', lang: a.lang || '中文', langCode: a.langCode || 'zh',
      diarize: a.diarize != null ? !!a.diarize : true};
  }

  /** 这一件活在会话里的工具调用与任务字段；不是这几种的返回 null。`ctx.asr` 是转录用的模型与参数（asrTask）。 */
  function simFor(plan, ctx) {
    const c = ctx || {};
    const title = c.title || null;
    if (plan.kind === 'download') return plan.sim || null;
    if (plan.kind === 'transcribe' || plan.kind === 'retranscribe') {
      const sec = c.mediaSec || MEDIA_SEC;
      const asr = asrTask(c.asr);
      return {kind: plan.kind, tool: 'models_transcribe', args: {model: asr.model, duration: sec},
        task: Object.assign({}, asr, {mediaSec: sec, jobPhase: 'queued'}), step: c.step || null,
        result: {result: transcript(sec, asr.diarize ? 3 : 1)}};
    }
    if (plan.kind === 'translate') {
      const lang = LANG[plan.task && plan.task.target] || (plan.task && plan.task.target) || '英语';
      return {kind: 'translate', tool: 'edits_apply', lines: LINES, args: {putDocument: {schema: 'baocut.translation/2', language: lang, units: LINES}},
        task: {from: '中文', lang, model: c.agent || null, linesDone: 0, linesTotal: LINES, glossaryHits: 0, step: 'freeze-source'},
        result: {linesDone: LINES, glossaryHits: 7, result: {units: LINES, stale: 0, unaligned: 2}}};
    }
    if (plan.kind === 'export') {
      const name = slug(title);
      return {kind: 'export', tool: 'exports_create', frames: FRAMES, args: {resolution: '1080p', what: 'MP4 + 双语 SRT'},
        task: {model: null, runsOn: '本机渲染', framesDone: 0, framesTotal: FRAMES, jobPhase: 'generating'},
        result: {framesDone: FRAMES,
          files: [{name: `${name}.mp4`, path: `out/${name}.mp4`, width: 1920, height: 1080, durationSec: MEDIA_SEC, size: '482 MB'},
            {name: `${name}-both.srt`, path: `out/${name}-both.srt`, size: '18 KB'}],
          checks: [{label: '音画同步'}, {label: '字幕没有出画'}, {label: '3 句缺译，烧录时留空', ok: false}]}};
    }
    return null;
  }

  /** 失败后点「重试」：按任务记录重建一份推进用的 sim（计数的总数、转录的时长沿用记录上的）。 */
  function retrySim(task) {
    const t = task || {};
    if (t.kind === 'download') return {kind: 'download', task: {}, result: {}};
    const transcribe = t.kind === 'transcribe' || t.kind === 'retranscribe';
    const sim = simFor({kind: t.kind, task: {target: t.target}}, {mediaSec: t.mediaSec, title: t.title, step: t.paceStep,
      asr: transcribe && t.model ? {model: t.model, runsOn: t.runsOn, lang: t.lang, langCode: t.langCode, diarize: t.diarize} : null});
    if (!sim) return null;
    if (t.kind === 'translate' && t.linesTotal) {
      sim.lines = t.linesTotal;
      sim.result = {linesDone: t.linesTotal, glossaryHits: t.glossaryHits || 0, result: {units: t.linesTotal, stale: 0, unaligned: 0}};
    }
    if (t.kind === 'export' && t.framesTotal) {
      sim.frames = t.framesTotal;
      sim.result = Object.assign({}, sim.result, {framesDone: t.framesTotal}, t.files ? {files: t.files} : {});
    }
    if (transcribe && t.mediaSec) sim.result = {result: transcript(t.mediaSec, t.diarize === false ? 1 : t.speakers || 2)};
    return sim;
  }

  /** 用户在转录还在跑时回话：这一轮先应一句，调 `jobs_wait` 等那件转录，跑完写收据、收尾（store-agent-sim.jsx 的 runWait）。 */
  function waitPlan(task) {
    const what = task && task.kind === 'retranscribe' ? '重新转录' : '转录';
    return {
      kind: 'wait', write: null, reads: [], wait: {taskId: task.id},
      summary: `好，记下了。${what}还在跑，我先等它跑完，再按你说的接着做。`,
      tool: 'jobs_wait', args: {jobId: task.id, label: task.title || what},
    };
  }

  /** 等到的那件转录结束后的收尾话与收据（按任务记录：成了写句数与说话人，没成写原因）。 */
  function waitClose(task) {
    const t = task || {};
    const r = (t.result && t.result.result) || t.result || {};
    if (t.status !== 'done') {
      return {receipt: null, close: t.canceled ? '转录取消了，视频里没有写入文稿。要换个模型再转，在卡上说一声或直接告诉我。'
        : `转录没有完成：${t.error || '原因不明'}。处理好后点卡上的「重试」。`};
    }
    const facts = [r.sentences ? `${r.sentences} 句` : null, r.speakers ? `${r.speakers} 位说话人` : null].filter(Boolean).join(' · ');
    return {receipt: `已写入文稿${facts ? ' · ' + facts : ''}`,
      close: `转完了${facts ? '：' + facts.replace(' · ', '、') : ''}。文稿已经写进视频，接下来按你刚才说的做。`};
  }

  /** 会话里的计划：BC_AGENT 的脚本，加上下载、转录脚本与 `sim` 字段。`ctx` = {title: 视频名, agent: 「Claude Code · Sonnet」}。
      下载在会话还没有视频时也能写（BC_AGENT.planFor 在没视频时会把写入拿掉，所以先于它判断）。 */
  function planFor(text, hasProject, ctx) {
    const AG = window.BC_AGENT;
    const t = String(text || '');
    if (ctx && ctx.noTranscriber && TRANSCRIBE_RE.test(t) && !/^\s*\//.test(t)) return noTranscriberPlan();
    /* 还有没填的待填项（如快捷开始「转录并翻译」的目标语言）：先问，链接也等问清了再下 */
    const ask = AG.askFor && AG.askFor(t);
    if (ask) return ask;
    const url = URL_RE.exec(t);
    if (url && !/^\s*\//.test(t) && (DOWNLOAD_RE.test(t) || !hasProject)) return downloadPlan(url[0]);
    let plan = AG.planFor(t, hasProject);
    if (!hasProject || plan.kind === 'brief') return plan;
    const slash = /^\s*\//.test(t);
    if (!slash && (plan.kind === 'custom' || plan.kind === 'translate') && TRANSCRIBE_RE.test(t)) plan = transcribePlan((ctx && ctx.title) || '这部视频');
    const sim = plan.write ? simFor(plan, ctx) : null;
    return sim ? Object.assign({}, plan, {sim}) : plan;
  }

  /* 没开识别说话人的转录跳过「区分说话人」，那一段算进「整理结果」 */
  function stageAt(kind, pct, noDiarize) {
    const list = (SCHEDULE[kind] || []).filter((s) => !(noDiarize && s.jobPhase === 'diarizing'));
    return list.find((s) => pct < s.upto) || list[list.length - 1] || null;
  }

  /** 进度到 `pct` 时任务记录要改的字段：阶段、计数、用时与剩余。 */
  function progress(sim, pct) {
    const p = Math.max(0, Math.min(100, pct));
    const pace = PACE[sim.kind] || PACE.export;
    if (sim.kind === 'download') return {pct: p, elapsedMs: Math.round(pace.totalMs * p / 100), leftMs: Math.round(pace.totalMs * (100 - p) / 100)};
    const st = stageAt(sim.kind, p, !!(sim.task && sim.task.diarize === false));
    const out = {pct: p, elapsedMs: Math.round(pace.totalMs * p / 100), leftMs: Math.round(pace.totalMs * (100 - p) / 100)};
    if (st) {
      out.phase = st.phase;
      if (st.jobPhase) out.jobPhase = st.jobPhase;
      if (st.step) out.step = st.step;
    }
    if (sim.kind === 'translate') {
      /* 「翻译」这一步里逐句涨；术语表命中跟着译过的句数涨 */
      const span = SCHEDULE.translate[1];
      const from = SCHEDULE.translate[0].upto;
      const frac = Math.max(0, Math.min(1, (p - from) / (span.upto - from)));
      out.linesDone = Math.round((sim.lines || LINES) * frac);
      out.glossaryHits = Math.round(7 * frac);
    }
    if (sim.kind === 'export') out.framesDone = Math.round((sim.frames || FRAMES) * Math.min(1, p / SCHEDULE.export[0].upto));
    return out;
  }

  /** 跑完时任务记录要改的字段（状态、撤销位由 store 一起写）。 */
  function done(sim) {
    const pace = PACE[sim.kind] || PACE.export;
    return Object.assign({pct: 100, phase: null, leftMs: 0, elapsedMs: pace.totalMs,
      jobPhase: sim.kind === 'translate' ? undefined : 'done', step: sim.kind === 'translate' ? 'write' : undefined}, sim.result || {});
  }

  /** 每一拍涨多少；演示会话可以在任务上放慢（`paceStep`，留出边转边回话的时间）。 */
  function pace(sim) {
    return sim.step || (PACE[sim.kind] || PACE.export).step;
  }

  /** 下载这一拍该不该断：演示的失败链接在 FAIL_AT 断一次；重试过的不再断。 */
  function downloadFails(task, pct) {
    return !!task && task.scenario === 'network' && !task.retried && pct >= FAIL_AT;
  }

  /** 下载完成后 Agent 的收尾话与接着起的转录。 */
  function afterDownload(task) {
    return {
      close: `下载好了：「${task.title || task.name}」，${task.sizeMB} MB。视频已经建好，正在用本机语音模型转录——现在就可以打开编辑器，转录在后台接着跑。`,
      transcribe: simFor({kind: 'transcribe'}, {mediaSec: task.mediaSec}),
    };
  }

  /** 取消或停止之后那一句收尾。 */
  function stoppedText(sim) {
    const what = {transcribe: '转录', retranscribe: '重新转录', translate: '翻译', export: '导出', download: '下载'}[sim.kind] || '这一步';
    if (sim.kind === 'download') return '下载已取消，临时文件删掉了，没有建视频。要接着下，在下载卡上点「重试」。';
    return sim.kind === 'export'
      ? `${what}已取消，半成品文件删掉了。要换个设置再导，直接告诉我。`
      : `${what}已取消，视频里没有写入任何东西。要接着做，再说一声就行。`;
  }

  window.BC_AGENT_SIM = {TRANSCRIBE_RE, URL_RE, SCHEDULE, PACE, LANG, FAIL_AT, planFor, transcribePlan, noTranscriberPlan, downloadPlan, probe, simFor, retrySim,
    asrTask, waitPlan, waitClose,
    stageAt, progress, done, pace, downloadFails, afterDownload, stoppedText};
})();
