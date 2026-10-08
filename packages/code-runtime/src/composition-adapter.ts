/**
 * 页面里的统一取帧脚本（代码包规范 §4.1、§4.7；架构设计 §8.3–§8.4）。
 *
 * 宿主在入口页面加载完之后用 `webContents.executeJavaScript` 注入 `COMPOSITION_ADAPTER_SCRIPT`，得到
 * `window.__baocutAdapter = { ready, seek }`。两个方法都不抛异常，而是兑现成信封：
 * `{ ok: true, value }` 或 `{ ok: false, code, message }`，`code` 取自 `CODE_BUNDLE_ERROR_CODES`；
 * 这样页面里的错误码不依赖 Electron 怎样序列化被拒绝的 Promise。
 *
 * - `hyperframes/1`：轮询 `window.__timelines[id]`，根元素是 `[data-composition-id="id"]`，尺寸、帧率与时长读根元素的 `data-*`；
 *   `seek(秒)` 调时间线的 `seek`（没有就用 `progress`），再回读 `time()`。时间线比 `data-duration` 短时，越过它的请求按 hold 处理。
 * - `baocut/1`：轮询 `window.__baocutCompositions[id]`（`initialize` / `renderAt(time, params)` / `dispose`），
 *   `renderAt(time, params)` 收到微秒时间基的 `MediaTime`（`ticks = round(秒 × 10⁶)`）与空参数对象 `{}`；
 *   它兑现成数字时当作实际采样的秒数，否则采样时间就是目标时间。
 *
 * 每次 seek 之后等两次 `requestAnimationFrame`，让 DOM 提交后再截图（§8.4：这只是候选的等待策略）。
 */

/** `ready` 兑现的页面信息。页面没给的字段为 null，由宿主用清单补。 */
export interface AdapterPageInfo {
  compositionId: string;
  width: number | null;
  height: number | null;
  /** 根元素 `data-fps` 的原文（`"30"`、`"30000/1001"`）。 */
  fps: string | null;
  durationSeconds: number;
}

export interface AdapterSeekResult {
  sampledSeconds: number;
  /** 实际求值的目标时间（夹到 `[0, 时长]`，越过时间线自身长度时取时间线长度）。 */
  targetSeconds: number;
  /** 请求超过了时长，被夹到末尾。 */
  clamped: boolean;
}

/** 宿主给 `ready` 的上下文（来自清单）。 */
export interface AdapterReadyContext {
  width: number;
  height: number;
  fps: { num: number; den: number };
  durationFrames: number;
}

