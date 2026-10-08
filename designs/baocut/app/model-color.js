/* 取色面板的纯层 —— §18（第 81 轮）。
   ============================================================================
   在这一轮之前，取色面板是**一张取色面板的画**：SV 方块的色相在 CSS 里写死成 220，
   两枚圆钮钉在 78%/16% 与 60%/50%，Hex 那一格是只读 chip，`100%` 是一个静态的字。
   于是「改颜色」只有一条路——从下面 32 格里挑一格；调出一个目录里没有的颜色，
   面板上任何一处都不会动。

   这一份负责**换算**，不碰 DOM：hex ↔ HSV ↔ RGB/HSL 文本、alpha 拆合、输入解析。
   token（`var(--gray-1000)`）解析成 hex 是视图的事——那要读 CSS 变量，纯层碰不到。

   约定：
     · hex 一律小写六位 `#rrggbb`；带透明度时是八位 `#rrggbbaa`。
     · HSV 的 `h` 是 0–360（360 归一到 0），`s` / `v` 是 0–1。
     · 解析失败一律返回 `null`——调用方据此**不写状态**、把输入弹回上一次合法值
       （与 `ValueRow` / `TimeField` 同一条：敲的时候不夹，失焦或回车才解析）。
   ============================================================================ */
(function () {
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const hex2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

  /** 归一成 `#rrggbb`：吃 `#abc` / `abc` / `#RRGGBB` / 前后空格；八位截掉 alpha。 */
  function normHex(text) {
    const t = String(text == null ? '' : text).trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(t)) {
      return '#' + t.toLowerCase().split('').map((c) => c + c).join('');
    }
    if (/^[0-9a-fA-F]{6}$/.test(t) || /^[0-9a-fA-F]{8}$/.test(t)) {
      return '#' + t.slice(0, 6).toLowerCase();
    }
    return null;
  }

  /** 八位 hex 的 alpha，0–100 的整数；不带 alpha 的一律 100。 */
  function alphaOf(text) {
    const t = String(text == null ? '' : text).trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]{8}$/.test(t)) return 100;
    return Math.round((parseInt(t.slice(6), 16) / 255) * 100);
  }

  /** 把 alpha（0–100）合进 hex。100 写六位——没改过透明度的值逐字节不变。 */
  function withAlpha(hex, alpha) {
    const base = normHex(hex);
    if (!base) return null;
    const a = clamp(Math.round(alpha), 0, 100);
    return a >= 100 ? base : base + hex2((a / 100) * 255);
  }

  function toRgb(hex) {
    const h = normHex(hex);
    if (!h) return null;
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    };
  }

  function fromRgb(rgb) {
    return '#' + hex2(rgb.r) + hex2(rgb.g) + hex2(rgb.b);
  }

  /** hex → HSV。灰阶（max === min）的色相无定义，返回 0；调用方要保色相自己留着。 */
  function toHsv(hex) {
    const rgb = toRgb(hex);
    if (!rgb) return null;
    const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return {h: h % 360, s: max ? d / max : 0, v: max};
  }

  /** HSV → hex。 */
  function fromHsv(hsv) {
    const h = ((hsv.h % 360) + 360) % 360;
    const s = clamp(hsv.s, 0, 1), v = clamp(hsv.v, 0, 1);
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    const seg = Math.floor(h / 60) % 6;
    const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
    return fromRgb({r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255});
  }

  /** hex → HSL（只为 `HSL` 那档的读数，内部换算一律走 HSV）。 */
  function toHsl(hex) {
    const rgb = toRgb(hex);
    if (!rgb) return null;
    const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;
    let h = 0;
    if (d) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    return {h: Math.round(h % 360), s: Math.round(s * 100), l: Math.round(l * 100)};
  }

  /** 三档读数（`Hex` / `RGB` / `HSL`）。数值一律取整——面板里那一格是给人读的。 */
  const MODES = ['Hex', 'RGB', 'HSL'];
  function format(hex, mode) {
    const h = normHex(hex);
    if (!h) return '';
    if (mode === 'RGB') {
      const c = toRgb(h);
      return c.r + ', ' + c.g + ', ' + c.b;
    }
    if (mode === 'HSL') {
      const c = toHsl(h);
      return c.h + ', ' + c.s + '%, ' + c.l + '%';
    }
    return h;
  }

  /** 三档输入解析。`RGB` / `HSL` 吃 `45, 142, 255` 与 `rgb(45 142 255)` 两种写法；
      任何一档解析不出来都返回 `null`（调用方弹回上一次合法值，不写状态）。 */
  function parseAny(text, mode) {
    const raw = String(text == null ? '' : text).trim();
    if (mode !== 'RGB' && mode !== 'HSL') return normHex(raw);
    const nums = raw.replace(/^[a-zA-Z]+\(|\)$/g, '').split(/[\s,/]+/)
      .filter((part) => part !== '')
      .map((part) => parseFloat(part.replace('%', '')));
    if (nums.length < 3 || nums.some((n) => !isFinite(n))) return null;
    if (mode === 'RGB') {
      if (nums.slice(0, 3).some((n) => n < 0 || n > 255)) return null;
      return fromRgb({r: nums[0], g: nums[1], b: nums[2]});
    }
    const [h, s, l] = nums;
    if (s < 0 || s > 100 || l < 0 || l > 100) return null;
    // HSL → HSV：同一个颜色的两种坐标，换算是闭式的，不经 RGB 往返。
    const v = (l / 100) + (s / 100) * Math.min(l / 100, 1 - l / 100);
    return fromHsv({h: h, s: v ? 2 * (1 - (l / 100) / v) : 0, v: v});
  }

  /** SV 方块的背景：左白右纯色相、上透明下黑，与 `fromHsv` 是同一套坐标。 */
  function svBackground(h) {
    return 'linear-gradient(to top, #000, transparent), '
      + 'linear-gradient(to right, #fff, ' + fromHsv({h: h, s: 1, v: 1}) + ')';
  }

  window.BC_COLOR = {
    MODES, normHex, alphaOf, withAlpha, toRgb, fromRgb, toHsv, fromHsv, toHsl,
    format, parseAny, svBackground,
  };
})();
