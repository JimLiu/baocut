/* 翻译运行态 —— §13.2「运行态头」/ §15.3 翻译 flow 的纯层。

   要点是**每个阶段该看见什么不一样**，而不是一根进度条从头走到尾：
     读文稿    还没有任何译文可看 —— 出骨架，别摆空列表假装在流
     翻译      句子一句句上屏，**整句上屏、没有块刻度**（这是合法中间态，
               不是「对齐丢了」；§15.3「整句上屏是合法中间态」）
     拆分对齐  译文都在了，块刻度一条条长出来，在飞那句挂「正在拆分对齐…」
     落盘      全部成形

   `apps/baocut` 的阶段判定在 `adapters/translate_badge.rs::translate_phase_index`，
   `TRANSLATE_PHASE_ENDS = [8, 70, 96, 100]` 与这里的 `STAGE_ENDS` 同源（台账 #18
   已收口）。它早先是 `floor(pct / 25)` 四等分——读文稿是个快步骤、翻译才是大头，
   等分会让阶梯写着「读文稿」而卡片已经在流，**阶梯与正文当场互相打脸**。 */
(function () {
  const TRANS_STAGES = ['读文稿', '翻译', '拆分对齐', '落盘'];
  // 每一段的**结束**百分比；读文稿快、翻译是主体、对齐次之、落盘收尾
  const STAGE_ENDS = [8, 70, 96, 100];

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  /** 当前在第几段。排队中恒在第 0 段——它还没开始读。 */
  function stage(pct, queued) {
    if (queued) return 0;
    if (!(pct > 0)) return 0;
    if (pct >= 100) return TRANS_STAGES.length - 1;
    for (let i = 0; i < STAGE_ENDS.length; i++) if (pct < STAGE_ENDS[i]) return i;
    return TRANS_STAGES.length - 1;
  }

  /** 某一段内部走了多少（0–1）。段外一律夹到两头。 */
  function frac(pct, i) {
    const lo = i === 0 ? 0 : STAGE_ENDS[i - 1];
    return clamp01((pct - lo) / (STAGE_ENDS[i] - lo));
  }

  /* 句子的四种在跑状态：
       translating  在飞那一句，译文位还是空的
       translated   译好了，还没拆分对齐 —— 整句上屏、无刻度
       aligning     正在长块刻度的那一句
       aligned      成形
     没轮到的句子**不渲染**：还没读到的东西摆一排灰条，是在假装进度。 */
  function runSlice(rows, pct, queued) {
    const n = rows.length;
    const st = stage(pct, queued);
    const q = !!queued;
    if (st === 0) return {stage: st, queued: q, rows: [], translated: 0, aligned: 0};
    const translated = st === 1 ? Math.min(n, Math.floor(frac(pct, 1) * n)) : n;
    const aligned = st < 2 ? 0 : st === 2 ? Math.min(n, Math.floor(frac(pct, 2) * n)) : n;
    const shown = st === 1 ? Math.min(n, translated + 1) : n;
    const out = [];
    for (let i = 0; i < shown; i++) {
      let state;
      if (i < aligned) state = 'aligned';
      else if (st === 2 && i === aligned) state = 'aligning';
      else if (i < translated) state = 'translated';
      else state = 'translating';
      out.push({row: rows[i], state, i});
    }
    return {stage: st, queued: q, rows: out, translated, aligned};
  }

  /* 行数与调用数（App v2 运行态头的两行计数）。
     **行数只在翻译那一段涨**——它数的是译出来的句子；调用数跟着整条跑，
     因为对齐那一段同样在打模型。 */
  function counts(pct, totals, queued) {
    const st = stage(pct, queued);
    const lines = st === 0 ? 0
      : st === 1 ? Math.min(totals.lines, Math.floor(frac(pct, 1) * totals.lines))
      : totals.lines;
    const calls = st === 0 ? 0 : Math.min(totals.calls, Math.round((pct / 100) * totals.calls));
    return {lines, linesTotal: totals.lines, calls, callsTotal: totals.calls};
  }

  /* 一行波次短语。对齐那一段跑的是确定性代码 + 打分模型，署名不是翻译模型。
     **排队中没有波次短语**——那会儿没有任何模型在动，写一句「正在…」是编的。 */
  function activity(slice, model) {
    if (slice.queued) return null;
    switch (slice.stage) {
      case 0: return model + ' · 读文稿并分句';
      case 1: return model + ' · 正在翻第 ' + (slice.translated + 1) + ' 句 · 在飞 2';
      case 2: return 'align-edges · 正在拆分对齐第 ' + (slice.aligned + 1) + ' 句 · 在飞 1';
      default: return model + ' · 写回 transcript.json';
    }
  }

  /* ---------- 第 207 轮：这条任务是谁的、谁在跑 ----------
     翻译任务只有**任务记录**一份真相（产品里是 jobs.json）。编辑器不再认死一条演示任务，
     而是从任务表里找**这个项目**正在跑 / 排队的翻译——App 面板、命令行、Agent 会话开出来的
     都算：一门语言被谁翻着，字幕面板都得看得见。跑着的压过排队的；同态取最新起的那条
     （tasks 按起始顺序追加，所以从尾找）。 */
  function findJob(tasks, projectId) {
    const mine = (tasks || []).filter((t) => t && t.kind === 'translate' && t.project === projectId);
    const pick = (status) => { const xs = mine.filter((t) => t.status === status); return xs.length ? xs[xs.length - 1] : null; };
    return pick('running') || pick('queued') || null;
  }

  /* 发起方三档：app（这个进程自己开的）/ cli（命令行）/ agent（Agent 会话里的 bcut 调用）。
     没写来源的老记录按 app 算。 */
  function sourceKind(job) {
    const s = job && job.source;
    return s === 'cli' || s === 'external' ? 'cli' : s === 'agent' ? 'agent' : 'app';
  }

  /* 取消钮看的是「能不能取消」这一位，不是「谁发起的」（同 App v2 `TransRun.cancellable`）：
     App 与 Agent 开的任务归本进程管，默认能取消；命令行的任务在别的进程里，
     只有记录明确说它接受叫停（控制文件）时才给钮——摆一颗按不动的取消钮是假承诺。 */
  function canCancel(job) {
    if (!job || selfRun(job)) return false;
    if (sourceKind(job) === 'cli') return job.cancellable === true;
    return job.cancellable !== false;
  }

  /* 翻译一开跑，列表要不要跳到目标语：**只有用户自己在这个面板里点的**才跳——
     那是他刚要的东西，停在别的列表上会看不出有任何事情发生。命令行 / Agent 开的翻译
     是背景里发生的事，用户可能正在校对原文：不抢他的列表，进度条 + 轨条尾巴负责让他看见。 */
  function jumpsList(job) {
    return sourceKind(job) === 'app';
  }

  /* Agent 开的任务，`sub` 尾段写着「会话「…」」——运行态头拿它指回那条会话。 */
  function sessionTitle(job) {
    const m = /会话「([^」]*)」/.exec((job && job.sub) || '');
    return m ? m[1] : null;
  }

  /* 智能体自己翻译（product-design §5.7；正式应用的 JobKind `agentTranslate`）：会话里的智能体读文稿时声明了目标语，
     在自己那一轮里逐句翻，译完一次写进视频。记录上没有百分比、没有四段步骤，也不归这个面板取消——
     运行态头与压缩条只写「翻译中」、画不确定的进度条，正文不流式出句子。 */
  function selfRun(job) {
    return !!(job && job.byAgent);
  }

  /* 压缩版运行态那一行字（只看原文时的进度条、轨条尾巴共用一套口径）：
     排队中不写「翻译中」——它还没开始。 */
  function stripText(job, srcAbbr, langName) {
    if (!job) return '';
    if (job.status === 'queued') return '排队中 · 翻译成 ' + langName;
    return '翻译中 · ' + srcAbbr + ' → ' + langName;
  }

  window.BC_TRUN = {TRANS_STAGES, STAGE_ENDS, stage, frac, runSlice, counts, activity,
    findJob, sourceKind, canCancel, jumpsList, sessionTitle, stripText, selfRun};
})();
