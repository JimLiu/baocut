/* BaoCut 原型 — 导出的响度标准化（剧情短片 §5.3 / §8，2026-09-24）
   window.BC_LOUD。纯函数，无 React、无 DOM。

   导出弹层的视频页与音频页各有一个「响度标准化」开关，**缺省关**：关着就按项目里的混音
   原样导出；打开后整片混音统一到目标响度（缺省 −16 LUFS），真峰值不超过上限（缺省 −1.2 dBTP），
   两个数都可改。对应内核 `bcut export --loudness <LUFS> --true-peak <dBTP>`，只对
   mp4 / wav / mp3 / m4a 生效。

   响度要整片量一遍，所以开着时视频页不走光速修正（只重渲改过的区间那条路）——
   App 的说明句写这一点；Web 没有光速修正，说明句不提它。 */
(function () {
  const DEFAULT = {on: false, lufs: -16, truePeak: -1.2};
  /* 常用档：流媒体 −14、播客 / 短视频 −16、−19、广播 EBU R128 −23、ATSC A/85 −24 */
  const LUFS_CHOICES = [-14, -16, -19, -23, -24];
  const TRUE_PEAK_CHOICES = [-1, -1.2, -1.5, -2];
  const LUFS_RANGE = [-70, 0];
  const TRUE_PEAK_RANGE = [-20, 0];

  /** 排版减号（U+2212），一位小数只在需要时出现：−16、−1.2。 */
  function fmtDb(v) {
    const n = Math.round(Number(v) * 10) / 10;
    const s = String(Math.abs(n));
    return (n < 0 ? '−' : '') + s;
  }
  /** 下拉里的档：当前值不在常用档里时补进去（按从大到小排）。 */
  function choices(list, v) {
    const out = list.slice();
    if (v != null && out.indexOf(v) < 0) out.push(v);
    return out.sort((a, b) => b - a);
  }
  /** 值夹进内核接受的范围。 */
  const clamp = (v, range) => Math.max(range[0], Math.min(range[1], Number(v)));

  /** 导出参数：关着给空对象（不带任何响度参数），开着带 `loudness` / `truePeak`。 */
  function options(l) {
    if (!l || !l.on) return {};
    return {loudness: clamp(l.lufs, LUFS_RANGE), truePeak: clamp(l.truePeak, TRUE_PEAK_RANGE)};
  }

  /** 开关下面那一句。`flashFix`：这个表面有没有光速修正（App 有，Web 没有）。 */
  function note(l, flashFix) {
    if (!l || !l.on) return '关：按视频里的混音原样导出。';
    const head = '整片混音统一到 ' + fmtDb(l.lufs) + ' LUFS，真峰值不超过 ' + fmtDb(l.truePeak) + ' dBTP';
    return head + (flashFix ? '；要整片量一遍，开着时不走光速修正。' : '。');
  }

  /** 这次导出能不能走光速修正：开着响度就不能。 */
  const allowsFlash = (l) => !(l && l.on);

  Object.assign(window, {BC_LOUD: {DEFAULT, LUFS_CHOICES, TRUE_PEAK_CHOICES, LUFS_RANGE, TRUE_PEAK_RANGE,
    fmtDb, choices, clamp, options, note, allowsFlash}});
})();
