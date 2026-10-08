/* 预览还没出画面时的舞台状态（产品设计 §5.1「预览载入与卡住」，2026-10-07 确认）。
   window.BC_STAGE_LOAD。纯函数，无 React、无 DOM。

   三种状态：
     · ready    画面出来了，什么都不画；
     · loading  预览还在载入：舞台上是安静的载入态（不是一块光秃秃的黑），过一小会儿才露出转圈，
                打开很快的视频不闪一下；
     · stalled  卡在同一步超过 `STALL_MS`：画面正中一张卡，说预览卡住了、卡在哪一步，带「重试」
                （只重新载入预览，不动视频）。门槛与步骤和产品里预览引擎的卡住诊断是同一套
                （packages/ui/src/components/editor/preview-watch.ts 的 STALL_MS 与 StallStep）。

   原型的状态来自「原型开关」（store `stageLoadDemo`）：`mode` 是挡位，`since` 是切到这一挡的时刻。
   「载入中」挡位按真实的门槛演：满 `STALL_MS` 自己变成卡在引擎；几个「卡住」挡位直接演卡住；
   「重试」切到 retrying，载入一小会儿后好了。 */
(function () {
  /** 卡在同一步这么久才说卡住（与产品里的诊断同一个门槛） */
  const STALL_MS = 10000;
  /** 载入这么久还没好才露出转圈（快的打开不闪） */
  const SPINNER_DELAY_MS = 500;
  /** 原型里「重试」之后演多久的载入 */
  const RETRY_DEMO_MS = 1500;

  const COPY = {
    zh: {
      loading: '正在载入预览',
      stalled: '预览卡住了',
      steps: {
        engine: () => '预览引擎还在载入',
        video: () => '还在准备这部视频',
        media: (name) => `在等媒体：${name}`,
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
      stalled: 'Preview is stuck',
      steps: {
        engine: () => 'Preview engine still loading',
        video: () => 'Still preparing this video',
        media: (name) => `Waiting for media: ${name}`,
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

  /** 原型开关的挡位：[mode, 标签]。stall-* 直接演卡在那一步。 */
  const DEMOS = [
    ['ready', '正常'],
    ['loading', '载入中'],
    ['stall-engine', '卡住 · 引擎'],
    ['stall-media', '卡住 · 媒体'],
    ['stall-captions', '卡住 · 字幕'],
  ];

  /** 切到某一挡时存进 store 的值；`now` 是毫秒时间戳 */
  function demo(mode, now) {
    return {mode, since: now};
  }

  /** 此刻的状态：{phase: 'ready' | 'loading' | 'stalled', step?, waitedMs} */
  function stateAt(d, now) {
    const mode = d && d.mode ? d.mode : 'ready';
    const waited = Math.max(0, now - (d && typeof d.since === 'number' ? d.since : now));
    if (mode === 'retrying') return waited < RETRY_DEMO_MS ? {phase: 'loading', waitedMs: waited} : {phase: 'ready', waitedMs: 0};
    if (mode === 'loading') return waited < STALL_MS ? {phase: 'loading', waitedMs: waited} : {phase: 'stalled', step: 'engine', waitedMs: waited};
    if (mode.startsWith('stall-')) return {phase: 'stalled', step: mode.slice('stall-'.length), waitedMs: STALL_MS + waited};
    return {phase: 'ready', waitedMs: 0};
  }

  /** 下一次状态会变的时刻离现在多久（毫秒）；不会再自己变就是 null。舞台按它排一次计时器。 */
  function waitMs(d, now) {
    const s = stateAt(d, now);
    if (s.phase === 'loading' && s.waitedMs < SPINNER_DELAY_MS) return SPINNER_DELAY_MS - s.waitedMs;
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
    if (s.phase === 'loading') return {kind: 'loading', label: c.loading, spinner: s.waitedMs >= SPINNER_DELAY_MS};
    const name = (names && names[s.step]) || (s.step === 'captions' ? c.captionsName : '—');
    const step = (c.steps[s.step] || c.steps.paint)(name);
    return {kind: 'stalled', step: s.step, title: c.stalled, detail: step, body: c.body(Math.floor(s.waitedMs / 1000)), retry: c.retry};
  }

  window.BC_STAGE_LOAD = {STALL_MS, SPINNER_DELAY_MS, RETRY_DEMO_MS, COPY, DEMOS, demo, stateAt, waitMs, notice};
})();
