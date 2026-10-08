/**
 * Agent 回复的逐字显示与 Markdown 分块（产品设计 §3.2.2）。纯函数，视图在 components/thread/agent-markdown.tsx。
 *
 * 回复的文字一坨一坨到达（Runtime 按 60ms 左右的窗口合并后才送过来），界面不按到达的节奏跳，而是匀速往外放：
 * 每一帧放出的字符数与积压成正比，积压多就追得快，积压少就慢慢走。全文留在 store，视图只渲染已放出的那一截。
 *
 * - `revealStep`：这一帧该多放几个字符
 * - `safeCut` / `advanceCut`：切点落在字素簇边界上，不把一个字切成两半
 * - `splitBlocks`：按 Markdown 块拆开，流式时只有最后一块在变
 * - `closeStreamingTail`：最后一块里没写完的标记先补齐，渲染时不闪出星号与反引号
 */

/** 积压在多长时间里放完。 */
export const REVEAL_HORIZON_MS = 150;
/** 两帧之间的时间先夹到这么长：页面隐藏回来后不一口气放完。 */
const MAX_ELAPSED_MS = 250;

/** 这一帧放出几个字符：与积压成正比，下限 1、上限 backlog；elapsed 先夹到 250ms，不短于 horizon 时全部放出。 */
export function revealStep(input: { backlog: number; elapsedMs: number; horizonMs?: number }): number {
  const backlog = Math.max(0, Math.floor(input.backlog || 0));
  if (!backlog) return 0;
  const horizon = input.horizonMs && input.horizonMs > 0 ? input.horizonMs : REVEAL_HORIZON_MS;
  const elapsed = Math.min(MAX_ELAPSED_MS, Math.max(0, Number(input.elapsedMs) || 0));
  if (elapsed >= horizon) return backlog;
  return Math.min(backlog, Math.max(1, Math.ceil((backlog * elapsed) / horizon)));
}

/* Intl.Segmenter 每次调用都现查：测试会临时拿掉它，缓存跟着构造器走。 */
let segCache: { ctor: typeof Intl.Segmenter; seg: Intl.Segmenter } | null = null;
function segmenter(): Intl.Segmenter | null {
  const Seg = typeof Intl !== 'undefined' ? (Intl.Segmenter as typeof Intl.Segmenter | undefined) : undefined;
  if (typeof Seg !== 'function') return null;
  if (!segCache || segCache.ctor !== Seg) segCache = { ctor: Seg, seg: new Seg(undefined, { granularity: 'grapheme' }) };
  return segCache.seg;
}

/** 把切点拉回到它所在字素簇的起点；没有 Intl.Segmenter 时原样返回。 */
export function safeCut(text: string, index: number): number {
  const i = Math.max(0, Math.min(text.length, Math.floor(index) || 0));
  if (i === 0 || i === text.length) return i;
  const seg = segmenter();
  if (!seg) return i;
  const hit = seg.segment(text).containing(i);
  return hit ? hit.index : i;
}

/** 从 `from` 往后放 `step` 个字符，保证至少前进一个完整的字素簇（safeCut 可能把切点拉回原地）。 */
export function advanceCut(text: string, from: number, step: number): number {
  const start = Math.max(0, Math.min(text.length, from || 0));
  if (start >= text.length) return text.length;
  const target = Math.min(text.length, start + Math.max(1, Math.floor(step) || 1));
  const cut = safeCut(text, target);
  if (cut > start) return cut;
  const seg = segmenter();
  const hit = seg ? seg.segment(text).containing(start) : undefined;
  return hit ? Math.min(text.length, hit.index + hit.segment.length) : target;
}

// ---- 围栏代码块 ----

