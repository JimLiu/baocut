/* BaoCut 原型 — 时间与时间码
   window.BC_TIME。纯函数，无 React、无 DOM。

   统一时间编辑器的解析口径（§18 / 第 20.1 轮定案）：
     mm:ss.d · hh:mm:ss.d · 裸秒 三种都收；满一小时进位；非法输入回退原值。
   App v2 的 adapters/time_field.rs 是同一份语义（那边此前 timecode() 无小时进位，
   是登记在案的缺口，见 product-design.md §19 #25）。 */
(function () {
  const pad = (n, w) => String(Math.floor(n)).padStart(w || 2, '0');

  /** 03:26.4 / 1:02:03.5 —— 满一小时进位，一位小数 */
  function timecode(t, opts) {
    const o = opts || {};
    const neg = t < 0;
    const dec = o.decimals === 0 ? 0 : 1;
    /* **先按输出精度量化，再拆时/分/秒**（第 88 轮修）。反过来的话补零判据看的是
       **未取整**的值、位数却来自取整之后的字符串：9.999999 会写成 `00:010.0`
       （判据说「不到 10，补个 0」，而 `toFixed(1)` 已经进位成 "10.0"），59.99 会写成
       `00:60.0` 而不进位到分。这两个数不是构造出来的——**任何一段时长都是两个浮点秒
       相减**，`22.4 − 12.4` 就是 9.999999999999998，属性页上每一条元素的时长都过这里。 */
    let s = Math.abs(+t || 0);
    s = dec ? Math.round(s * 10) / 10 : Math.round(s);
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60);   s -= m * 60;
    const sec = dec ? s.toFixed(1) : String(s);
    const secPad = (s < 10 ? '0' : '') + sec;
    const body = h > 0 ? `${h}:${pad(m)}:${secPad}` : `${pad(m)}:${secPad}`;
    return (neg ? '-' : '') + body;
  }

  /** 12 clips · 3 分 26 秒 这类元数据用的粗粒度时长 */
  function duration(t) {
    const s = Math.max(0, Math.round(+t || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h) return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
    if (m) return sec ? `${m} 分 ${sec} 秒` : `${m} 分`;
    return `${sec} 秒`;
  }

  /**
   * 解析用户输入的时间。收 `mm:ss.d` / `hh:mm:ss.d` / 裸秒；
   * 非法返回 null（调用方回退原值，不静默改成 0）。
   */
  function parse(text) {
    if (text == null) return null;
    const raw = String(text).trim();
    if (!raw) return null;
    if (!/^-?[0-9:.]+$/.test(raw)) return null;
    const neg = raw[0] === '-';
    const body = neg ? raw.slice(1) : raw;
    const parts = body.split(':');
    if (parts.length > 3) return null;
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p === '' || !/^[0-9]*\.?[0-9]*$/.test(p) || p === '.') return null;
      const v = parseFloat(p);
      if (!isFinite(v)) return null;
      // 只有最后一段允许小数；中间段是整数
      if (i < parts.length - 1 && p.indexOf('.') >= 0) return null;
      if (parts.length > 1 && i > 0 && v >= 60) return null;
      total = total * 60 + v;
    }
    return neg ? -total : total;
  }

  /** 钳在 [0, max]，并对齐到一位小数——时间轴上所有写入都过这一层 */
  function clamp(t, max) {
    const v = Math.min(Math.max(+t || 0, 0), max);
    return Math.round(v * 10) / 10;
  }

  window.BC_TIME = {timecode, duration, parse, clamp};
})();
