/* BaoCut 原型 — 查找与替换
   window.BC_FIND。纯函数，无 React、无 DOM。

   **三个 Tab 共用一个匹配器。** 文稿、字幕、翻译各有各的文本结构（段落 / cue /
   对齐卡），但「Aa、全词、正则」这三个开关的语义必须只有一份实现——
   designs/baocut-mac 把它收在 `VK_MODEL.findTextRanges` 里正是这个理由：
   三处各写一遍，迟早会漂成三种不同的「全词」。

   区间一律是 **UTF-16 偏移**（RegExp / String.slice 的口径），与 Swift 的
   NSString range、Rust 侧的 char 边界换算在同一个坐标系里对得上。

   两条与 baocut-mac 不同的地方（登记在 README 分歧台账 #15）：
     1. 正则语法错误**报出来**，不是静默返回 0 条——「0 results」和「你这条正则写错了」
        是两件事，混成一件用户会一直改关键词。
     2. 替换文本按字面插入，不解析 `$1`。这条与 Mac 一致，但原型把它写进了 UI 提示，
        因为开了正则的人默认会以为反向引用可用。 */
(function () {
  const RE_ESCAPE = /[.*+?^${}()|[\]\\]/g;
  /* 词边界用 Unicode 属性类，不用 \b——\b 认的是 [A-Za-z0-9_]，
     对中文「全词」会在每个字之间都判成边界，等于这个开关没开。 */
  const NOT_WORD = '[^\\p{L}\\p{N}]';

  /** 编译一次，给出可诊断的结果：{re} 或 {error}。查询为空时两者皆无。 */
  function compile(query, opts) {
    const o = opts || {};
    if (!query) return {};
    let src = o.regex ? query : String(query).replace(RE_ESCAPE, '\\$&');
    if (o.word) src = '(?:^|' + NOT_WORD + ')(' + src + ')(?=$|' + NOT_WORD + ')';
    try {
      return {re: new RegExp(src, 'g' + (o.case ? '' : 'i') + 'u')};
    } catch (e) {
      return {error: String(e.message || e)};
    }
  }

  /** 一段文本里的全部匹配区间。opts: {case, word, regex} */
  function ranges(text, query, opts) {
    const {re} = compile(query, opts);
    if (!re) return [];
    const s = String(text == null ? '' : text);
    const out = [];
    let m;
    while ((m = re.exec(s)) !== null) {
      // 全词模式把命中包在第 1 组里（外面那圈是边界，不算命中）
      const grouped = (opts || {}).word && m[1] != null;
      const hit = grouped ? m[1] : m[0];
      const start = grouped ? m.index + m[0].indexOf(m[1]) : m.index;
      if (!hit.length) { re.lastIndex++; continue; }   // 零宽匹配否则原地打转
      out.push({start, end: start + hit.length});
      if (re.lastIndex <= start) re.lastIndex = start + hit.length;
    }
    return out;
  }

  /** 把若干条文本铺成一张有序匹配表。
      items: [{key, text, ...}]——key 之外的字段原样带进每条匹配，
      调用方用它区分「这条命中在哪张卡的哪一侧」。 */
  function collect(items, query, opts) {
    const out = [];
    (items || []).forEach((it) => {
      const carry = Object.assign({}, it);
      delete carry.text;                        // 命中只带定位信息，正文由视图层现取
      ranges(it.text, query, opts).forEach((r) => {
        out.push(Object.assign({}, carry, {start: r.start, end: r.end}));
      });
    });
    return out.map((m, index) => Object.assign(m, {index}));
  }

  /** 按 key 分组，视图层拿它给每段文本上高亮。 */
  function byKey(matches) {
    const map = new Map();
    (matches || []).forEach((m) => {
      if (!map.has(m.key)) map.set(m.key, []);
      map.get(m.key).push(m);
    });
    return map;
  }

  /** 在一段文本里落下若干替换。**从后往前改**，前面的区间才不会被挪位。
      返回 {text, changed}——changed 只数真正改动的（替换成原样不算）。 */
  function replaceIn(text, matches, replacement) {
    let next = String(text == null ? '' : text);
    const rep = String(replacement == null ? '' : replacement);
    let changed = 0;
    (matches || []).slice().sort((a, b) => b.start - a.start).forEach((m) => {
      if (m.start < 0 || m.end < m.start || m.end > next.length) return;
      if (next.slice(m.start, m.end) !== rep) changed++;
      next = next.slice(0, m.start) + rep + next.slice(m.end);
    });
    return {text: next, changed};
  }

  /** 上一个 / 下一个：到头绕回去。空表时停在 0。 */
  function step(idx, len, dir) {
    if (!len) return 0;
    const at = Math.min(Math.max(0, idx), len - 1);
    return ((at + dir) % len + len) % len;
  }

  /** 当前命中。idx 越界（替换后表变短）时夹回最后一条。 */
  function current(matches, idx) {
    if (!matches || !matches.length) return null;
    return matches[Math.min(Math.max(0, idx), matches.length - 1)];
  }

  /** 计数文案。0 条与「正则写错了」是两种状态，不合并。 */
  function countLabel(matches, query, error) {
    if (error) return '正则无效';
    if (!query) return '';
    if (!matches.length) return '无结果';
    return matches.length + ' 条';
  }

  window.BC_FIND = {compile, ranges, collect, byKey, replaceIn, step, current, countLabel};
})();
