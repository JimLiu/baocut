// Pure transcript word-run projection shared by the React pane and Node tests.
// It preserves the cue's exact text while attaching cut state only to real
// word atoms. Cue shading is applied by the React wrapper, so joining spaces
// inside one cue inherit the same background without inheriting a strike.
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_TRANSCRIPT_WORDS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function wordIsCut(word, cuts) {
    const t0 = word && (word.t0 == null ? word.start : word.t0);
    const t1 = word && (word.t1 == null ? word.end : word.t1);
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return false;
    const midpoint = (t0 + t1) / 2;
    return (cuts || []).some((cut) => cut && cut.t0 <= midpoint && cut.t1 >= midpoint);
  }

  function cueRuns(cue, cuts) {
    const text = String((cue && cue.text) || '');
    const words = cue && Array.isArray(cue.words) ? cue.words : [];
    if (!words.length) return [{ text, wordId: null, cut: false }];

    const runs = [];
    let cursor = 0;
    for (const word of words) {
      const atom = String((word && word.text) || '');
      const at = atom ? text.indexOf(atom, cursor) : -1;
      // Edited or malformed projections may no longer match their old atoms.
      // Fall back to one exact plain-text run instead of duplicating/dropping text.
      if (at < cursor) return [{ text, wordId: null, cut: false }];
      if (at > cursor) runs.push({ text: text.slice(cursor, at), wordId: null, cut: false });
      runs.push({ text: atom, wordId: word.id || null, cut: wordIsCut(word, cuts) });
      cursor = at + atom.length;
    }
    if (cursor < text.length) runs.push({ text: text.slice(cursor), wordId: null, cut: false });
    return runs;
  }

  return { wordIsCut, cueRuns };
});
