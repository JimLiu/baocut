// Translate 卡跨 Sentence paragraph pin 合并的纯客户端预检与 op builder。
// 服务端 bcut-flow-core 会按原始 transcript 再检查同一组约束并原子写入；这里
// 只负责隐藏非法按钮、保留编辑中的整卡译文，以及构造稳定 CAS 载荷。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_TRANSLATION_PARAGRAPH = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const HARD_GAP_SECONDS = 1.8;
  const MAX_WORDS = 80;
  const CLOSERS = new Set(['”', '"', '’', "'", '」', '』', '）', ')', ']', '》']);
  const TERMINAL = new Set(['。', '．', '.', '？', '?', '！', '!', '…']);
  const ABBREV = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'sr', 'jr', 'rev', 'hon', 'fr', 'gen', 'gov',
    'sen', 'rep', 'col', 'lt', 'sgt', 'capt', 'vs', 'etc', 'inc', 'ltd', 'corp', 'dept',
    'vol', 'fig',
  ]);

  function language(doc) {
    return (((doc || {}).meta || {}).targetLang || {}).code || '';
  }

  function compactScript(lang) {
    const primary = String(lang || '').toLowerCase().split(/[-_]/)[0];
    return ['zh', 'ja', 'ko', 'th'].includes(primary);
  }

  function joinTexts(parts, lang) {
    return (parts || []).map((text) => String(text || '').trim()).filter(Boolean)
      .join(compactScript(lang) ? '' : ' ');
  }

  function sentencePieces(doc, sentence) {
    return ((doc || {}).transCues || [])
      .filter((piece) => piece.sid === sentence.id && piece.kind === 'piece')
      .sort((a, b) => (a.wordFrom || 0) - (b.wordFrom || 0));
  }

  function sentenceText(doc, sentence) {
    const pieces = sentencePieces(doc, sentence);
    return pieces.length
      ? joinTexts(pieces.map((piece) => piece.text), language(doc))
      : String((sentence || {}).trans || '');
  }

  function sentenceTextReplacing(doc, sentence, reference, value) {
    const pieces = sentencePieces(doc, sentence);
    if (!pieces.length) return String(value || '');
    return joinTexts(pieces.map((piece) => piece.id === reference ? value : piece.text), language(doc));
  }

  // 对拍 bcut-flow-core::atomize::sentence_end。
  function sentenceEnd(token) {
    const chars = Array.from(String(token || ''));
    let index = chars.length, skipped = 0;
    while (index > 0 && CLOSERS.has(chars[index - 1]) && skipped < 1) { index--; skipped++; }
    if (!index || !TERMINAL.has(chars[index - 1])) return false;
    if (chars[index - 1] === '.') {
      const stem = chars.slice(0, index - 1).join('');
      if (stem.includes('.')) return false;
      const normalized = stem.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
      if (ABBREV.has(normalized)) return false;
    }
    return true;
  }

  function edgeWord(doc, sentence, first) {
    const ids = (sentence || {}).sourceWordIds || [];
    const id = first ? ids[0] : ids[ids.length - 1];
    if (!id) return null;
    for (const cue of (doc.cues || [])) {
      const word = (cue.words || []).find((item) => item.id === id);
      if (word) return { word, speaker: cue.sp || '' };
    }
    return null;
  }

  function chapterAt(doc, time) {
    return (doc.chapters || []).findIndex((chapter) => time >= chapter.start && time < chapter.end);
  }

  function canMerge(doc, upper, lower) {
    if (!doc || !upper || !lower) return false;
    const sentences = doc.sentences || [];
    const upperIndex = sentences.findIndex((sentence) => sentence.id === upper.id);
    const lowerIndex = sentences.findIndex((sentence) => sentence.id === lower.id);
    if (upperIndex < 0 || lowerIndex !== upperIndex + 1 || !lower.paraStart) return false;
    if ((upper.sourceWordIds || []).length + (lower.sourceWordIds || []).length > MAX_WORDS) return false;
    const upperLast = edgeWord(doc, upper, false), lowerFirst = edgeWord(doc, lower, true);
    if (!upperLast || !lowerFirst || upperLast.speaker !== lowerFirst.speaker) return false;
    return !sentenceEnd(upperLast.word.text)
      && lowerFirst.word.t0 - upperLast.word.t1 < HARD_GAP_SECONDS
      && chapterAt(doc, upperLast.word.t0) === chapterAt(doc, lowerFirst.word.t0);
  }

  function operation(doc, upper, lower, upperValue, lowerValue) {
    const lang = language(doc);
    if (!lang || !canMerge(doc, upper, lower)) return null;
    return {
      kind: 'translationParagraphMerge', lang,
      upperSid: upper.id, lowerSid: lower.id,
      upperBase: sentenceText(doc, upper), lowerBase: sentenceText(doc, lower),
      upperValue, lowerValue,
    };
  }

  return {
    HARD_GAP_SECONDS, MAX_WORDS, sentenceEnd, sentenceText, sentenceTextReplacing,
    canMerge, operation,
  };
});
