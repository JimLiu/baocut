// 纯函数画布点击策略。两秒窗口只属于当前 StagePane 的瞬时 UI 状态。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_STAGE_CLICK = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const WINDOW_MS = 2000;

  function resolve(input) {
    const now = Number(input.now) || 0;
    if (input.fullscreen) return { action: 'fullscreenToggle', deadline: null };
    if (input.playing) {
      return input.hasSelection
        ? { action: 'pause', deadline: null }
        : { action: 'pauseAndArm', deadline: now + WINDOW_MS };
    }
    if (input.hasSelection) {
      if (!input.hasTarget) return { action: 'clearSelection', deadline: null };
      return {
        action: input.targetSelected ? 'passThrough' : 'select',
        deadline: null,
      };
    }
    if (input.hasTarget && input.deadline != null && now <= input.deadline) {
      return { action: 'select', deadline: null };
    }
    return { action: 'play', deadline: null };
  }

  function createCoordinator(now) {
    let deadline = null;
    const clock = now || (() => performance.now());
    return {
      next(input) {
        const result = resolve({ ...input, now: clock(), deadline });
        deadline = result.deadline;
        return result.action;
      },
      reset() { deadline = null; },
      deadline() { return deadline; },
    };
  }

  return { WINDOW_MS, resolve, createCoordinator };
});
