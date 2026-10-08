/* BaoCut 原型 — Agent 回复的逐字显示与 Markdown 分块（纯层）
   window.BC_AGENT_STREAM。无 React、无 DOM，node --test 直接 require。

   回复的文字是一坨一坨到达的（CLI 的输出按 60ms 左右的窗口合并后才送过来），
   界面不按到达的节奏跳，而是匀速往外放：每一帧放出的字符数与积压成正比，
   积压多就追得快，积压少就慢慢走。全文留在 store，视图只渲染已放出的那一截。

   - `revealStep`：这一帧该多放几个字符
   - `safeCut` / `advanceCut`：切点落在字素簇边界上，不把一个字切成两半
   - `splitBlocks`：按 Markdown 块拆开，流式时只有最后一块在变
   - `closeStreamingTail`：最后一块里没写完的标记先补齐，渲染时不闪出星号与反引号
   - `chunkArrivals`：原型用来模拟分块到达的切法（真产品里由 CLI 的输出决定） */
(function () {
  /** 这一帧放出几个字符：与积压成正比，下限 1、上限 backlog；elapsed 先夹到 250ms，≥ horizon 时全部放出。 */
  function revealStep(o) {
    const backlog = Math.max(0, Math.floor((o && o.backlog) || 0));
    if (!backlog) return 0;
    const horizon = o.horizonMs > 0 ? o.horizonMs : 150;
    const elapsed = Math.min(250, Math.max(0, Number(o.elapsedMs) || 0));
    if (elapsed >= horizon) return backlog;
    return Math.min(backlog, Math.max(1, Math.ceil(backlog * elapsed / horizon)));
  }

  /* Intl.Segmenter 每次调用都现查：测试会临时拿掉它，缓存要跟着构造器走。 */
  let segCache = null;
  function segmenter() {
    const Seg = typeof Intl !== 'undefined' ? Intl.Segmenter : undefined;
    if (typeof Seg !== 'function') return null;
    if (!segCache || segCache.ctor !== Seg) segCache = {ctor: Seg, seg: new Seg(undefined, {granularity: 'grapheme'})};
    return segCache.seg;
  }

  /** 把切点拉回到它所在字素簇的起点；没有 Intl.Segmenter 时原样返回。 */
  function safeCut(text, index) {
    const s = String(text || '');
    const i = Math.max(0, Math.min(s.length, Math.floor(index) || 0));
    if (i === 0 || i === s.length) return i;
    const seg = segmenter();
    if (!seg) return i;
    const hit = seg.segment(s).containing(i);
    return hit ? hit.index : i;
  }

  /** 从 `from` 往后放 `step` 个字符，保证至少前进一个完整的字素簇（safeCut 可能把切点拉回原地）。 */
  function advanceCut(text, from, step) {
    const s = String(text || '');
    const start = Math.max(0, Math.min(s.length, from || 0));
    if (start >= s.length) return s.length;
    const target = Math.min(s.length, start + Math.max(1, Math.floor(step) || 1));
    const cut = safeCut(s, target);
    if (cut > start) return cut;
    const seg = segmenter();
    const hit = seg ? seg.segment(s).containing(start) : null;
    return hit ? Math.min(s.length, hit.index + hit.segment.length) : target;
  }

  /* ---------- 围栏代码块 ---------- */
  const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})([^`]*)$/;
  const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
  function fenceOpen(line) {
    const m = FENCE_OPEN.exec(line);
    if (!m) return null;
    if (m[1][0] === '`' && m[2].indexOf('`') >= 0) return null;
    return {ch: m[1][0], len: m[1].length};
  }
  function fenceCloses(line, open) {
    const m = FENCE_CLOSE.exec(line);
    return !!m && m[1][0] === open.ch && m[1].length >= open.len;
  }

  const LIST_ITEM = /^ {0,3}([*+-]|\d{1,9}[.)])(\s+|$)/;
  const blank = (line) => /^[ \t]*$/.test(line);

  /** 按 Markdown 块拆开（空行分隔）；围栏代码块里、列表内部的空行不拆。块尾的空行不算进块里。 */
  function splitBlocks(markdown) {
    const lines = String(markdown || '').split('\n');
    const blocks = [];
    let cur = [];
    let fence = null;
    const flush = () => {
      while (cur.length && blank(cur[cur.length - 1])) cur.pop();
      if (cur.length) blocks.push(cur.join('\n'));
      cur = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (fence) {
        cur.push(line);
        if (fenceCloses(line, fence)) fence = null;
        continue;
      }
      if (blank(line)) {
        if (!cur.length) continue;
        let j = i + 1;
        while (j < lines.length && blank(lines[j])) j++;
        const next = j < lines.length ? lines[j] : null;
        const inList = LIST_ITEM.test(cur[0]);
        // 列表里的空行：下一行还是列表项或缩进的续行，就留在同一块；后面还没到的先挂着
        if (inList && (next === null || LIST_ITEM.test(next) || /^[ \t]{2,}\S/.test(next))) { cur.push(line); continue; }
        if (next === null) { cur.push(line); continue; }
        flush();
        continue;
      }
      const open = fenceOpen(line);
      if (open) {
        // 围栏能打断段落：前面的段落自成一块
        if (cur.length && !LIST_ITEM.test(cur[0])) flush();
        fence = open;
      }
      cur.push(line);
    }
    flush();
    return blocks;
  }

  /* ---------- 流式尾部补全 ---------- */
  /** 行内代码的区间（[start, end)，end 含收尾反引号）；最后一个没闭合的单独返回。 */
  function codeSpans(s) {
    const spans = [];
    let open = null;
    for (let i = 0; i < s.length;) {
      if (s[i] === '\\' && open === null) { i += 2; continue; }
      if (s[i] !== '`') { i++; continue; }
      let j = i;
      while (j < s.length && s[j] === '`') j++;
      const len = j - i;
      if (open === null) open = {start: i, len};
      else if (open.len === len) { spans.push([open.start, j]); open = null; }
      i = j;
    }
    return {spans, open};
  }
  const inSpans = (spans, i) => spans.some(([a, b]) => i >= a && i < b);

  function fixLinks(s) {
    let {spans, open} = codeSpans(s);
    const masked = (i) => inSpans(spans, i) || (open && i >= open.start);
    // 没写完的图片整个藏起来
    for (let i = s.lastIndexOf('!['); i >= 0; i = i > 0 ? s.lastIndexOf('![', i - 1) : -1) {
      if (masked(i)) continue;
      if (!/^!\[[^\]]*\]\([^)]*\)/.test(s.slice(i))) return fixLinks(s.slice(0, i));
      break;
    }
    // 没写完的链接只露出文字
    for (let i = s.lastIndexOf('['); i >= 0; i = i > 0 ? s.lastIndexOf('[', i - 1) : -1) {
      if (masked(i) || s[i - 1] === '\\') continue;
      const rest = s.slice(i);
      const m = /^\[([^\]]*)$/.exec(rest) || /^\[([^\]]*)\]$/.exec(rest) || /^\[([^\]]*)\]\([^)]*$/.exec(rest);
      return m ? s.slice(0, i) + m[1] : s;
    }
    return s;
  }

  /** 强调标记的配对栈：返回还没闭合的开标记（按出现顺序）。行首的列表符号、两边都是空白的星号不算。 */
  function openMarkers(s, spans) {
    const stack = [];
    let lineStart = 0;
    for (let i = 0; i < s.length;) {
      const c = s[i];
      if (c === '\n') { lineStart = i + 1; i++; continue; }
      if (c === '\\') { i += 2; continue; }
      if ((c !== '*' && c !== '~') || inSpans(spans, i)) { i++; continue; }
      let j = i;
      while (j < s.length && s[j] === c) j++;
      let len = j - i;
      const prev = i > 0 ? s[i - 1] : '';
      const next = j < s.length ? s[j] : '';
      const prevSpace = !prev || /\s/.test(prev);
      const nextSpace = !next || /\s/.test(next);
      const listMark = c === '*' && len === 1 && /^[ \t]*$/.test(s.slice(lineStart, i)) && next === ' ';
      if (listMark || (prevSpace && nextSpace)) { i = j; continue; }
      if (c === '~') {
        if (len >= 2) {
          const top = stack[stack.length - 1];
          if (top && top.mark === '~~' && !prevSpace) stack.pop();
          else if (!nextSpace) stack.push({mark: '~~', at: i});
        }
        i = j; continue;
      }
      // 先当收尾：从栈顶往下配
      while (len > 0 && !prevSpace) {
        const top = stack[stack.length - 1];
        if (!top || top.mark[0] !== '*' || top.mark.length > len) break;
        stack.pop(); len -= top.mark.length;
      }
      // 剩下的当开头
      if (len > 0 && !nextSpace) {
        if (len >= 2) { stack.push({mark: '**', at: i}); len -= 2; }
        if (len >= 1) stack.push({mark: '*', at: i});
      }
      i = j;
    }
    return stack;
  }

  /** 流式中最后一块的补全（只动最后一段；在没闭合的围栏里什么都不做）。 */
  function closeStreamingTail(markdown) {
    const md = String(markdown || '');
    const lines = md.split('\n');
    let fence = null;
    let tailStart = 0;
    let pos = 0;
    for (const line of lines) {
      const end = pos + line.length + 1;
      if (fence) { if (fenceCloses(line, fence)) { fence = null; tailStart = end; } }
      else if (blank(line)) tailStart = end;
      else { const open = fenceOpen(line); if (open) fence = open; }
      pos = end;
    }
    if (fence) return md;
    tailStart = Math.min(tailStart, md.length);
    const head = md.slice(0, tailStart);
    let tail = md.slice(tailStart);
    if (!tail) return md;

    tail = fixLinks(tail);
    // 末尾孤零零的标记直接去掉（`_` 只在它前面是空白时）；写完一半的收尾标记也先去掉，下面统一补
    const strip = (s) => s.replace(/[*~]+$/, '').replace(/(^|\s)_+$/, '$1');
    let code = codeSpans(tail);
    if (code.open && code.open.start + code.open.len === tail.length) {
      // 只来了开头的反引号：先不显示
      tail = strip(tail.slice(0, code.open.start));
      code = codeSpans(tail);
    } else if (!code.open) {
      tail = strip(tail);
      code = codeSpans(tail);
    }
    let closers = '';
    let scan = tail;
    if (code.open) {
      // 行内代码里的星号不算强调；先闭合代码，再闭合外面的强调
      closers += '`'.repeat(code.open.len);
      scan = tail.slice(0, code.open.start);
    }
    const markers = openMarkers(scan, code.spans);
    for (let k = markers.length - 1; k >= 0; k--) closers += markers[k].mark;
    if (!closers) return head + tail;
    const trail = /\s*$/.exec(tail)[0];
    return head + tail.slice(0, tail.length - trail.length) + closers + trail;
  }

  /** 原型模拟分块到达：按字符（码点）切成 2–12 个一块，每块间隔 40–120ms。`rand` 可注入，测试用。 */
  function chunkArrivals(text, rand) {
    const r = typeof rand === 'function' ? rand : Math.random;
    const cps = Array.from(String(text || ''));
    const out = [];
    let end = 0;
    for (let i = 0; i < cps.length;) {
      const size = 2 + Math.floor(r() * 11);
      const piece = cps.slice(i, i + size).join('');
      end += piece.length;
      out.push({text: piece, end, delay: 40 + Math.floor(r() * 81)});
      i += size;
    }
    return out;
  }

  window.BC_AGENT_STREAM = {revealStep, safeCut, advanceCut, splitBlocks, closeStreamingTail, chunkArrivals};
})();
