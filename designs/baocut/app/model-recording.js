/* 录制面板、控制条、智能体录制卡与恢复提示的纯规则：window.BC_REC（屏幕录制设计 docs/design/screen-recording §11、§13；
   product-design §3.2.1、§4.8、§5.9）。只在 App 入口加载——录制只在桌面端、Runtime 就在这台电脑上时才有入口。
   对照实现 packages/ui/src/model/recording.ts 与 recording-copy.zh-Hans.ts；「把 BaoCut 也录进去」、
   磁盘空间提醒与设置里的「开始录制」快捷键、缺省帧率、缺省倒计时是原型先行的部分，文案待与实现对齐。 */
(function () {
  /** 「把 BaoCut 也录进去」只对整块屏幕与区域有意义：录一个窗口时本来就只录那个窗口。 */
  const showsIncludeSelf = (source) => source === 'display' || source === 'area';
  const selfNote = (source, includeSelf) => (!showsIncludeSelf(source) ? '' : includeSelf
    ? 'BaoCut 的窗口也会出现在画面里，控制条除外。'
    : 'BaoCut 自己的窗口不会录进去。');

  /* ---------- 磁盘空间 ---------- */

  /** 大致的码率（字节 / 分钟）：按像素数与帧率估，屏幕内容大多是静止画面，比摄像机画面省得多。 */
  function bytesPerMinute(width, height, fps, withCamera) {
    const px = Math.max(1, width * height);
    const screen = px * (fps || 30) * 60 * 0.035;
    return Math.round(screen + (withCamera ? 45e6 : 0) + 6e6);
  }
  /** 还能录多少分钟（向下取整）。 */
  const minutesLeft = (freeBytes, perMinute) => Math.max(0, Math.floor(freeBytes / Math.max(1, perMinute)));
  const LOW_DISK_MINUTES = 10;
  const gb = (b) => (b / 1e9).toFixed(1).replace(/\.0$/, '') + ' GB';
  /** 面板上的磁盘一行：够用时只是一句说明，不足 LOW_DISK_MINUTES 分钟时是一条警告（仍能开始）。 */
  function diskLine(freeBytes, perMinute) {
    const left = minutesLeft(freeBytes, perMinute);
    if (left < LOW_DISK_MINUTES) {
      return {low: true, title: '磁盘空间不多了',
        text: `录到的文件存在这个项目所在的磁盘上，那里只剩 ${gb(freeBytes)}，按现在的设置大约能录 ${left} 分钟。空间用完时录制会自动停止并保存已经录下的部分。`};
    }
    return {low: false, text: `这块磁盘还剩 ${gb(freeBytes)}，大约能录 ${left > 120 ? '2 小时以上' : left + ' 分钟'}。`};
  }

  /* ---------- 智能体的录制卡（§13） ---------- */

  /** 录制卡的状态 → 一行说明与按钮。`waiting` 时可以打开预先填好的录制面板；放进视频后能打开视频。 */
  function cardLine(state, extra) {
    const x = extra || {};
    switch (state) {
      case 'waiting': return {text: '等你开始录制', action: 'panel', actionLabel: '打开录制面板'};
      case 'countdown': return {text: `${x.left || 3} 秒后开始…`};
      case 'recording': return {text: '正在录制 · ' + clock(x.elapsed || 0), live: true};
      case 'paused': return {text: '已暂停 · ' + clock(x.elapsed || 0)};
      case 'finishing': return {text: '正在收尾…'};
      case 'done': return {text: `已放进视频 · ${clock(x.elapsed || 0)}`, action: 'video', actionLabel: '打开视频', tone: 'positive'};
      case 'cancelled': return {text: '已取消录制。', tone: 'neutral'};
      case 'discarded': return {text: '录制已丢弃', tone: 'neutral'};
      case 'failed': return {text: x.error || '录制没有完成。', tone: 'negative'};
      default: return {text: ''};
    }
  }
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;

  /* ---------- 没有收完的录制（§11 恢复） ---------- */

  /** 启动页顶上的恢复提示：只讲最新的一次，其余几次合成一句。 */
  function recoveryText(list) {
    const items = (list || []).slice().sort((a, b) => (a.ago || 0) - (b.ago || 0));
    if (!items.length) return null;
    const r = items[0];
    return {
      id: r.id,
      title: '有一次没有收完的录制',
      body: `${r.date}的录制（${clock(r.duration)}）在放进视频之前中断了。可以恢复，或者删掉录下的文件。`,
      more: items.length > 1 ? `还有 ${items.length - 1} 次没有收完的录制` : '',
    };
  }

  /* ---------- 设置 › 通用 › 屏幕录制 ---------- */

  const SETTINGS_DEFAULTS = {
    shortcuts: {start: '⌥⇧⌘R', stop: '⌥⇧⌘S', pause: '⌥⇧⌘P'},
    fps: '30', countdown: '3', hideWindow: true,
  };
  const SHORTCUT_ROWS = [
    {k: 'start', label: '开始录制', desc: '用上一次的设置直接开始，不打开录制面板。'},
    {k: 'stop', label: '停止录制'},
    {k: 'pause', label: '暂停与继续'},
  ];
  const FPS = [{id: '30', label: '30 fps'}, {id: '60', label: '60 fps'}];

  /* ---------- 原型的「录好的一段」 ---------- */

  /**
   * 原型不真的录：停止时按面板里的选择，从示例录制裁出一段 `seconds` 秒长的录制（第 n 次，id 与文件名都带 n）。
   * 光标选「录进画面」/「不要光标」时取景文档里不带光标设置，检查器的光标组置灰；没开摄像头、麦克风、系统声音就少那几路。
   * 返回 {rec, sources}：sources 是要加进素材库的视频 / 音频文件（同示例的渐变示意）。
   */
  function takeFrom(demo, n, opts, demoSources) {
    const o = opts || {};
    const len = Math.max(8, Math.min(demo.duration, Math.round(o.seconds || 24)));
    const tag = 'take' + n;
    const s = demo.streams;
    const streams = {screen: Object.assign({}, s.screen, {asset: `screen-${tag}.mp4`})};
    if (o.camera && o.camera !== 'none') streams.camera = Object.assign({}, s.camera, {asset: `camera-${tag}.mp4`});
    if (o.mic && o.mic !== 'none') streams.microphone = {asset: `microphone-${tag}.m4a`};
    if (o.system) streams.system = {asset: `system-audio-${tag}.m4a`};
    const pointer = o.cursor || 'separate';
    const inside = (t) => t < len;
    const rec = {
      id: 'rec-' + tag, view: 'sv-' + tag, link: 'lg-' + tag, duration: len, date: '刚刚', pointer, streams,
      clicks: pointer === 'none' ? [] : demo.clicks.filter((c) => inside(c.t)),
      zooms: pointer === 'none' ? [] : demo.zooms.filter((z) => z.origin === 'auto' && z.t1 <= len).map((z) => ({id: z.id, t0: z.t0, t1: z.t1, scale: 2, focus: {kind: 'pointer'}, origin: 'auto'})),
      follow: demo.follow,
      cursor: pointer === 'separate' ? demo.cursor : null,
    };
    const src = demoSources || {video: [], audio: []};
    const copy = (list, i, asset, id) => (list[i] ? Object.assign({}, list[i], {id, name: asset, dur: len}) : null);
    const sources = {
      video: [copy(src.video, 0, streams.screen.asset, 'rv-' + tag + '-s'), streams.camera && copy(src.video, 1, streams.camera.asset, 'rv-' + tag + '-c')].filter(Boolean),
      audio: [streams.microphone && copy(src.audio, 0, streams.microphone.asset, 'ra-' + tag + '-m'), streams.system && copy(src.audio, 1, streams.system.asset, 'ra-' + tag + '-s')].filter(Boolean),
    };
    return {rec, sources};
  }

  window.BC_REC = {
    showsIncludeSelf, selfNote, bytesPerMinute, minutesLeft, LOW_DISK_MINUTES, diskLine,
    cardLine, clock, recoveryText, SETTINGS_DEFAULTS, SHORTCUT_ROWS, FPS, takeFrom,
  };
})();
