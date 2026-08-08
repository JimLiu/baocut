/**
 * caret-offset.js —— 归一化文本偏移与原始文本偏移之间的双向映射。
 *
 * 编辑器提交的文本一律是 `raw.replace(/\s+/g, ' ').trim()`（归一化空白），
 * 所以光标偏移也必须用同一把尺子：`vkCaretOffset()` 读出的 offset 落在归一化
 * 空间里，而把光标放回 DOM 时需要反向换算回 contenteditable 的原始文本偏移。
 *
 * 两个方向必须互为逆运算（emoji / CJK / 连续空白都不能错位），所以正向算法只在
 * 这里实现一次，util.jsx 的 vkCaretOffset 与 panes.jsx 的落点逆映射共用本模块。
 *
 * 偏移单位是 JS 字符串的 UTF-16 code unit（与 String.length 一致）；逆映射会跳过
 * 代理对中间的非法落点。纯函数，无 DOM 依赖，可直接 node 单测。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BCS_CARET = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const isWs = (ch) => /\s/.test(ch);

  /** 归一化：折叠空白并去掉首尾——与各处提交文本的规则完全一致。 */
  const normalize = (raw) => String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();

  const leadLen = (raw) => (String(raw).match(/^\s*/) || [''])[0].length;

  /**
   * 原始偏移 → 归一化偏移。
   * 返回 { text, offset }；offset 被截断到 text.length（落在尾部空白里的光标算行尾）。
   */
  function toNormalized(raw, rawOff) {
    const s = String(raw == null ? '' : raw);
    const text = normalize(s);
    const end = Math.max(0, Math.min(s.length, rawOff | 0));
    const lead = leadLen(s);
    let n = 0;
    let prevWs = false;
    for (let j = Math.min(lead, end); j < end; j += 1) {
      if (isWs(s[j])) {
        if (!prevWs) n += 1;
        prevWs = true;
      } else {
        n += 1;
        prevWs = false;
      }
    }
    return { text, offset: Math.min(text.length, n) };
  }

  /**
   * 归一化偏移 → 原始偏移：取满足 toNormalized(raw, i).offset >= offset 的最小 i。
   * offset(i) 单调不减，所以一次线性扫描即可；落在代理对中间时前进到整字符边界。
   */
  function toRaw(raw, offset) {
    const s = String(raw == null ? '' : raw);
    const text = normalize(s);
    const want = Math.max(0, Math.min(text.length, offset | 0));
    if (want === 0) return Math.min(leadLen(s), s.length);
    const lead = leadLen(s);
    let n = 0;
    let prevWs = false;
    let i = lead;
    for (; i < s.length; i += 1) {
      if (isWs(s[i])) {
        if (!prevWs) n += 1;
        prevWs = true;
      } else {
        n += 1;
        prevWs = false;
      }
      if (n >= want) { i += 1; break; }
    }
    i = Math.min(i, s.length);
    // 不要停在代理对中间。
    while (i > 0 && i < s.length
      && s.charCodeAt(i - 1) >= 0xd800 && s.charCodeAt(i - 1) <= 0xdbff
      && s.charCodeAt(i) >= 0xdc00 && s.charCodeAt(i) <= 0xdfff) i += 1;
    return i;
  }

  return { normalize, leadLen, toNormalized, toRaw };
}));
