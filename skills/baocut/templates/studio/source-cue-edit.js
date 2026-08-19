// 时间轴原文 Cue 删除的纯客户端契约。服务端仍会重派生 Cue 并做正文 CAS；
// 这里仅解析主源选中项与构造稳定 op，供 UI 和 Node 回归测试共用。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_SOURCE_CUE_EDIT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function selectedCue(doc, selection) {
    const cueId = selection && selection.cueId;
    if (!cueId) return null;
    return (((doc || {}).timelineCues || (doc || {}).cues || [])).find((cue) =>
      (!cue.sourceId || cue.sourceId === 'main') && (cue.sourceItemId || cue.id) === cueId
    ) || null;
  }

  function operation(cue) {
    const cueId = cue && (cue.sourceItemId || cue.id);
    if (!String(cueId || '').startsWith('q-') || typeof cue.text !== 'string') return null;
    return { kind: 'deleteOriginalCue', cueId, base: cue.text };
  }

  function isTextInput(element) {
    return !!element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA'
      || element.isContentEditable);
  }

  return { selectedCue, operation, isTextInput };
});
