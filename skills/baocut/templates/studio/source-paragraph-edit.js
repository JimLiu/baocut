// Transcript 段落正文 + split/merge 的稳定 op builder。服务端负责重派生 Para、
// 正文 CAS、词原子替换与结构边界校验；浏览器只提交当前实时文本与字符光标。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_SOURCE_PARAGRAPH_EDIT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function operation(kind, paragraph, liveText, charOffset) {
    const id = paragraph && (paragraph.paraId || paragraph.id);
    const value = String(liveText == null ? '' : liveText).replace(/\s+/g, ' ').trim();
    if (!['edit', 'split', 'mergeUp', 'mergeDown'].includes(kind)
      || !String(id || '').startsWith('p-') || !value) return null;
    const body = {
      kind, id, baseText: String(paragraph.text || ''), value,
    };
    if (kind === 'split') {
      const total = Array.from(value).length;
      if (!Number.isInteger(charOffset) || charOffset <= 0 || charOffset >= total) return null;
      body.charOffset = charOffset;
    }
    return { kind: 'sourceParagraph', operation: body };
  }

  return { operation };
});
