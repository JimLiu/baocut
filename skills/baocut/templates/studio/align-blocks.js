// 对齐块层（对齐块设计 §5/§7）的纯函数消费端：把 data.json `sentences[].blocks`
// 投影到译文片（transCues）上，供 SentenceCard 画块刻度、拆分吸附到块边界。
//
// 数据形状：`blocks[i] = { src: [from, to], tgt: [from, to], confidence?, flags[] }`；
// `src` 是句内词序闭区间（与 transCue.wordFrom/wordTo 同一下标空间），`tgt` 是
// `concat(pieces.text)` 上的字符半开区间（按 Unicode 码点计，对拍 Rust `chars()`）。
// 片边界只能落在块边界上；空 `blocks` = 无块层（每片视为一块，走旧路径）。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_ALIGN_BLOCKS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const charLen = (text) => Array.from(text || '').length;

  function hasBlocks(sentence) {
    return !!(sentence && Array.isArray(sentence.blocks) && sentence.blocks.length);
  }

  /// 同一句的译文片按源词区间排序（transCues 全局按时间排，句内需要重排）。
  function sentencePieces(transCues, sid) {
    return (transCues || [])
      .filter((tc) => tc.sid === sid && tc.kind === 'piece'
        && Number.isInteger(tc.wordFrom) && Number.isInteger(tc.wordTo))
      .sort((a, b) => a.wordFrom - b.wordFrom);
  }

  /// 每片在拼接串上的起始字符偏移；返回 { [pieceId]: offset }。
  function pieceOffsets(pieces) {
    const out = {};
    let offset = 0;
    pieces.forEach((piece) => {
      out[piece.id] = offset;
      offset += charLen(piece.text);
    });
    return out;
  }

  /// 落在某片内的块（按源词区间判定；块层合法时与字符区间判定一致）。
  function blocksInPiece(blocks, piece) {
    return (blocks || []).filter((b) => Array.isArray(b.src)
      && b.src[0] >= piece.wordFrom && b.src[1] <= piece.wordTo);
  }

  /// 片内块刻度：每块一段，`chars` 是该块在本片译文里的字符数（画条用比例），
  /// `flags` 原样透传，`boundary` 表示该段之前是否是一个合法拆分点（片内块边界）。
  function pieceSegments(sentence, pieces, piece) {
    if (!hasBlocks(sentence)) return [];
    const offset = pieceOffsets(pieces)[piece.id] || 0;
    const end = offset + charLen(piece.text);
    return blocksInPiece(sentence.blocks, piece).map((b, index) => {
      const from = Math.max(offset, b.tgt[0]);
      const to = Math.min(end, b.tgt[1]);
      return {
        key: `${b.src[0]}-${b.src[1]}`,
        chars: Math.max(0, to - from),
        flags: Array.isArray(b.flags) ? b.flags.slice() : [],
        confidence: typeof b.confidence === 'number' ? b.confidence : null,
        boundary: index > 0,
      };
    });
  }

  /// 片内合法拆分点：{ afterWord, cut }（cut 为片内字符偏移）。首块之前不是拆分点。
  function splitPoints(sentence, pieces, piece) {
    if (!hasBlocks(sentence)) return null;
    const offset = pieceOffsets(pieces)[piece.id] || 0;
    return blocksInPiece(sentence.blocks, piece)
      .filter((b) => b.src[0] > piece.wordFrom)
      .map((b) => ({ afterWord: b.src[0] - 1, cut: b.tgt[0] - offset }));
  }

  /// 把光标字符偏移吸附到最近的块边界。无块层 → null（调用方走旧的按比例切法）；
  /// 有块层但片内没有边界（单块片）→ { ok: false }；否则 { ok: true, afterWord, cut }。
  function snapSplit(sentence, pieces, piece, charOffset) {
    const points = splitPoints(sentence, pieces, piece);
    if (points === null) return null;
    if (!points.length) return { ok: false, reason: 'single-block' };
    const target = Number.isFinite(charOffset) ? charOffset : 0;
    const best = points.reduce((acc, p) =>
      Math.abs(p.cut - target) < Math.abs(acc.cut - target) ? p : acc, points[0]);
    return { ok: true, afterWord: best.afterWord, cut: best.cut };
  }

  /// 拆分点是否落在块边界上（`afterWord` 之后断开）。无块层恒为 true。
  function isBlockBoundary(sentence, afterWord) {
    if (!hasBlocks(sentence)) return true;
    return sentence.blocks.some((b) => Array.isArray(b.src) && b.src[0] === afterWord + 1);
  }

  /// 卡片头部芯片语义（与 Mac / 原型同步）：`sentence` 对应 → 「整句对应」；
  /// `display` 基准 → 「已为字幕改写」。旧 `crossing` 只在缺 correspondence 时兜底。
  function cardChips(sentence) {
    const correspondence = sentence.correspondence
      || (sentence.crossing ? 'sentence' : null);
    return {
      sentenceLevel: correspondence === 'sentence',
      rewritten: sentence.textBasis === 'display' && !!sentence.displayText,
    };
  }

  return {
    hasBlocks, sentencePieces, pieceOffsets, blocksInPiece, pieceSegments,
    splitPoints, snapSplit, isBlockBoundary, cardChips, charLen,
  };
});
