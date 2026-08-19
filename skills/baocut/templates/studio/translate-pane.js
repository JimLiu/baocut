// BaoCut Subtitle Studio — Translate 面板的纯逻辑（可单测，无 DOM/React）。
//
// 这里只放三件事：
//   1) 查找替换的「替换范围」（原文 / 译文 / 两者）—— Mac
//      `Translation/Pane/TranslateFindReplace.swift` 的 `TrReplaceScope` +
//      `trFindMatches` 同语义：一份匹配列表同时喂计数、导航、高亮与替换，
//      源侧的条目键是 **Cue**（源文本的编辑单位就是 cue，写路径是 editCue），
//      译侧仍是整句片 / 逐行片（写路径是 editTrans）。范围在一次扫描里是不变量，
//      所以在建条目时就筛掉，而不是扫完再过滤。
//   2) 「复制全部译文」的投递行（Mac `TranslatePaneActions.copyAll()` +
//      `TranslationDomainAdapter.joinedNonemptyLines`）：一行一个投递片，
//      空行丢掉，换行连接。纯前端动作，不入 Agent 队列。
//   3) 源侧高亮的偏移换算。Web 的原文列不是逐 cue 整行（那是原型
//      `designs/baocut-mac/app/translate.jsx` 的 OrigLine），而是 M122 的
//      `sourceCueParts` 词区间子行；查找匹配的偏移却是相对整条 cue.text 的。
//      `lineHighlight()` 用词表把 cue 内偏移换算到子行局部偏移，换算不成立时
//      丢掉那条匹配，让调用方退回纯文本 —— 宁可不高亮，也不画错位置的 <mark>。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_TRANSLATE_PANE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Mac TrReplaceScope 的 shortLabel / menuLabel（Both sides / Transcript /
  // Translation；Both transcript and translation / Transcript only /
  // Translation only）。tip 对应 Mac 的 "Replace in " + menuLabel.lowercased()。
  const SCOPES = [
    { id: 'both', short: '两者', label: '原文和译文', tip: '在原文和译文中替换' },
    { id: 'transcript', short: '原文', label: '仅原文', tip: '仅在原文中替换' },
    { id: 'translation', short: '译文', label: '仅译文', tip: '仅在译文中替换' },
  ];
  const DEFAULT_SCOPE = 'both';
  const scopeInfo = (scope) => SCOPES.find((s) => s.id === scope) || SCOPES[0];
  const scopeIncludes = (scope, field) => scope === 'both' || scope === field;

  // 源侧条目键要和译侧的 sentence/piece id 分处两个命名空间 —— 它们同在一份
  // items 里，撞键会让 replacePlan 把两条写路径折进同一次替换。
  const SOURCE_PREFIX = 'src:';
  const sourceKey = (cueId) => SOURCE_PREFIX + cueId;

  // 一句译文的展示形态：没有切分片（或只有一片 sentence 片）时整句上屏。
  const sentencePieces = (transCues, sentenceId) =>
    (transCues || []).filter((tc) => tc && tc.sid === sentenceId);
  const sentenceIsWhole = (sentence, pieces) => {
    const list = pieces || [];
    return !String((sentence && sentence.trans) || '').trim() || !list.length
      || (list.length === 1 && list[0].kind === 'sentence');
  };

  // 查找条目。顺序 = Mac `trFindMatches` 的扫描顺序：按卡（句）自上而下，
  // 卡内先原文后译文，这样上一个/下一个匹配就是从上往下走屏幕。
  // kind 决定替换走哪条既有写路径：'cue' → editCue，'sentence'/'piece' → editTrans。
  function findItems(doc, scope) {
    const d = doc || {};
    const cueById = new Map((d.cues || []).map((cue) => [cue.id, cue]));
    const wantSource = scopeIncludes(scope, 'transcript');
    const wantTrans = scopeIncludes(scope, 'translation');
    const seen = new Set();
    const out = [];
    (d.sentences || []).forEach((s) => {
      if (wantSource) {
        (s.cueIds || []).forEach((cueId) => {
          const cue = cueById.get(cueId);
          if (!cue || seen.has(cueId)) return;
          seen.add(cueId);
          out.push({ key: sourceKey(cueId), card: s.id, cueId, kind: 'cue', text: cue.text || '' });
        });
      }
      if (!wantTrans) return;
      const pieces = sentencePieces(d.transCues, s.id);
      if (sentenceIsWhole(s, pieces)) {
        out.push({ key: s.id, card: s.id, kind: 'sentence', text: s.trans || '' });
      } else {
        pieces.forEach((tc) => out.push({ key: tc.id, card: s.id, kind: 'piece', text: tc.text || '' }));
      }
    });
    return out;
  }

  // 「复制全部译文」的投递行：一行一个投递片（整句句 or 逐行片），空的丢掉。
  function deliveryLines(doc) {
    const d = doc || {};
    const out = [];
    (d.sentences || []).forEach((s) => {
      const pieces = sentencePieces(d.transCues, s.id);
      if (sentenceIsWhole(s, pieces)) out.push(String(s.trans || '').trim());
      else pieces.forEach((tc) => out.push(String(tc.text || '').trim()));
    });
    return out.filter((line) => line.length > 0);
  }
  const copyAllText = (doc) => deliveryLines(doc).join('\n');

  // 词在一段文本里的实际区间。不假设分隔符（英文空格 / CJK 无空格都成立）：
  // 顺序扫描 indexOf，找不到的词跳过而不是把后面的偏移全带歪。
  function scanOffsets(text, words) {
    const body = String(text == null ? '' : text);
    const out = [];
    let pos = 0;
    (words || []).forEach((word) => {
      const piece = String((word && word.text) || '');
      if (!piece) return;
      const at = body.indexOf(piece, pos);
      if (at < 0) return;
      out.push({ id: word && word.id != null ? String(word.id) : null, start: at, end: at + piece.length });
      pos = at + piece.length;
    });
    return out;
  }
  const wordOffsets = (cue) => scanOffsets(cue && cue.text, cue && cue.words);

  // 词 id → 它所属的 cue。子行的词来自译文片的 sourceWords，本身不带 cue 归属。
  function sourceIndex(cues) {
    const cueById = new Map();
    const wordCue = new Map();
    (cues || []).forEach((cue) => {
      if (!cue || cue.id == null) return;
      cueById.set(cue.id, cue);
      (cue.words || []).forEach((w) => { if (w && w.id != null) wordCue.set(String(w.id), cue); });
    });
    return { cueById, wordCue };
  }

  // 把原文匹配换算到一条展示子行的局部偏移。
  //
  // 匹配的偏移是相对整条 cue.text 的（editCue 的口径），而子行是 M122 的词区间
  // 投影：`mergeShortRuns` 会把 ≤2 词的碎片并进相邻子行，所以一条子行可能横跨
  // 两条 cue，`part.cueId` 只是它的首条 cue。因此换算是逐词做的 —— 词在子行里
  // 的位置与它在自己 cue 里的位置各扫一次，取覆盖匹配的首尾两个词做线性映射，
  // 最后再用"这段文本必须一模一样"兜底。对不上就把这条匹配丢掉：宁可不高亮，
  // 也不画错位置的 <mark>。
  //
  // marksFor(cueId) / curFor(cueId) 由调用方给（面板的 find 投影）。
  function lineHighlight(text, words, wordCue, marksFor, curFor) {
    const body = String(text == null ? '' : text);
    if (!body || !wordCue) return null;
    const inLine = scanOffsets(body, words);
    if (!inLine.length) return null;
    const byCue = new Map();
    inLine.forEach((slot) => {
      const cue = slot.id === null ? null : wordCue.get(slot.id);
      if (!cue) return;
      if (!byCue.has(cue.id)) byCue.set(cue.id, { cue, slots: [] });
      byCue.get(cue.id).slots.push(slot);
    });
    const out = [];
    let cur = null;
    byCue.forEach(({ cue, slots }) => {
      const marks = marksFor(cue.id);
      if (!marks || !marks.length) return;
      const cueText = String(cue.text || '');
      const cueOffsets = new Map(wordOffsets(cue).map((o) => [o.id, o]));
      const curStart = curFor(cue.id);
      marks.forEach((m) => {
        let head = null, tail = null;
        slots.forEach((slot) => {
          const o = cueOffsets.get(slot.id);
          if (!o) return;
          if (o.start <= m.start && m.start < o.end) head = { slot, o };
          if (o.start < m.end && m.end <= o.end) tail = { slot, o };
        });
        if (!head || !tail) return;
        const start = head.slot.start + (m.start - head.o.start);
        const end = tail.slot.start + (m.end - tail.o.start);
        if (end <= start || start < 0 || end > body.length) return;
        if (body.slice(start, end) !== cueText.slice(m.start, m.end)) return;
        out.push({ start, end });
        if (curStart != null && curStart === m.start) cur = start;
      });
    });
    if (!out.length) return null;
    out.sort((a, b) => a.start - b.start);
    return { marks: out, curStart: cur };
  }

  return {
    SCOPES, DEFAULT_SCOPE, scopeInfo, scopeIncludes,
    SOURCE_PREFIX, sourceKey,
    sentencePieces, sentenceIsWhole, findItems,
    deliveryLines, copyAllText,
    scanOffsets, wordOffsets, sourceIndex, lineHighlight,
  };
});
