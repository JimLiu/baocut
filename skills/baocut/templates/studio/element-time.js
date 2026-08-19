// BaoCut Subtitle Studio — 叠加元素的时间窗口与补丁语义（纯函数）。
//
// 四件事收口在这里，面板不再自带第二份判据：
//
//  1. **「整片」判定只能按值做**。timeline.json 里「整片」= 元素上没有 start/end 两个
//     键，但投影会把它们求值成 `0` 与片尾（`studio_timeline_projection` 的 fallback），
//     前端拿到的永远是数值，读不到「缺席」。所以判定是 start≈0 且 end≈片尾；写回时
//     整片写 `{start:null,end:null}`（服务端 `merge_patch` 把 null 当成删除键，实测
//     生效），自定义区间写具体秒数。副作用：一个恰好铺满全片的自定义区间会显示成
//     整片 —— 两者在画面上等价，代价只是换媒体后不会自动跟着变长。
//  2. 时间字段的解析与格式（`m:ss.s`，与 util.jsx 的 fmtT / parseTc 同口径，另外
//     容忍纯秒数输入）。
//  3. 窗口钳制：最短 MIN_SPAN 秒、两端不交叉、不越过片尾；拖块移动保持时长。
//  4. `merge_patch` 的 JS 镜像：滑块拖动期间的本地草稿必须与服务端
//     `bcut_timeline::elements::merge_patch` 同语义（对象递归合并、null 删除键），
//     否则「拖着看到的」和「松手写进去的」是两套结果。
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_ELEMENT_TIME = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  // 最短窗口 0.5s：再短的元素在时间轴上只有几个像素，也没法看清它出现过。
  const MIN_SPAN = 0.5;
  // 整片判定与「同一个值」判定的容差：时间一律落 0.1s 栅格，半格足够。
  const EPSILON = 0.05;

  const finite = (value, fallback) => (typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback);
  const tenth = (value) => Math.round(finite(value, 0) * 10) / 10;

  // ---------- 时间文本 ----------
  // 镜像 util.jsx 的 fmtT：m:ss.s，超过一小时才带小时段。
  function formatTime(seconds) {
    const t = Math.max(0, finite(seconds, 0));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    const ms = String(m).padStart(2, '0') + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
    return h ? String(h).padStart(2, '0') + ':' + ms : ms;
  }

  // 接受 `1:23.5` / `01:23` / `83.5`（纯秒）三种写法；其它一律 null（调用方还原原值）。
  function parseTime(text) {
    const input = String(text == null ? '' : text).trim().replace('：', ':');
    if (!input) return null;
    const clock = /^(?:(\d+):)?(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(input);
    if (clock) {
      const seconds = Number(clock[3]);
      if (seconds >= 60) return null;
      return (clock[1] ? Number(clock[1]) * 3600 : 0) + Number(clock[2]) * 60 + seconds;
    }
    const plain = /^\d+(?:\.\d+)?$/.exec(input);
    return plain ? Number(input) : null;
  }

  // ---------- 窗口 ----------
  // 投影里的 start/end 已经是数值；仍走 finite 兜底，免得 anchorError 的 null 变成 0。
  function windowOf(element, duration) {
    const end = Math.max(0, finite(duration, 0));
    const start = Math.max(0, finite(element && element.start, 0));
    return { start, end: Math.max(start, finite(element && element.end, end)) };
  }

  function isWholeVideo(element, duration) {
    const end = Math.max(0, finite(duration, 0));
    const span = windowOf(element, end);
    return span.start <= EPSILON && span.end >= end - EPSILON;
  }

  // 整片开关：开 = 删掉两个键（服务端因此回到「全片」语义），关 = 落成显式 0…片尾。
  function wholePatch(on, duration) {
    if (on) return { start: null, end: null };
    return { start: 0, end: tenth(Math.max(MIN_SPAN, finite(duration, 0))) };
  }

  // From 字段：不越过 end-MIN_SPAN，不小于 0。
  function startPatch(element, seconds, duration) {
    const span = windowOf(element, duration);
    return { start: tenth(Math.max(0, Math.min(finite(seconds, span.start), span.end - MIN_SPAN))) };
  }

  // To 字段：不小于 start+MIN_SPAN，不超过片尾。
  function endPatch(element, seconds, duration) {
    const end = Math.max(0, finite(duration, 0));
    const span = windowOf(element, end);
    return { end: tenth(Math.min(end, Math.max(finite(seconds, span.end), span.start + MIN_SPAN))) };
  }

  // 两端都由调用方给定时的钳制（整片开关关掉、拖块落地）：start 先进片内，end 再
  // 让出 MIN_SPAN。单独拖一端请用 startPatch / endPatch —— 那两个是拿**另一端**当
  // 界，这个是拿片长当界，混用会出现「拖左把手把右把手推走」。
  function spanPatch(element, next, duration) {
    const end = Math.max(0, finite(duration, 0));
    const span = windowOf(element, end);
    const start = Math.max(0, Math.min(finite(next && next.start, span.start), end - MIN_SPAN));
    const stop = Math.min(end, Math.max(finite(next && next.end, span.end), start + MIN_SPAN));
    return { start: tenth(start), end: tenth(stop) };
  }

  // 时间轴拖块：保持时长，整段限制在 [0, 片尾]。
  function movedSpan(element, deltaSeconds, duration) {
    const end = Math.max(0, finite(duration, 0));
    const span = windowOf(element, end);
    const length = Math.max(MIN_SPAN, span.end - span.start);
    const start = Math.max(0, Math.min(span.start + finite(deltaSeconds, 0), Math.max(0, end - length)));
    return { start: tenth(start), end: tenth(Math.min(end, start + length)) };
  }

  // 裁边：只动一端，另一端**不许被推走**（`side` 'l' | 'r'）。
  function resizedSpan(element, side, deltaSeconds, duration) {
    const span = windowOf(element, duration);
    const delta = finite(deltaSeconds, 0);
    if (side === 'l') {
      return { start: startPatch(element, span.start + delta, duration).start, end: tenth(span.end) };
    }
    return { start: tenth(span.start), end: endPatch(element, span.end + delta, duration).end };
  }

  // ---------- 补丁 ----------
  // 服务端 merge_patch 的镜像：两边都是对象则递归合并，patch 里的 null 删除键，
  // 其余情况整值替换。
  function mergePatch(base, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
    const target = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
    Object.keys(patch).forEach((key) => {
      const value = patch[key];
      if (value === null) {
        // 删除语义要**留在草稿里**（不是 delete）：草稿会再叠到投影上，
        // 那时才轮到 null 去删投影里的键。
        target[key] = null;
        return;
      }
      target[key] = mergePatch(target[key], value);
    });
    return target;
  }

  // 草稿叠加：把 `{id, set}` 合到投影的对应元素上，返回新的 tracks 数组
  // （不改原对象 —— 投影每次 memo 重建，但 store 之外还有人拿着旧引用比较）。
  function applyDraftToTracks(tracks, draft) {
    if (!Array.isArray(tracks) || !draft || !draft.id || !draft.set) return tracks || [];
    let hit = false;
    const next = tracks.map((track) => {
      const elements = (track && track.elements) || [];
      if (!elements.some((element) => element && element.id === draft.id)) return track;
      hit = true;
      return {
        ...track,
        elements: elements.map((element) => (element && element.id === draft.id
          ? stripNulls(mergePatch(element, draft.set))
          : element)),
      };
    });
    return hit ? next : tracks;
  }

  // 草稿里的 null 表示「删掉这个键」；叠加完要真的把它去掉，否则几何内核会把
  // `start: null` 读成 NaN 而不是缺省（元素直接从画面上消失）。
  function stripNulls(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const out = {};
    Object.keys(value).forEach((key) => {
      if (value[key] === null) return;
      out[key] = stripNulls(value[key]);
    });
    return out;
  }

  // ---------- 九宫对齐 ----------
  // 与原型 TfPosition 同一套：知道自己宽度（place.w）就按半宽贴边，否则给一个
  // 保守的内缩，按钮至少还能读出「靠左 / 居中 / 靠右」。
  function alignPlace(cell, element, ratio) {
    const place = (element && element.place) || {};
    const scale = finite(place.scale, 1);
    const halfW = finite(place.w, NaN);
    const half = Number.isFinite(halfW) ? Math.min(45, (halfW * scale) / 2) : 12;
    const aspect = finite(ratio, 16 / 9) || 16 / 9;
    const halfH = Math.min(45, half * aspect);
    switch (cell) {
      case 'left': return { x: tenth(half) };
      case 'center': return { x: 50 };
      case 'right': return { x: tenth(100 - half) };
      case 'top': return { y: tenth(halfH) };
      case 'middle': return { y: 50 };
      case 'bottom': return { y: tenth(100 - halfH) };
      default: return {};
    }
  }

  return {
    EPSILON,
    MIN_SPAN,
    alignPlace,
    applyDraftToTracks,
    endPatch,
    formatTime,
    isWholeVideo,
    mergePatch,
    movedSpan,
    parseTime,
    resizedSpan,
    spanPatch,
    startPatch,
    stripNulls,
    wholePatch,
    windowOf,
  };
});
