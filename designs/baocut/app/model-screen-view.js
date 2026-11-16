/* 编辑录制的纯模型：window.BC_SV（屏幕录制设计 docs/design/screen-recording §5「录完之后怎么编辑」，
   视频格式规范 §3.18 联动组、§4.9 屏幕取景）。无 React、无 DOM，App 与 Web 两端都加载。
   对照实现 packages/ui/src/model/screen-view.ts；原型把取景文档放在元素状态表 `elDocs` 的 `sv:<文档 id>` 一格里
   （撤销跟着元素状态走），时刻都用秒，不用整数刻度。

   取景文档 `{zooms, follow, pointer}`：
     · `zooms`：按 t0 排好、互不重叠的缩放区间 `{id, t0, t1, scale, focus, origin, edited, rampIn, rampOut}`，时刻在录制时钟上；
       `focus` 是 `{kind: 'pointer'}`（跟随鼠标）或 `{kind: 'point', x, y}`（固定看一点，画面的 0–1 坐标）；
       `origin` 是 'auto'（按点击生成）或 'manual'；自动区间被改过就记 `edited`，重新生成时留着。
     · `follow`：跟随鼠标的安全区与平滑（缺省都是 0.5）。
     · `pointer`：光标大小、静止后隐去的秒数、点击提示。
   屏幕实例（视频元素，`role: 'screen'`）的源时间就是录制时间：序列时刻 = start + (录制时刻 − srcStart) / rate。 */
