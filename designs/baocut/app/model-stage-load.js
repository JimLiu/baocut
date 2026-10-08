/* 预览还没出画面时的舞台状态（产品设计 §5.1「预览载入与卡住」，2026-10-07 确认）。
   window.BC_STAGE_LOAD。纯函数，无 React、无 DOM。

   四种状态：
     · ready     画面出来了，什么都不画；
     · loading   预览还在载入：舞台上是安静的载入态（不是一块光秃秃的黑），过一小会儿才露出转圈，
                 打开很快的视频不闪一下；
     · preparing 媒体浏览器放不了、Runtime 在转换一份能播放的副本（`media.playback` 回 pending）：
                 说正在准备预览、带百分比与进度条，点名在转哪个媒体，说只转第一次。进度在走就不算卡住；
                 满 `STALL_MS` 没动才算卡在转换。还不知道进度（Runtime 没探到时长）时进度条不定、也不算卡住——
                 转换有自己的超时，失败走「主媒体放不出来」那张卡；
     · stalled   卡在同一步超过 `STALL_MS`：画面正中一张卡，说预览卡住了、卡在哪一步，带「重试」
                 （只重新载入预览，不动视频）。门槛与步骤和产品里预览引擎的卡住诊断是同一套
                 （packages/ui/src/components/editor/preview-watch.ts 的 STALL_MS 与 StallStep）。

   原型的状态来自「原型开关」（store `stageLoadDemo`）：`mode` 是挡位，`since` 是切到这一挡的时刻。
   「载入中」挡位按真实的门槛演：满 `STALL_MS` 自己变成卡在引擎；「转换中」演一段比门槛长的转换，进度一直在走、
   走完就出画面；「转换卡住」走到 37% 不动，满门槛变成卡在转换；几个「卡住」挡位直接演卡住；
   「重试」切到 retrying，载入一小会儿后好了。 */
