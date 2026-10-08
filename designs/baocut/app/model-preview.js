/* 第 143 轮：窗口也供文字的局部时钟使用；localSample 只取目标的候选阶段，
   复用 BC_TA.at，不推动全局播放头。以下是其它入口保留的第 122 轮背景。
   动画悬停预览的窗口与循环 —— §14.3（第 122 轮）。

   起因是用户那句「鼠标移到 Animation 列表的某一项，实时看到该动画效果」：此前原型
   走的是一套 CSS 假动画（`.anpk` / `[data-apv]`，第 58.2 轮），十几支形状折成八段
   keyframes，**它跟画面里那个元素真正会怎么动没有关系**——同名不同形（zoom 与
   burst 折成同一段）、时长恒 1.4s、播放头一动不动，其余元素也不跟着走。

   本轮换了做法：hover 时把这一支动画作为
   **临时属性**派给元素（不进文档、不进历史），静音，把播放头 seek 到该动画的窗口
   起点，用**真实播放器**播过去——所以舞台上其余元素、字幕、B-roll 天然同步在动。
   播到时长不撤回：用户要的是**反复循环**，所以多一条折返（`wrap`）。

   这一层只做纯计算，三件事：
     · `windowOf`  哪一段时间是「这支动画的第一帧到最后一帧」；
     · `wrap`      播过窗口末尾怎么折回起点；
     · `snapshot` / `restore`  进预览前把播放头 / 播放位 / 静音位存下来，退出时放回。
   加上 `zoomScale`——Zoom 是第四个槽，`BC_TA.at` 只认 in/out/loop 三槽，缩放的推进
   在这里求值（表由调用方给，避免这一层反向依赖 `BC_EL`）。 */
(function () {
  /** 首尾停留：0.3s = 设计系统那条 150ms 控件曲线的两倍。
      理由是「看得见首尾帧」与「一轮仍读成一个手势」这两条的交点——
      不留停留，淡入的最后一帧还没落稳就折回去了，看起来像在抖；
      留到 0.6s（一支入场的默认时长）则一轮要 1.2s，循环感就散了。 */
  const HOLD = 0.3;
  const DEF_DUR = 0.6;
  const DEF_PERIOD = 2;
  const DEF_SPEED = 1.2;

  const r3 = (v) => Math.round(v * 1000) / 1000;
  /** 文字那一族此前带 `t` 前缀（`tin` / `tout` / `tloop`，为的是折进另一批 keyframes）。
      keyframes 退场之后前缀没有用了，但旧调用点仍可能带着——一律归一。 */
  function normSlot(slot) {
    const s = String(slot || '');
    if (s === 'tin' || s === 'tout' || s === 'tloop') return s.slice(1);
    return s;
  }

  /** 这一支动画的播放窗口。
      · `in` / `zoom`：`start … start + 时长 + 停留`（先看第一帧，再看落稳的那一帧）
      · `out`：`end − 时长 − 停留 … end`（停留在头上：先看在位的样子，再看它走掉）
      · `loop`：`start … start + 一轮`（本来就是循环，不需要停留）
      · `cue` / `span`：整段（字幕逐词动效那一支——它的「一轮」就是这一条 cue）
      窗口一律夹在 `[start, end]` 内；夹不出正长度就返回 null（= 不进预览态）。 */
  function windowOf(o) {
    const opt = o || {};
    if (opt.k === 'none') return null;
    const slot = normSlot(opt.slot);
    const start = +opt.start || 0;
    const end = opt.end == null ? start : +opt.end;
    const span = end - start;
    if (!(span > 0)) return null;
    const hold = opt.hold == null ? HOLD : +opt.hold;
    let t0 = start;
    let t1 = end;
    if (slot === 'in' || slot === 'zoom') {
      t1 = start + Math.min(span, (opt.dur == null ? DEF_DUR : +opt.dur) + hold);
    } else if (slot === 'out') {
      t0 = end - Math.min(span, (opt.dur == null ? DEF_DUR : +opt.dur) + hold);
    } else if (slot === 'loop') {
      t1 = start + Math.min(span, opt.period == null ? DEF_PERIOD : +opt.period);
    } else if (slot !== 'cue' && slot !== 'span') {
      return null;
    }
    if (!(t1 > t0)) return null;
    return {t0: r3(t0), t1: r3(t1)};
  }

  /** 循环折返：播到 `t1` 就回 `t0`，超出多少就从 `t0` 起走多少（掉帧时不会卡在末尾）。 */
  function wrap(t, t0, t1) {
    const w = t1 - t0;
    if (!(w > 0)) return t0;
    if (t < t0) return t0;
    if (t < t1) return t;
    return t0 + ((t - t0) % w);
  }

  /** 进预览前存下来的三格：播放头、在不在播、静音位。**只有这三格**——
      预览不改文档，所以不需要存文档；改的就是这三样。 */
  function snapshot(s) {
    const v = s || {};
    return {playT: +v.playT || 0, playing: !!v.playing, muted: !!v.muted};
  }
  /** 退出预览时放回去的那一份。拿不到快照就返回 null，调用方据此什么都不做——
      「没有存过」与「存的是 0」必须分得开，否则一次误触会把播放头拽回片头。 */
  function restore(snap) {
    return snap ? snapshot(snap) : null;
  }

  /** Zoom 段的缩放系数。几段就依次推进（第 i 段从前面几段的时长之和处起步），
      各自缓出到自己的深度并停住；叠段是相乘，与目录里那句「依次推进，不是同时」一致。
      深度表由调用方给（`BC_EL.ZOOM_SCALE`），这一层不认识元素模型。 */
  function zoomScale(segs, t, table) {
    const tb = table || {};
    let base = 0;
    let sc = 1;
    (segs || []).forEach((z) => {
      const sp = (z && z.speed) || DEF_SPEED;
      if (z && z.k && z.k !== 'none') {
        const target = tb[z.k] == null ? 1 : tb[z.k];
        const p = t <= base ? 0 : t >= base + sp ? 1 : (t - base) / sp;
        sc *= 1 + (target - 1) * (1 - Math.pow(1 - p, 3));
      }
      base += sp;
    });
    return r3(sc);
  }

  /** 这份 anim 里有没有 Zoom 段。`BC_TA.isStatic` 只看 in/out/loop，
      只设了 Zoom 的元素会被它判成「不动」，画面上就永远推不起来。 */
  function hasZoom(anim) {
    const list = (anim && anim.zoom) || [];
    return list.some((z) => z && z.k && z.k !== 'none');
  }

  // Local previews share the real motion sampler, but only sample the candidate
  // phase. Their clock never becomes the editor's playhead.
  function localSample(peek, targetId, elapsed) {
    if (!peek || !peek.localWin || peek.targetId !== targetId) return null;
    const w = peek.localWin;
    const t = wrap(w.t0 + Math.max(0, elapsed || 0), w.t0, w.t1);
    return {anim: peek.patch, t: t - peek.span.start, duration: peek.span.end - peek.span.start};
  }

  window.BC_PREV = {windowOf, wrap, snapshot, restore, zoomScale, hasZoom, normSlot, localSample,
                    HOLD, DEF_DUR, DEF_PERIOD, DEF_SPEED};
})();