(function () {
  const ZOOM_MIN = 1.1;
  const ZOOM_MAX = 8;
  const ZOOM_DEFAULT = 2;
  const ZOOM_MIN_SECONDS = 0.2;
  const RAMP_MAX = 2;
  const POINTER_SIZE_MIN = 0.25;
  const POINTER_SIZE_MAX = 4;
  const IDLE_MAX = 10;
  const EPS = 1e-6;

  const r2 = (v) => Math.round(v * 100) / 100;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** 取景文档在元素状态表里的那一格。 */
  const docKey = (viewId) => 'sv:' + viewId;
  /** 读一份取景文档；状态表里还没有时用元素上带来的初值。 */
  function viewOf(docs, viewId, seed) {
    const own = (docs || {})[docKey(viewId)];
    return own && Array.isArray(own.zooms) ? own : (seed || {zooms: []});
  }

  /* ---------- 时钟 ---------- */

  const rateOf = (el) => (el && el.rate > 0 ? el.rate : 1);
  /** 屏幕实例：录制时刻 → 序列时刻。 */
  const toSequence = (el, content) => el.start + (content - (el.srcStart || 0)) / rateOf(el);
  /** 屏幕实例：序列时刻 → 录制时刻。 */
  const toContent = (el, time) => (el.srcStart || 0) + (time - el.start) * rateOf(el);

  /** 一段缩放在各个屏幕实例里看得见的部分（序列时间）。拆开、挪开之后各段只画自己源区间里的那一截。 */
  function placeZooms(view, screens) {
    const out = [];
    (screens || []).forEach((el) => {
      if (el.end == null) return;
      (view.zooms || []).forEach((z) => {
        const a = toSequence(el, z.t0);
        const b = toSequence(el, z.t1);
        const start = Math.max(a, el.start);
        const end = Math.min(b, el.end);
        if (end - start <= EPS) return;
        out.push({key: el.id + ':' + z.id, zoom: z, elId: el.id, start, end, clipStart: start > a + EPS, clipEnd: end < b - EPS});
      });
    });
    return out.sort((x, y) => x.start - y.start);
  }

  /** 点击（录制时刻）投到序列上；落在实例外的不画。 */
  function placeClicks(clicks, screens) {
    const out = [];
    (screens || []).forEach((el) => {
      (clicks || []).forEach((c, i) => {
        const t = toSequence(el, c.t);
        if (t < el.start - EPS || t > el.end + EPS) return;
        out.push({key: el.id + ':c' + i, t, click: c, elId: el.id});
      });
    });
    return out.sort((a, b) => a.t - b.t);
  }

  /** 序列时刻 `time` 上正在起作用的缩放（看的是播放头下那一段屏幕实例），没有返回 null。 */
  function zoomAt(view, screens, time) {
    const el = (screens || []).find((s) => time >= s.start - EPS && time < s.end);
    if (!el) return null;
    const c = toContent(el, time);
    return (view.zooms || []).find((z) => c >= z.t0 && c < z.t1) || null;
  }

  /* ---------- 区间的增删改 ---------- */

  /** 一段缩放的两端能挪到哪里（录制时刻）：不与前后两段重叠。 */
  function zoomRoom(view, id) {
    const zs = view.zooms || [];
    const i = zs.findIndex((z) => z.id === id);
    return {min: i > 0 ? zs[i - 1].t1 : 0, max: i >= 0 && i + 1 < zs.length ? zs[i + 1].t0 : Infinity};
  }

  const clampScale = (s) => r2(clamp(s, ZOOM_MIN, ZOOM_MAX));
  const clampRamp = (s) => r2(clamp(s, 0, RAMP_MAX));

  /**
   * 改一段缩放，返回新的取景文档（没变化时原样返回）。`patch` 可带 t0 / t1 / scale / focus / rampIn / rampOut
   * （rampIn / rampOut 为 null 时去掉）；`move: true` 表示整段平移（长度不变，撞到邻居就停）。
   * 时刻夹在前后两段之间、至少 ZOOM_MIN_SECONDS 长；自动生成、还没改过的区间同时记上 `edited`。
   */
  function patchZoom(view, id, patch, opts) {
    const zs = view.zooms || [];
    const z = zs.find((x) => x.id === id);
    if (!z) return view;
    const p = patch || {};
    const room = zoomRoom(view, id);
    let t0 = p.t0 != null ? p.t0 : z.t0;
    let t1 = p.t1 != null ? p.t1 : z.t1;
    if (opts && opts.move) {
      const len = z.t1 - z.t0;
      t0 = clamp(t0, room.min, room.max - len);
      t1 = t0 + len;
    } else {
      t0 = Math.max(room.min, t0);
      t1 = Math.min(room.max, t1);
      if (t1 - t0 < ZOOM_MIN_SECONDS) {
        if (p.t0 != null && p.t1 == null) t0 = t1 - ZOOM_MIN_SECONDS;
        else t1 = t0 + ZOOM_MIN_SECONDS;
      }
    }
    const next = Object.assign({}, z, {t0: r3(t0), t1: r3(t1)});
    if (p.scale != null) next.scale = clampScale(p.scale);
    if (p.focus) next.focus = p.focus.kind === 'point' ? {kind: 'point', x: r3(clamp(p.focus.x, 0, 1)), y: r3(clamp(p.focus.y, 0, 1))} : {kind: 'pointer'};
    ['rampIn', 'rampOut'].forEach((k) => {
      if (p[k] === null) delete next[k];
      else if (p[k] != null) next[k] = clampRamp(p[k]);
    });
    const same = ['t0', 't1', 'scale', 'rampIn', 'rampOut'].every((k) => next[k] === z[k])
      && JSON.stringify(next.focus) === JSON.stringify(z.focus);
    if (same) return view;
    if (z.origin === 'auto' && !z.edited) next.edited = true;
    return Object.assign({}, view, {zooms: zs.map((x) => (x.id === id ? next : x))});
  }

  /**
   * 在录制时刻 [t0, t1) 加一段手动缩放：夹进所在的空档；起点压在已有区间上、或夹完不够长时返回 null。
   * 返回 {view, id}。
   */
  function addZoom(view, t0, t1, id) {
    const zs = view.zooms || [];
    const from = Math.max(0, Math.min(t0, t1));
    let to = Math.max(t0, t1);
    if (zs.some((z) => from >= z.t0 - EPS && from < z.t1)) return null;
    const next = zs.find((z) => z.t0 >= from);
    if (next) to = Math.min(to, next.t0);
    if (to - from < ZOOM_MIN_SECONDS) return null;
    const zoom = {id, t0: r3(from), t1: r3(to), scale: ZOOM_DEFAULT, focus: {kind: 'pointer'}, origin: 'manual'};
    const list = zs.concat([zoom]).sort((a, b) => a.t0 - b.t0);
    return {view: Object.assign({}, view, {zooms: list}), id};
  }

  function removeZoom(view, id) {
    return Object.assign({}, view, {zooms: (view.zooms || []).filter((z) => z.id !== id)});
  }

  /** 按点击生成自动缩放：相隔不到 `gap` 秒的点击并成一段，从第一下前 0.6 秒到最后一下后 1.6 秒，2 倍、跟随鼠标。 */
  function autoZooms(clicks, opts) {
    const o = opts || {};
    const gap = o.gap == null ? 3 : o.gap;
    const dur = o.duration == null ? Infinity : o.duration;
    const list = (clicks || []).slice().sort((a, b) => a.t - b.t);
    const groups = [];
    list.forEach((c) => {
      const g = groups[groups.length - 1];
      if (g && c.t - g[g.length - 1].t <= gap) g.push(c);
      else groups.push([c]);
    });
    const out = [];
    groups.forEach((g, i) => {
      const t0 = Math.max(0, g[0].t - 0.6);
      const t1 = Math.min(dur, g[g.length - 1].t + 1.6);
      const prev = out[out.length - 1];
      const from = prev ? Math.max(t0, prev.t1) : t0;
      if (t1 - from < ZOOM_MIN_SECONDS) return;
      out.push({id: (o.prefix || 'auto') + (i + 1), t0: r3(from), t1: r3(t1), scale: ZOOM_DEFAULT, focus: {kind: 'pointer'}, origin: 'auto'});
    });
    return out;
  }

  /** 重新生成：只替换没被改过的自动区间，改过的与手动加的留着；新区间压到留着的那些上时不要。 */
  function regenerate(view, clicks, opts) {
    const kept = (view.zooms || []).filter((z) => z.origin !== 'auto' || z.edited);
    const fresh = autoZooms(clicks, opts).filter((z) => !kept.some((k) => z.t0 < k.t1 && z.t1 > k.t0));
    const zooms = kept.concat(fresh).sort((a, b) => a.t0 - b.t0);
    return {view: Object.assign({}, view, {zooms}), added: fresh.length, kept: kept.length};
  }

  /** 来源标签：自动 / 自动 · 改过 / 手动。 */
  const originLabel = (z) => (z.origin === 'manual' ? '手动' : z.edited ? '自动 · 改过' : '自动');
  /** 时间线块与检查器的样式档：auto / edited / manual。 */
  const originTone = (z) => (z.origin === 'manual' ? 'manual' : z.edited ? 'edited' : 'auto');
  /** 第几段（检查器列表的名字「缩放 N」）。 */
  const zoomName = (view, id) => '缩放 ' + ((view.zooms || []).findIndex((z) => z.id === id) + 1);
  const scaleLabel = (s) => r2(s) + '×';

  /* ---------- 取景框（舞台上「固定看一点」那块框） ---------- */

  /** 缩放 `scale` 倍、看 (x, y) 时露出的那块画面（0–1 坐标，左上角 + 宽高），夹在画面里。 */
  function framingRect(focus, scale) {
    const s = clamp(scale || ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX);
    const w = 1 / s, h = 1 / s;
    const cx = focus && focus.kind === 'point' ? focus.x : 0.5;
    const cy = focus && focus.kind === 'point' ? focus.y : 0.5;
    return {x: r3(clamp(cx - w / 2, 0, 1 - w)), y: r3(clamp(cy - h / 2, 0, 1 - h)), w: r3(w), h: r3(h)};
  }
  /** 框的左上角挪到 (x, y)（0–1）之后的看点。 */
  function focusFromRect(x, y, scale) {
    const w = 1 / clamp(scale || ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX);
    return {kind: 'point', x: r3(clamp(x, 0, 1 - w) + w / 2), y: r3(clamp(y, 0, 1 - w) + w / 2)};
  }

  /* ---------- 跟随与光标 ---------- */

  const followValue = (view, key) => {
    const v = view.follow && view.follow[key];
    return v == null ? 0.5 : v;
  };
  function setFollow(view, key, value) {
    const v = key === 'safeArea' ? clamp(value, 0, 0.95) : clamp(value, 0, 1);
    return Object.assign({}, view, {follow: Object.assign({}, view.follow, {[key]: r2(v)})});
  }
  const POINTER_DEFAULTS = {size: 1, idleHide: 2, ripple: true};
  const pointerValue = (view, key) => {
    const v = view.pointer && view.pointer[key];
    return v == null ? POINTER_DEFAULTS[key] : v;
  };
  function setPointer(view, key, value) {
    let v = value;
    if (key === 'size') v = r2(clamp(value, POINTER_SIZE_MIN, POINTER_SIZE_MAX));
    if (key === 'idleHide') v = r2(clamp(value, 0, IDLE_MAX));
    return Object.assign({}, view, {pointer: Object.assign({}, view.pointer, {[key]: v})});
  }
  /** 光标那一组能不能改：清单说光标录进了画面（baked）或没有光标（none）时不能，检查器整组置灰、写明原因。 */
  function pointerNote(mode) {
    if (mode === 'baked') return '光标录进了画面里，不能隐藏、放大或换样式。';
    if (mode === 'none') return '这次录制没有光标。';
    return '';
  }

  /* ---------- 联动组（视频格式规范 §3.18） ---------- */

  /** 元素现在所在的联动组：状态表里写过（解组后是 null）就听它，否则看元素自己带来的。 */
  function linkOf(el, docs) {
    if (!el) return null;
    const d = (docs || {})[el.id];
    if (d && Object.prototype.hasOwnProperty.call(d, 'link')) return d.link || null;
    return el.link || null;
  }
  /** 组里的元素 id。 */
  function groupMembers(elements, docs, link) {
    if (!link) return [];
    return (elements || []).filter((e) => linkOf(e, docs) === link).map((e) => e.id);
  }
  /** 这几件加上它们所在联动组的其余成员（拖动时整组一起动）。 */
  function withLinked(elements, docs, ids) {
    const groups = new Set((ids || []).map((id) => linkOf((elements || []).find((e) => e.id === id), docs)).filter(Boolean));
    if (!groups.size) return (ids || []).slice();
    const out = new Set(ids);
    (elements || []).forEach((e) => { const l = linkOf(e, docs); if (l && groups.has(l)) out.add(e.id); });
    return Array.from(out);
  }
  /**
   * 整组拆分的计划：时刻 `t` 穿过的成员各切一刀；切出来的右半与整段都在 `t` 右边的成员换进新组 `newLink`
   * （同一次录制），整段在左边的留在原组。返回 {cut: [成员 id], relink: [整段在右边的 id]}；`t` 一件都没穿过时 null。
   */
  function splitPlan(elements, docs, link, t) {
    const members = (elements || []).map((e) => Object.assign({}, e, (docs || {})[e.id])).filter((e) => linkOf(e, docs) === link);
    const cut = members.filter((e) => e.end != null && t - e.start > EPS && e.end - t > EPS).map((e) => e.id);
    if (!cut.length) return null;
    const relink = members.filter((e) => e.start >= t - EPS).map((e) => e.id);
    return {cut, relink};
  }

  /* ---------- 摄像头布局与演示样式（屏幕录制设计 §5） ---------- */

  const CAMERA_LAYOUTS = [
    {k: 'corner-circle', label: '圆形 · 右下角'},
    {k: 'corner-rounded', label: '圆角矩形 · 左下角'},
    {k: 'split', label: '左右分屏'},
    {k: 'camera-full', label: '摄像头全屏'},
    {k: 'hidden', label: '隐藏'},
  ];
  const ROUND = 999;   // 圆形：圆角大过半边就是正圆

  /**
   * 套一种摄像头布局：返回要写进状态表的几笔 `[{id, patch}]`。摆位是画布的百分比，`canvasRatio` 是画布宽 / 高，
   * 用来把方块与 4:3 的框换成高度百分比（不然圆会是椭圆）。左右分屏同时把屏幕摆到左半边；
   * 从左右分屏换到别的布局时屏幕回到全屏。
   */
  function cameraLayoutPatches(layout, camera, screens, canvasRatio) {
    const ratio = canvasRatio > 0 ? canvasRatio : 16 / 9;
    const out = [];
    const show = {hidden: false};
    const screensBack = () => (screens || []).forEach((s) => {
      const p = s.pose || {};
      if (p.w === 50 && p.x === 25) out.push({id: s.id, patch: {pose: Object.assign({}, p, {x: 50, y: 50, w: 100, h: 100})}});
    });
    const pose = (x, y, w, h) => Object.assign({}, camera.pose, {x, y, w, h: r2(h)});
    const style = (radius) => Object.assign({}, camera.style, {radius, round: false});
    if (layout === 'hidden') return [{id: camera.id, patch: {hidden: true}}];
    if (layout === 'corner-circle') {
      screensBack();
      out.push({id: camera.id, patch: Object.assign({}, show, {pose: pose(85, 78, 20, 20 * ratio), style: style(ROUND)})});
    } else if (layout === 'corner-rounded') {
      screensBack();
      out.push({id: camera.id, patch: Object.assign({}, show, {pose: pose(17, 78, 26, 26 * ratio * 3 / 4), style: style(24)})});
    } else if (layout === 'split') {
      out.push({id: camera.id, patch: Object.assign({}, show, {pose: pose(75, 50, 50, 100), style: style(0)})});
      (screens || []).forEach((s) => out.push({id: s.id, patch: {pose: Object.assign({}, s.pose, {x: 25, y: 50, w: 50, h: 100})}}));
    } else if (layout === 'camera-full') {
      out.push({id: camera.id, patch: Object.assign({}, show, {pose: pose(50, 50, 100, 100), style: style(0)})});
    }
    return out;
  }
  /** 摄像头现在是哪一种布局；对不上任何预设（用户自己拖过）时 null，界面显示「自定义」。 */
  function cameraLayoutOf(camera) {
    if (!camera) return null;
    if (camera.hidden) return 'hidden';
    const p = camera.pose || {};
    const radius = (camera.style || {}).radius;
    if (p.x === 85 && p.y === 78 && p.w === 20 && radius === ROUND) return 'corner-circle';
    if (p.x === 17 && p.y === 78 && p.w === 26 && radius === 24) return 'corner-rounded';
    if (p.x === 75 && p.y === 50 && p.w === 50) return 'split';
    if (p.x === 50 && p.y === 50 && p.w === 100) return 'camera-full';
    return null;
  }

  const PRESENTATIONS = [{k: 'full', label: '全屏'}, {k: 'inset', label: '缩小留边'}];
  const INSET_W = 86;
  const INSET_RADIUS = 16;
  /** 屏幕的演示样式：全屏，或缩小留边、圆角、投影（底色是画布底色）。返回 {pose, style} 的补丁。 */
  function presentationPatch(styleKey, screen) {
    const pose = Object.assign({}, screen.pose);
    const style = Object.assign({}, screen.style);
    if (styleKey === 'inset') {
      Object.assign(pose, {x: 50, y: 50, w: INSET_W, h: INSET_W});
      Object.assign(style, {radius: INSET_RADIUS, round: false, insetShadow: true});
    } else {
      Object.assign(pose, {x: 50, y: 50, w: 100, h: 100});
      Object.assign(style, {radius: 0, round: false});
      delete style.insetShadow;
    }
    return {pose, style};
  }
  function presentationOf(screen) {
    const p = (screen && screen.pose) || {};
    const st = (screen && screen.style) || {};
    if (p.w === INSET_W && st.radius === INSET_RADIUS) return 'inset';
    if (p.w === 100 && p.x === 50 && p.y === 50) return 'full';
    return null;
  }

  /* ---------- 录制的各路 → 时间线元素 ---------- */

  const ROLE_LABEL = {screen: '屏幕', camera: '摄像头', microphone: '麦克风', 'system-audio': '系统音频'};
  const roleLabel = (role) => ROLE_LABEL[role] || '';

  /**
   * 一次录制落到时间线上的元素：屏幕、摄像头（右下角圆形）两件视频，麦克风、系统音频两件音频，同一个联动组；
   * 屏幕带着取景文档的 id。`at` 是放在序列上的起点，`ids` 给每一路的元素 id 加前缀。
   */
  function recordingElements(rec, opts) {
    const o = opts || {};
    const at = o.at || 0;
    const pre = o.prefix || 'rec-';
    const ratio = o.canvasRatio > 0 ? o.canvasRatio : 16 / 9;
    const dur = rec.duration;
    const link = o.link || rec.link;
    const base = {start: at, end: at + dur, srcStart: 0, added: true, recording: rec.id, link};
    const out = [];
    const s = rec.streams || {};
    if (s.screen) out.push(Object.assign({}, base, {id: pre + 'screen', kind: 'video', icon: 'video', name: '屏幕', role: 'screen',
      asset: s.screen.asset, screenView: rec.view, layer: 0, fromSource: !o.at,
      place: {x: 50, y: 50, w: 100, h: 100, scale: 1, rot: 0}, style: {vol: 100, radius: 0}}));
    if (s.camera) out.push(Object.assign({}, base, {id: pre + 'camera', kind: 'video', icon: 'video', name: '摄像头', role: 'camera',
      asset: s.camera.asset, layer: 1,
      place: {x: 85, y: 78, w: 20, h: r2(20 * ratio), scale: 1, rot: 0}, style: {vol: 0, radius: ROUND, round: false}}));
    if (s.microphone) out.push(Object.assign({}, base, {id: pre + 'mic', kind: 'audio', icon: 'mic', name: '麦克风', role: 'microphone',
      asset: s.microphone.asset}));
    if (s.system) out.push(Object.assign({}, base, {id: pre + 'system', kind: 'audio', icon: 'vol2', name: '系统音频', role: 'system-audio',
      asset: s.system.asset}));
    return out;
  }

  window.BC_SV = {
    ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT, ZOOM_MIN_SECONDS, RAMP_MAX, POINTER_SIZE_MIN, POINTER_SIZE_MAX, IDLE_MAX,
    docKey, viewOf, toSequence, toContent, placeZooms, placeClicks, zoomAt,
    zoomRoom, patchZoom, addZoom, removeZoom, autoZooms, regenerate,
    originLabel, originTone, zoomName, scaleLabel, framingRect, focusFromRect,
    followValue, setFollow, pointerValue, setPointer, pointerNote,
    linkOf, groupMembers, withLinked, splitPlan,
    CAMERA_LAYOUTS, cameraLayoutPatches, cameraLayoutOf, PRESENTATIONS, presentationPatch, presentationOf,
    ROLE_LABEL, roleLabel, recordingElements,
  };
})();
