/* 选中模型 —— 第 115 轮。
   ============================================================================
   在这一轮之前，选中真相是 `editor.jsx` 里的一个 `sel` 对象，而舞台判「这件东西
   选没选中」用的是**类型**（`selKind === e.kind`）：演示元素与用户新增元素走两条
   不同的判据，同类两件必然同时高亮，ON_DEMAND 那批元素还把「在不在画面上」跟
   「选没选中」绑成了一件事。这一份把选中收成一个**数组**，并且只按 id 判断。

   归一化后的 Sel：`{kind, id, trackId?, elKind?, member?, ...}`——`Object.assign`
   保留调用方挂上来的其它字段（`panel-elements.jsx` 的 `seed` 就骑在 sel 上走）。
   `key()` 给出可比较的字符串键：`kind:id[:trackId]`。

   多选只对 kind = element 开放（§1；2026-09-16 起没有 clip——项目原片是普通视频元素）：cue / subs / member 各自都带着
   "钻进去改这一件" 的语义，选两条没有对应的批量动作，一律退化成单选。
   ============================================================================ */
(function () {
  /* 允许多选的只有元素；其余 kind 在 add/toggle 下也只会落成单选。 */
  const MULTI_KINDS = ['element'];
  /* 帧步进：原型统一按 30fps 说话（§12.3 的时间码也是这一档）。 */
  const FRAME = 1 / 30;
  /* 粘贴每重复一次再偏 2%（§4）。 */
  const PASTE_STEP = 2;
  /* 位置微调的默认限位，与 `model-pose.js` 的 TEXT_LIMITS 同口径。 */
  const LIMITS = {x: [3, 97], y: [4, 96]};
  /* 框选的起拖阈值（px）：这以内仍然算一次点击（§6）。 */
  const MARQUEE_MIN = 4;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const round1 = (v) => Math.round(v * 10) / 10;

  const canMulti = (kind) => MULTI_KINDS.indexOf(kind) >= 0;

  /* 归一化：只补齐结构，不丢字段。 */
  const norm = (sel) => {
    if (!sel || !sel.kind) return null;
    return Object.assign({}, sel, {kind: sel.kind, id: sel.id == null ? null : sel.id});
  };

  const key = (sel) => {
    const s = norm(sel);
    if (!s) return '';
    return s.kind + ':' + (s.id == null ? '' : s.id) + (s.trackId ? ':' + s.trackId : '');
  };

  const keys = (sels) => (sels || []).map(key);
  const same = (a, b) => !!a && !!b && key(a) === key(b);
  const has = (sels, kind, id) => (sels || []).some((s) => s.kind === kind && s.id === id);
  /* primary = 最后一次点中的那件；所有只读 `ctx.sel` 的老面板都从这里取。 */
  const primary = (sels) => ((sels && sels.length) ? sels[sels.length - 1] : null);

  /* 去重并保序（后来的覆盖先前的同键项，位置取先出现的那次）。 */
  const dedupe = (sels) => {
    const seen = [];
    const out = [];
    (sels || []).forEach((raw) => {
      const s = norm(raw);
      if (!s) return;
      const k = key(s);
      const at = seen.indexOf(k);
      if (at >= 0) out[at] = s; else { seen.push(k); out.push(s); }
    });
    return out;
  };

  /* 一次点选：opts.add / opts.toggle 来自 shift 或 ⌘/ctrl。 */
  const apply = (sels, sel, opts) => {
    const s = norm(sel);
    if (!s) return [];
    const o = opts || {};
    if (!(o.add || o.toggle) || !canMulti(s.kind)) return [s];
    /* 混选里把不能多选的项先请出去（例如先选了字幕轨再 shift 点元素）。 */
    const base = (sels || []).filter((x) => canMulti(x.kind));
    const k = key(s);
    const at = keys(base).indexOf(k);
    if (at >= 0) {
      if (!o.toggle) return base;
      const out = base.slice();
      out.splice(at, 1);
      return out;
    }
    return base.concat([s]);
  };

  /* 全选：当前时间点可见的元素（end 为 null = 铺到片尾）。 */
  const visibleAt = (elements, t, dur) => (elements || []).filter((e) => {
    const end = e.end == null ? (dur == null ? Infinity : dur) : e.end;
    return t >= e.start && t <= end;
  });

  const normRect = (r) => ({
    x: Math.min(r.x, r.x + r.w), y: Math.min(r.y, r.y + r.h),
    w: Math.abs(r.w), h: Math.abs(r.h),
  });

  /* 框选命中：矩形相交（边贴边不算）。rects 形如 {id, x, y, w, h}。 */
  const hitRect = (rects, marquee) => {
    const m = normRect(marquee);
    return (rects || []).filter((r) => {
      const a = normRect(r);
      return a.x < m.x + m.w && m.x < a.x + a.w && a.y < m.y + m.h && m.y < a.y + a.h;
    }).map((r) => r.id);
  };

  /* ---------- 框选 ---------- */
  /* 起手到此刻的矩形。`on` 是「已经算拖拽了」——4px 以内仍然是一次普通点击，
     否则手一抖就把点空白清选变成了框选（§6）。 */
  const marqueeRect = (p0, p1) => {
    const r = normRect({x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y});
    return Object.assign(r, {on: Math.max(r.w, r.h) >= MARQUEE_MIN});
  };

  /* ---------- 多选统一框 ---------- */
  /* 一组盒（左上角口径）的并集。空集给 null——统一框不存在时不该画一个 0×0 的框。 */
  const boundsOf = (rects) => {
    const list = (rects || []).map(normRect);
    if (!list.length) return null;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    list.forEach((r) => {
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    });
    return {x: round1(x0), y: round1(y0), w: round1(x1 - x0), h: round1(y1 - y0)};
  };

  /* 整体平移：**先把位移夹到全组都合法**，再逐件加同一个 delta。逐件各夹各的会把
     组拖变形——先撞到边的那件停下，其余继续走。 */
  const groupShift = (centers, dx, dy, limits) => {
    const L = limits || LIMITS;
    let lo = -Infinity; let hi = Infinity; let lo2 = -Infinity; let hi2 = Infinity;
    (centers || []).forEach((c) => {
      lo = Math.max(lo, L.x[0] - c.x); hi = Math.min(hi, L.x[1] - c.x);
      lo2 = Math.max(lo2, L.y[0] - c.y); hi2 = Math.min(hi2, L.y[1] - c.y);
    });
    if (!(centers || []).length) return {dx: 0, dy: 0};
    return {dx: round1(clamp(dx, lo, hi)), dy: round1(clamp(dy, lo2, hi2))};
  };

  /* 四角等比缩放：绕统一框的中心缩，每件的中心与自身倍率同乘一个 f。 */
  const groupScale = (items, center, f) => (items || []).map((it) => ({
    id: it.id,
    x: round1(center.x + (it.x - center.x) * f),
    y: round1(center.y + (it.y - center.y) * f),
    scale: Math.round(clamp((it.scale == null ? 1 : it.scale) * f, 0.1, 5) * 1000) / 1000,
  }));

  /* ---------- 播放态迁移 ---------- */
  /* 播放开始时退出编辑、清空选中（§2）；暂停不动选中——刚拖完一件按空格看效果，
     回来那件还该是选中的。 */
  const playState = (prev, playing) => (playing
    ? {sels: [], editing: null}
    : {sels: (prev && prev.sels) || [], editing: (prev && prev.editing) || null});

  /* ---------- 删除的对象 ----------
     Delete 键与 transport 的删除钮共用这一条判据：选中里有元素就删元素（多件一并），
     否则主选是字幕轨就拿下那条轨；字幕条（cue）与空选都不删。返回 null 表示没有可删的。
     文稿剪辑的选区不在 sels 里（product-design §5.7：同一个删除键不跨模式生效）。 */
  const removeTarget = (sels, primarySel) => {
    const ids = (sels || []).filter((s) => s.kind === 'element').map((s) => s.id);
    if (ids.length) return {kind: 'elements', ids};
    const s = primarySel;
    if (s && s.kind === 'subs') return {kind: 'subs', trackId: s.trackId};
    return null;
  };

  /* ---------- 剪贴板 ---------- */
  const pasteId = (srcId, n) => String(srcId).replace(/-copy-\d+$/, '') + '-copy-' + n;

  const pasteOffset = (pose, n) => Object.assign({}, pose, {
    x: round1(clamp((pose && pose.x != null ? pose.x : 50) + PASTE_STEP * n, LIMITS.x[0], LIMITS.x[1])),
    y: round1(clamp((pose && pose.y != null ? pose.y : 50) + PASTE_STEP * n, LIMITS.y[0], LIMITS.y[1])),
  });

  /* 时间：播放头落在源元素时段里就原地粘，落在外面就搬到播放头并保长。 */
  const pasteSpan = (el, playT, dur) => {
    const end = el.end == null ? (dur == null ? Infinity : dur) : el.end;
    if (playT >= el.start && playT <= end) return {start: el.start, end: el.end};
    if (el.end == null) return {start: playT, end: null};
    const len = el.end - el.start;
    const start = clamp(playT, 0, dur == null ? playT : Math.max(0, dur - len));
    return {start: round1(start), end: round1(start + len)};
  };

  /* ---------- 时间轴点选的跟随 ---------- */
  /* 在时间轴上点一条 = 「我要看这一件」。播放头不在它的时段里，舞台上根本画不出这件
     东西，选中了也只有一圈空手柄——所以点选要把播放头带过去（§7）。带到 `start` 会
     正好压在边界上（`t >= start && t <= end` 的两端都算，但 `start` 那一刻元素往往还
     没画出来），所以再进一帧。已经在时段内则原地不动：不该因为点一下就跳走。
     `end == null` 与 `pasteSpan` 同口径：铺到片尾。 */
  const seekForSel = (span, playT, dur, mods) => {
    /* 追加 / 移出选择（shift / ⌘）不带播放头：那一枪问的是「这一件算不算在内」，
       不是「我要看这一件」；每加一件都跳一次画面反而看不清自己选了什么。 */
    if (mods && (mods.add || mods.toggle)) return null;
    if (!span || span.start == null) return null;
    const end = span.end == null ? (dur == null ? Infinity : dur) : span.end;
    if (playT >= span.start && playT <= end) return null;
    return Math.min(span.start + FRAME, end);
  };

  /* ---------- 键盘微调 ---------- */
  const nudge = (pose, dx, dy, limits) => {
    const L = limits || LIMITS;
    const p = pose || {};
    return Object.assign({}, p, {
      x: round1(clamp((p.x == null ? 50 : p.x) + dx, L.x[0], L.x[1])),
      y: round1(clamp((p.y == null ? 50 : p.y) + dy, L.y[0], L.y[1])),
    });
  };

  /* 播放头步进：一帧，按住 ⇧ 一秒。 */
  const frameStep = (t, dir, opts) => {
    const o = opts || {};
    const step = o.shift ? 1 : FRAME;
    return clamp(t + dir * step, 0, o.dur == null ? Infinity : o.dur);
  };

  Object.assign(window, {
    BC_SELECT: {
      MULTI_KINDS, FRAME, PASTE_STEP, LIMITS, MARQUEE_MIN,
      canMulti, norm, key, keys, same, has, primary, dedupe, apply,
      visibleAt, normRect, hitRect, marqueeRect, boundsOf, groupShift, groupScale, playState,
      seekForSel, removeTarget,
      pasteId, pasteOffset, pasteSpan, nudge, frameStep,
    },
  });
})();