(function () {
  /** 卡在同一步这么久才说卡住（与产品里的诊断同一个门槛） */
  const STALL_MS = 10000;
  /** 载入这么久还没好才露出转圈（快的打开不闪） */
  const SPINNER_DELAY_MS = 500;
  /** 原型里「重试」之后演多久的载入 */
  const RETRY_DEMO_MS = 1500;
  /** 原型里「转换中」演多久（比卡住门槛长：进度在走就不算卡住） */
  const PREPARE_DEMO_MS = 24000;
  /** 原型里转换开始后这么久还不知道进度（Runtime 先探时长，产品里通常一瞬） */
  const PROGRESS_AFTER_MS = 1000;
  /** 原型里「转换卡住」走到这里不动 */
  const FROZEN_PROGRESS = 0.37;
  const FROZEN_AFTER_MS = 2000;
  /** 转换没完成前最多显示 99%（与 `BC_PROXY` 同理：挂着 100% 读起来像卡死） */
  const MAX_PCT = 99;
  /** 转换中按这个节拍刷新百分比 */
  const TICK_MS = 1000;

  const COPY = {
    zh: {
      loading: '正在载入预览',
      preparing: '正在准备预览',
      converting: (name) => `要先转换才能播放：${name}`,
      once: '只在第一次打开时转换，之后直接播放；原文件不会改动。',
      stalled: '预览卡住了',
      steps: {
        engine: () => '预览引擎还在载入',
        video: () => '还在准备这部视频',
        media: (name) => `在等媒体：${name}`,
        prepare: (name) => `转换媒体没有进展：${name}`,
        captions: (name) => `在等字幕：${name}`,
        fonts: (name) => `在等字体：${name}`,
        paint: () => '画面一直没有更新',
      },
      body: (seconds) => `已经等了 ${seconds} 秒。重试只重新载入预览，不会改动视频。`,
      retry: '重试',
      captionsName: '原文字幕',
    },
    en: {
      loading: 'Loading preview',
      preparing: 'Preparing preview',
      converting: (name) => `Converting so it can play: ${name}`,
      once: "This happens only the first time it opens. Your original file isn't changed.",
      stalled: 'Preview is stuck',
      steps: {
        engine: () => 'Preview engine still loading',
        video: () => 'Still preparing this video',
        media: (name) => `Waiting for media: ${name}`,
        prepare: (name) => `Media conversion isn't progressing: ${name}`,
        captions: (name) => `Waiting for captions: ${name}`,
        fonts: (name) => `Waiting for fonts: ${name}`,
        paint: () => 'The picture stopped updating',
      },
      body: (seconds) => `Waited ${seconds} s. Trying again reloads only the preview; your video isn't changed.`,
      retry: 'Try again',
      captionsName: 'Original captions',
    },
  };
  const copyOf = (lang) => COPY[lang === 'en' ? 'en' : 'zh'];
  /* 百分比前的分隔与标题栏任务胶囊「任务 · N%」、`BC_PROXY` 的胶囊同一个：空格 + 中点 + 空格。 */
  const SEP = ' · ';

  /** 原型开关的挡位：[mode, 标签]。stall-* 直接演卡在那一步。 */
  const DEMOS = [
    ['ready', '正常'],
    ['loading', '载入中'],
    ['preparing', '转换中'],
    ['prepare-stuck', '转换卡住'],
    ['stall-engine', '卡住 · 引擎'],
    ['stall-media', '卡住 · 媒体'],
    ['stall-captions', '卡住 · 字幕'],
  ];

  /** 切到某一挡时存进 store 的值；`now` 是毫秒时间戳 */
  function demo(mode, now) {
    return {mode, since: now};
  }

  /** 转换进度（0–1）→ 显示的百分比：向下取整、封顶 99；不知道进度是 null */
  function pct(progress) {
    if (typeof progress !== 'number' || !(progress >= 0)) return null;
    return Math.min(MAX_PCT, Math.floor(progress * 100));
  }

  /** 此刻的状态：{phase: 'ready' | 'loading' | 'preparing' | 'stalled', step?, progress?, waitedMs} */
  function stateAt(d, now) {
    const mode = d && d.mode ? d.mode : 'ready';
    const waited = Math.max(0, now - (d && typeof d.since === 'number' ? d.since : now));
    if (mode === 'retrying') return waited < RETRY_DEMO_MS ? {phase: 'loading', waitedMs: waited} : {phase: 'ready', waitedMs: 0};
    if (mode === 'loading') return waited < STALL_MS ? {phase: 'loading', waitedMs: waited} : {phase: 'stalled', step: 'engine', waitedMs: waited};
    if (mode === 'preparing') {
      if (waited >= PREPARE_DEMO_MS) return {phase: 'ready', waitedMs: 0};
      const progress = waited < PROGRESS_AFTER_MS ? null : (waited - PROGRESS_AFTER_MS) / (PREPARE_DEMO_MS - PROGRESS_AFTER_MS);
      return {phase: 'preparing', progress, waitedMs: waited};
    }
    if (mode === 'prepare-stuck') {
      // 进度停在 FROZEN_PROGRESS 那一刻起算卡住；卡住的「等了多久」也从那一刻算。
      if (waited < FROZEN_AFTER_MS) return {phase: 'preparing', progress: FROZEN_PROGRESS * waited / FROZEN_AFTER_MS, waitedMs: waited};
      const still = waited - FROZEN_AFTER_MS;
      return still < STALL_MS ? {phase: 'preparing', progress: FROZEN_PROGRESS, waitedMs: waited} : {phase: 'stalled', step: 'prepare', waitedMs: still};
    }
    if (mode.startsWith('stall-')) return {phase: 'stalled', step: mode.slice('stall-'.length), waitedMs: STALL_MS + waited};
    return {phase: 'ready', waitedMs: 0};
  }

  /** 下一次状态会变的时刻离现在多久（毫秒）；不会再自己变就是 null。舞台按它排一次计时器。 */
  function waitMs(d, now) {
    const s = stateAt(d, now);
    if ((s.phase === 'loading' || s.phase === 'preparing') && s.waitedMs < SPINNER_DELAY_MS) return SPINNER_DELAY_MS - s.waitedMs;
    // 转换中按节拍刷新百分比；演示里的几个转折（知道进度、停住、卡住、走完）都落在节拍上。
    if (s.phase === 'preparing') return TICK_MS - (s.waitedMs % TICK_MS);
    if (d && d.mode === 'retrying' && s.phase === 'loading') return RETRY_DEMO_MS - s.waitedMs;
    if (d && d.mode === 'loading' && s.phase === 'loading') return STALL_MS - s.waitedMs;
    // 卡住时每秒更新「已经等了 N 秒」。
    if (s.phase === 'stalled') return 1000 - (s.waitedMs % 1000);
    return null;
  }

  /** 舞台上画什么；`names` 是步骤里点名的对象（{media, captions, fonts}），没有时用通用说法 */
  function notice(d, now, names, lang) {
    const s = stateAt(d, now);
    const c = copyOf(lang);
    if (s.phase === 'ready') return null;
    // 转换中的头一小会儿与载入一样安静：很快就转好的短片不闪出进度条。
    if (s.phase === 'loading' || (s.phase === 'preparing' && s.waitedMs < SPINNER_DELAY_MS)) {
      return {kind: 'loading', label: c.loading, spinner: s.waitedMs >= SPINNER_DELAY_MS};
    }
    if (s.phase === 'preparing') {
      const p = pct(s.progress);
      return {
        kind: 'preparing',
        label: p == null ? c.preparing : `${c.preparing}${SEP}${p}%`,
        pct: p,
        detail: c.converting((names && names.media) || '—'),
        body: c.once,
      };
    }
    // 转换卡住点名的也是那个媒体。
    const key = s.step === 'prepare' ? 'media' : s.step;
    const name = (names && names[key]) || (s.step === 'captions' ? c.captionsName : '—');
    const step = (c.steps[s.step] || c.steps.paint)(name);
    return {kind: 'stalled', step: s.step, title: c.stalled, detail: step, body: c.body(Math.floor(s.waitedMs / 1000)), retry: c.retry};
  }

  window.BC_STAGE_LOAD = {STALL_MS, SPINNER_DELAY_MS, RETRY_DEMO_MS, PREPARE_DEMO_MS, PROGRESS_AFTER_MS, FROZEN_PROGRESS, FROZEN_AFTER_MS,
    COPY, DEMOS, demo, pct, stateAt, waitMs, notice};
})();
