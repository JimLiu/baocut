// 章节标题改名的稳定 patchTranscript builder。
// chapters 是整表替换契约：只替换目标标题，同时保留所有稳定 id 与时间边界。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_CHAPTER_TITLE_EDIT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function operation(chapters, chapterId, title) {
    const id = String(chapterId || '').trim();
    const value = String(title == null ? '' : title).trim();
    if (!Array.isArray(chapters) || !id || !value) return null;
    let found = false;
    const next = chapters.map((chapter) => {
      const match = chapter && chapter.id === id;
      if (match) found = true;
      return {
        id: chapter && chapter.id,
        title: match ? value : String((chapter && chapter.title) || ''),
        start: chapter && chapter.start,
        end: chapter && chapter.end,
      };
    });
    return found ? { kind: 'patchTranscript', set: { chapters: next } } : null;
  }

  return { operation };
});
