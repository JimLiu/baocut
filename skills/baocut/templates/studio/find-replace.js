// BaoCut Subtitle Studio — 三个文本面板的查找与替换（纯函数，可单测）。
//
// 与原型 designs/baocut-mac/app/transcript-model.js 的 findTextRanges 同语义：
// 区间是 UTF-16 偏移（RegExp / String.slice 的口径，与 Swift 侧 NSString 一致），
// 非正则查询整体转义，全词匹配用非字母数字边界（\p{L}\p{N}）而不是 \b —— 后者
// 对中日韩文本没有意义。正则语法错误时返回空列表，不抛异常（用户还在打字）。
//
// 面板只负责渲染与调用写路径：collect 出的匹配列表同时喂给计数、导航、高亮
// 和替换，replacePlan 把匹配按条目折成"每条目一次整文本替换"，面板再逐条走
// 既有编辑 API（editParagraph / editCue / editTrans）。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_FIND = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULT_OPTS = { caseSens: false, word: false, regex: false };

  function buildRegExp(query, opts) {
    if (!query) return null;
    const o = Object.assign({}, DEFAULT_OPTS, opts || {});
    try {
      let src = o.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (o.word) src = '(?:^|[^\\p{L}\\p{N}])(' + src + ')(?=$|[^\\p{L}\\p{N}])';
      return new RegExp(src, 'g' + (o.caseSens ? '' : 'i') + 'u');
    } catch (e) {
      return null;   // 正则还没打完
    }
  }

  // text 里 query 的全部区间。全词模式下把边界字符排除在命中之外。
  function findTextRanges(text, query, opts) {
    const re = buildRegExp(query, opts);
    if (!re) return [];
    const o = Object.assign({}, DEFAULT_OPTS, opts || {});
    const body = String(text == null ? '' : text);
    const out = [];
    let m;
    while ((m = re.exec(body)) !== null) {
      const grouped = o.word && m[1] != null;
      const hit = grouped ? m[1] : m[0];
      const start = grouped ? m.index + m[0].indexOf(m[1]) : m.index;
      if (!hit.length) { re.lastIndex++; continue; }
      out.push({ start, end: start + hit.length });
    }
    return out;
  }

  // items = [{ key, text, ... }]（key 用于回写与高亮定位，其余字段原样带回）。
  // 结果按 items 顺序、条目内按偏移升序，index 是全局序号（导航用）。
  function collect(items, query, opts) {
    if (!query) return [];
    const out = [];
    (items || []).forEach((item) => {
      if (!item || item.key == null) return;
      findTextRanges(item.text, query, opts).forEach((r) => {
        out.push({ key: item.key, item, start: r.start, end: r.end, index: out.length });
      });
    });
    return out;
  }

  function groupByKey(matches) {
    const map = new Map();
    (matches || []).forEach((m) => {
      if (!map.has(m.key)) map.set(m.key, []);
      map.get(m.key).push(m);
    });
    return map;
  }

  // 当前匹配：idx 越界时收敛到末尾（列表缩短时不至于丢焦点）。
  function currentOf(matches, idx) {
    if (!matches || !matches.length) return null;
    return matches[Math.min(Math.max(0, idx | 0), matches.length - 1)];
  }

  // 环形前进/后退；空列表恒为 0。
  function cycle(idx, len, dir) {
    if (!len) return 0;
    const base = Math.min(Math.max(0, idx | 0), len - 1);
    return ((base + dir) % len + len) % len;
  }

  // 计数文案（原型 '3 / 12' / '0 results'）。空查询给空串：查找框还没输入时不显示计数。
  function countLabel(query, matches, idx) {
    if (!query) return '';
    if (!matches || !matches.length) return '无结果';
    return (Math.min(idx, matches.length - 1) + 1) + ' / ' + matches.length;
  }

  // 在一段文本里替换给定区间。区间按降序落笔，前面的偏移不受影响。
  function replaceRanges(text, ranges, replacement) {
    const body = String(text == null ? '' : text);
    const rep = replacement == null ? '' : String(replacement);
    const sorted = (ranges || []).slice()
      .filter((r) => r && r.end > r.start && r.start >= 0 && r.end <= body.length)
      .sort((a, b) => b.start - a.start);
    let next = body, changed = 0;
    let lastStart = Infinity;
    sorted.forEach((r) => {
      if (r.end > lastStart) return;   // 重叠区间只认后面那个
      next = next.slice(0, r.start) + rep + next.slice(r.end);
      lastStart = r.start;
      changed++;
    });
    return { text: next, changed };
  }

  // 把匹配折成每条目一次整文本替换：[{ item, key, text, changed }]。
  // 文本没变的条目不产出（既有写路径会自行忽略，但少发一次事务更干净）。
  function replacePlan(matches, replacement) {
    const out = [];
    groupByKey(matches).forEach((ms, key) => {
      const item = ms[0].item || {};
      const result = replaceRanges(item.text, ms, replacement);
      if (result.text === String(item.text == null ? '' : item.text)) return;
      out.push({ item, key, text: result.text, changed: result.changed });
    });
    return out;
  }

  return {
    DEFAULT_OPTS, buildRegExp, findTextRanges, collect, groupByKey,
    currentOf, cycle, countLabel, replaceRanges, replacePlan,
  };
});
