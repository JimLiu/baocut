// Transcript 说话人全局改名的稳定 patchTranscript builder。
// 说话人表是整值稀疏补丁，因此改名时必须保留既有 hue。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_SPEAKER_NAME_EDIT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function operation(speakerId, speaker, name) {
    const id = String(speakerId || '').trim();
    const value = String(name == null ? '' : name).trim();
    const rawHue = speaker && speaker.hue;
    if (!id || !value || rawHue == null || !Number.isFinite(Number(rawHue))) return null;
    const hue = Math.max(0, Math.min(360, Math.round(Number(rawHue))));
    return {
      kind: 'patchTranscript',
      set: { speakers: { [id]: { name: value, hue } } },
    };
  }

  return { operation };
});