// i18n-ignore-start: 注入页面的脚本源码，不是给人看的文字
export const COMPOSITION_ADAPTER_SCRIPT = String.raw`(() => {
  if (window.__baocutAdapter) return;
  const fail = (code, message) => Object.assign(new Error(message), { code });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const twoFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const guard = async (fn) => {
    try {
      return { ok: true, value: await fn() };
    } catch (error) {
      const code = error && typeof error.code === 'string' && error.code.indexOf('COMPOSITION_') === 0 ? error.code : 'COMPOSITION_SCRIPT_ERROR';
      return { ok: false, code, message: String((error && error.message) || error) };
    }
  };
  const poll = async (get, timeoutMs, code, message) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = get();
      if (value) return value;
      if (Date.now() >= deadline) throw fail(code, message);
      await sleep(16);
    }
  };
  const findRoot = (id) => {
    const escaped = window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
    return document.querySelector('[data-composition-id="' + escaped + '"]');
  };
  const numberAttr = (root, name) => {
    const raw = root.getAttribute(name);
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const fontsReady = async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  };
  const readDuration = (tl) => {
    const d = typeof tl.duration === 'function' ? tl.duration() : tl.duration;
    return typeof d === 'number' && Number.isFinite(d) ? d : null;
  };

  let state = null;

  const readyHyperframes = async (id, timeoutMs) => {
    const tl = await poll(
      () => window.__timelines && window.__timelines[id],
      timeoutMs,
      'COMPOSITION_TIMELINE_MISSING',
      'window.__timelines["' + id + '"] was not registered within ' + timeoutMs + ' ms',
    );
    const root = findRoot(id);
    if (!root) throw fail('COMPOSITION_ROOT_MISSING', 'No element with data-composition-id="' + id + '"');
    await fontsReady();
    if (typeof tl.pause === 'function') tl.pause();
    const dataDuration = numberAttr(root, 'data-duration');
    const ownDuration = readDuration(tl);
    const duration = dataDuration !== null ? dataDuration : ownDuration;
    if (!(typeof duration === 'number' && duration > 0)) throw fail('COMPOSITION_TIMELINE_MISSING', 'The timeline has no duration and the root has no data-duration');
    state = { contract: 'hyperframes/1', id, tl, root, duration, ownDuration };
    return {
      compositionId: id,
      width: numberAttr(root, 'data-width'),
      height: numberAttr(root, 'data-height'),
      fps: root.getAttribute('data-fps'),
      durationSeconds: duration,
    };
  };

  const readyNative = async (id, timeoutMs, ctx) => {
    const comp = await poll(
      () => window.__baocutCompositions && window.__baocutCompositions[id],
      timeoutMs,
      'COMPOSITION_TIMELINE_MISSING',
      'window.__baocutCompositions["' + id + '"] was not registered within ' + timeoutMs + ' ms',
    );
    if (typeof comp.renderAt !== 'function') throw fail('COMPOSITION_TIMELINE_MISSING', 'The composition has no renderAt(time, params)');
    const root = findRoot(id);
    if (!root) throw fail('COMPOSITION_ROOT_MISSING', 'No element with data-composition-id="' + id + '"');
    await fontsReady();
    if (typeof comp.initialize === 'function') {
      await comp.initialize({
        compositionId: id,
        target: root,
        width: ctx.width,
        height: ctx.height,
        pixelRatio: 1,
        intrinsicFps: ctx.fps,
        fps: ctx.fps,
        durationFrames: ctx.durationFrames,
        seed: id,
        parameters: {},
        fonts: { ready: fontsReady },
        assets: { resolve: async (assetId) => { throw fail('COMPOSITION_SCRIPT_ERROR', 'Asset ' + assetId + ' is not available'); } },
      });
    }
    const dataDuration = numberAttr(root, 'data-duration');
    const duration = dataDuration !== null ? dataDuration : (ctx.durationFrames * ctx.fps.den) / ctx.fps.num;
    state = { contract: 'baocut/1', id, comp, root, duration };
    return {
      compositionId: id,
      width: numberAttr(root, 'data-width'),
      height: numberAttr(root, 'data-height'),
      fps: root.getAttribute('data-fps'),
      durationSeconds: duration,
    };
  };

  const seekHyperframes = async (seconds) => {
    const { tl, duration, ownDuration } = state;
    const clamped = seconds > duration;
    let target = Math.min(Math.max(seconds, 0), duration);
    // 时间线比 data-duration 短：越过时间线末尾的部分是 hold。
    if (typeof ownDuration === 'number' && ownDuration > 0 && target > ownDuration) target = ownDuration;
    if (typeof tl.seek === 'function') tl.seek(target);
    else if (typeof tl.progress === 'function') tl.progress(target / (ownDuration || duration));
    else throw fail('COMPOSITION_TIMELINE_MISSING', 'The timeline has neither seek() nor progress()');
    let sampled = target;
    if (typeof tl.time === 'function') sampled = tl.time();
    else if (typeof tl.progress === 'function') sampled = tl.progress() * (ownDuration || duration);
    await twoFrames();
    return { sampledSeconds: Number(sampled), targetSeconds: target, clamped };
  };

  const seekNative = async (seconds) => {
    const { comp, duration } = state;
    const clamped = seconds > duration;
    const target = Math.min(Math.max(seconds, 0), duration);
    const mediaTime = { ticks: String(Math.round(target * 1000000)), timescale: 1000000 };
    const returned = await comp.renderAt(mediaTime, {});
    await twoFrames();
    const sampled = typeof returned === 'number' && Number.isFinite(returned) ? returned : target;
    return { sampledSeconds: sampled, targetSeconds: target, clamped };
  };

  window.__baocutAdapter = {
    ready: (contract, compositionId, timeoutMs, ctx) =>
      guard(() => {
        if (contract === 'hyperframes/1') return readyHyperframes(compositionId, timeoutMs);
        if (contract === 'baocut/1') return readyNative(compositionId, timeoutMs, ctx);
        throw fail('COMPOSITION_SCRIPT_ERROR', 'Unknown contract ' + contract);
      }),
    seek: (seconds) =>
      guard(() => {
        if (!state) throw fail('COMPOSITION_TIMELINE_MISSING', 'ready() has not completed');
        return state.contract === 'hyperframes/1' ? seekHyperframes(seconds) : seekNative(seconds);
      }),
    dispose: () =>
      guard(() => {
        if (state && state.comp && typeof state.comp.dispose === 'function') state.comp.dispose();
        state = null;
        return true;
      }),
  };
})();
true;`;
// i18n-ignore-end