interface Fence {
  ch: string;
  len: number;
}
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})([^`]*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

function fenceOpen(line: string): Fence | null {
  const m = FENCE_OPEN.exec(line);
  if (!m) return null;
  const marks = m[1]!;
  if (marks[0] === '`' && m[2]!.includes('`')) return null;
  return { ch: marks[0]!, len: marks.length };
}

function fenceCloses(line: string, open: Fence): boolean {
  const m = FENCE_CLOSE.exec(line);
  return !!m && m[1]![0] === open.ch && m[1]!.length >= open.len;
}

const LIST_ITEM = /^ {0,3}([*+-]|\d{1,9}[.)])(\s+|$)/;
const blank = (line: string) => /^[ \t]*$/.test(line);

/** 按 Markdown 块拆开（空行分隔）；围栏代码块里、列表内部的空行不拆。块尾的空行不算进块里。 */
export function splitBlocks(markdown: string): string[] {
  const lines = markdown.split('\n');
  const blocks: string[] = [];
  let cur: string[] = [];
  let fence: Fence | null = null;
  const flush = () => {
    while (cur.length && blank(cur[cur.length - 1]!)) cur.pop();
    if (cur.length) blocks.push(cur.join('\n'));
    cur = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (fence) {
      cur.push(line);
      if (fenceCloses(line, fence)) fence = null;
      continue;
    }
    if (blank(line)) {
      if (!cur.length) continue;
      let j = i + 1;
      while (j < lines.length && blank(lines[j]!)) j++;
      const next = j < lines.length ? lines[j]! : null;
      const inList = LIST_ITEM.test(cur[0]!);
      // 列表里的空行：下一行还是列表项或缩进的续行，就留在同一块；后面还没到的先挂着。
      if (inList && (next === null || LIST_ITEM.test(next) || /^[ \t]{2,}\S/.test(next))) {
        cur.push(line);
        continue;
      }
      if (next === null) {
        cur.push(line);
        continue;
      }
      flush();
      continue;
    }
    const open = fenceOpen(line);
    if (open) {
      // 围栏能打断段落：前面的段落自成一块。
      if (cur.length && !LIST_ITEM.test(cur[0]!)) flush();
      fence = open;
    }
    cur.push(line);
  }
  flush();
  return blocks;
}

// ---- 流式尾部补全 ----

type Span = [start: number, end: number];

/** 行内代码的区间（[start, end)，end 含收尾反引号）；最后一个没闭合的单独返回。 */
function codeSpans(s: string): { spans: Span[]; open: { start: number; len: number } | null } {
  const spans: Span[] = [];
  let open: { start: number; len: number } | null = null;
  for (let i = 0; i < s.length;) {
    if (s[i] === '\\' && open === null) {
      i += 2;
      continue;
    }
    if (s[i] !== '`') {
      i++;
      continue;
    }
    let j = i;
    while (j < s.length && s[j] === '`') j++;
    const len = j - i;
    if (open === null) open = { start: i, len };
    else if (open.len === len) {
      spans.push([open.start, j]);
      open = null;
    }
    i = j;
  }
  return { spans, open };
}

const inSpans = (spans: Span[], i: number) => spans.some(([a, b]) => i >= a && i < b);

/** 没写完的图片整个藏起来；没写完的链接只露出文字。行内代码里的方括号不算。 */
function fixLinks(s: string): string {
  const { spans, open } = codeSpans(s);
  const masked = (i: number) => inSpans(spans, i) || (open !== null && i >= open.start);
  for (let i = s.lastIndexOf('!['); i >= 0; i = i > 0 ? s.lastIndexOf('![', i - 1) : -1) {
    if (masked(i)) continue;
    if (!/^!\[[^\]]*\]\([^)]*\)/.test(s.slice(i))) return fixLinks(s.slice(0, i));
    break;
  }
  for (let i = s.lastIndexOf('['); i >= 0; i = i > 0 ? s.lastIndexOf('[', i - 1) : -1) {
    if (masked(i) || s[i - 1] === '\\') continue;
    const rest = s.slice(i);
    const m = /^\[([^\]]*)$/.exec(rest) ?? /^\[([^\]]*)\]$/.exec(rest) ?? /^\[([^\]]*)\]\([^)]*$/.exec(rest);
    return m ? s.slice(0, i) + m[1] : s;
  }
  return s;
}

/** 强调标记的配对栈：返回还没闭合的开标记（按出现顺序）。行首的列表符号、两边都是空白的星号不算。 */
function openMarkers(s: string, spans: Span[]): { mark: string; at: number }[] {
  const stack: { mark: string; at: number }[] = [];
  let lineStart = 0;
  for (let i = 0; i < s.length;) {
    const c = s[i]!;
    if (c === '\n') {
      lineStart = i + 1;
      i++;
      continue;
    }
    if (c === '\\') {
      i += 2;
      continue;
    }
    if ((c !== '*' && c !== '~') || inSpans(spans, i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < s.length && s[j] === c) j++;
    let len = j - i;
    const prev = i > 0 ? s[i - 1]! : '';
    const next = j < s.length ? s[j]! : '';
    const prevSpace = !prev || /\s/.test(prev);
    const nextSpace = !next || /\s/.test(next);
    const listMark = c === '*' && len === 1 && /^[ \t]*$/.test(s.slice(lineStart, i)) && next === ' ';
    if (listMark || (prevSpace && nextSpace)) {
      i = j;
      continue;
    }
    if (c === '~') {
      if (len >= 2) {
        const top = stack[stack.length - 1];
        if (top && top.mark === '~~' && !prevSpace) stack.pop();
        else if (!nextSpace) stack.push({ mark: '~~', at: i });
      }
      i = j;
      continue;
    }
    // 先当收尾：从栈顶往下配。
    while (len > 0 && !prevSpace) {
      const top = stack[stack.length - 1];
      if (!top || top.mark[0] !== '*' || top.mark.length > len) break;
      stack.pop();
      len -= top.mark.length;
    }
    // 剩下的当开头。
    if (len > 0 && !nextSpace) {
      if (len >= 2) {
        stack.push({ mark: '**', at: i });
        len -= 2;
      }
      if (len >= 1) stack.push({ mark: '*', at: i });
    }
    i = j;
  }
  return stack;
}

/**
 * 流式中最后一块的补全：只动最后一段，在没闭合的围栏里什么都不做。没闭合的 `**` `*` `~~` 与行内代码补齐，
 * 末尾孤零零的标记去掉，没写完的链接只露文字，没写完的图片藏起来。渲染前的字符串预处理：解析器没有分隔符钩子。
 */
export function closeStreamingTail(markdown: string): string {
  const lines = markdown.split('\n');
  let fence: Fence | null = null;
  let tailStart = 0;
  let pos = 0;
  for (const line of lines) {
    const end = pos + line.length + 1;
    if (fence) {
      if (fenceCloses(line, fence)) {
        fence = null;
        tailStart = end;
      }
    } else if (blank(line)) tailStart = end;
    else {
      const open = fenceOpen(line);
      if (open) fence = open;
    }
    pos = end;
  }
  if (fence) return markdown;
  tailStart = Math.min(tailStart, markdown.length);
  const head = markdown.slice(0, tailStart);
  let tail = markdown.slice(tailStart);
  if (!tail) return markdown;

  tail = fixLinks(tail);
  // 末尾孤零零的标记直接去掉（`_` 只在它前面是空白时）；写完一半的收尾标记也先去掉，下面统一补。
  const strip = (s: string) => s.replace(/[*~]+$/, '').replace(/(^|\s)_+$/, '$1');
  let code = codeSpans(tail);
  if (code.open && code.open.start + code.open.len === tail.length) {
    // 只来了开头的反引号：先不显示。
    tail = strip(tail.slice(0, code.open.start));
    code = codeSpans(tail);
  } else if (!code.open) {
    tail = strip(tail);
    code = codeSpans(tail);
  }
  let closers = '';
  let scan = tail;
  if (code.open) {
    // 行内代码里的星号不算强调；先闭合代码，再闭合外面的强调。
    closers += '`'.repeat(code.open.len);
    scan = tail.slice(0, code.open.start);
  }
  const markers = openMarkers(scan, code.spans);
  for (let k = markers.length - 1; k >= 0; k--) closers += markers[k]!.mark;
  if (!closers) return head + tail;
  const trail = /\s*$/.exec(tail)![0];
  return head + tail.slice(0, tail.length - trail.length) + closers + trail;
}
