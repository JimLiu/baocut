/* BaoCut 原型 — 时间轴几何
   window.BC_TL。纯函数，无 React、无 DOM。

   一切横向几何 = 8 + t × pxps（§12.1，Descript 的 --tl-pps 模型）。
   pxps 是真相值：默认 20 = 100%，范围 [min(4.4, 整片入镜), 80]，± 走 ×÷1.5（§12.4）。
   刻度步长取 [1,2,5,10,15,30,60,120,300] 中首个满足 step×pxps ≥ 90px（Mac 规则，§12.5）。

   常量与 apps/baocut/src/adapters/timeline.rs 同源；那边是 Rust，这边是这一份。 */
(function () {
  const PAD = 8;                       // 左右内边距，px(t) 的常数项
  const PXPS_DEFAULT = 20;             // = 100%
  const PXPS_MAX = 80;
  const PXPS_FIT_206 = 4.4;            // 206s 撑满 906px 视口（§12.4）
  const ZOOM_FACTOR = 1.5;
  const PXPS_PLAYHEAD = 40;
  const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300];
  const TICK_MIN_PX = 90;

  const HEADS_W = 144;                  // sticky 行头列
  const RULER_H = 22;
  const CHAPTER_BAND_H = 13;
  const TRANSPORT_H = 46;
  const TRACKS_ORIGIN_Y = CHAPTER_BAND_H + TRANSPORT_H;   // = 59（W3 起 transport 在上）
  const MIN_HEIGHT = CHAPTER_BAND_H + TRANSPORT_H + 1;    // = 60（§10 第三条缝的下限）
  const DEFAULT_HEIGHT = 246;

  // subs 恒为展开态 46（要放得下两行译文）。第 39.3 轮做的「合并带 34 ↔ 展开 46」
  // 两态于第 105 轮退役：时间轴不随右栏 Tab 改变，这条不变式优先。
  /* 没有 `clips` 行（2026-09-16）：项目原片是普通视频元素，走 `video` 那一档。 */
  const ROW_H = {element: 30, video: 74, text: 34, member: 24, template: 30, subs: 46, audio: 56, music: 30, dub: 40, bed: 30};
  const languageBadge = (lang) => {
    const code = String(lang || '').split(/[-_]/)[0].toUpperCase();
    return code === 'JA' ? 'JP' : code.slice(0, 3);
  };

  // 行头显示轨道类别，素材文件名留在块内与悬停说明（product-design §5.1）。
  function headLabel(row) {
    const r = row || {};
    const lang = r.track?.lang || r.dub?.lang;
    const code = String(lang || '').split(/[-_]/)[0].toLowerCase();
    const language = ({zh:'中文', en:'英文', ja:'日文', ko:'韩文', fr:'法文', de:'德文', es:'西文'})[code] || languageBadge(lang);
    if (r.kind === 'subs') return language ? '字幕 · ' + language : '字幕';
    if (r.kind === 'transcript') return '文稿';
    if (r.kind === 'dub') return (r.dub?.role === 'narration' ? '旁白' : '配音') + (language ? ' · ' + language : '');
    if (r.member) return r.member.name || '文字';
    const kind = r.elKind || r.el?.kind || r.kind;
    return ({video:'视频', image:'图片', text:'文字', textgroup:'文字组', template:'模板', tpl:'模板',
      sticker:'贴纸', whiteboard:'白板', music:'音乐', bed:'背景声', audio:r.split ? '原声' : '音频'})[kind] || r.label || r.el?.name || '元素';
  }

  const px = (t, pxps) => PAD + t * pxps;
  const timeAt = (x, pxps) => (x - PAD) / pxps;
  /* 播放头的横坐标取整到设备像素：竖线按整像素画、小旗的斜边按亚像素抗锯齿，不取整时两者各自舍入，
     移动中相差在 ±1px 间来回跳；线与旗用同一个取整后的值，相对位置就恒定。 */
  const devicePx = (x, dpr) => {
    const r = dpr > 0 ? dpr : 1;
    return Math.round(x * r) / r;
  };
  const contentWidth = (dur, pxps) => PAD * 2 + dur * pxps;

  /* 空白项目的开放尾巴（第 216 轮）：没有主素材的项目时长 = 内容末端，标尺与
     滚动区在末端之外再多画 10s，播放头才落得到最后一个元素之后——否则新元素
     永远只能贴在末尾。有主素材的项目时长封死在素材长度，这里原样返回。 */
  const BLANK_TAIL = 10;
  const BLANK_ROW_H = 64;              // 零泳道时的占位行（不是泳道，不进 rows）
  const displayDuration = (dur, openEnded) => openEnded ? (dur || 0) + BLANK_TAIL : dur;

  const PLAYBACK_FOLLOW_ENTRY_MS = 250;

  /** 把横向滚动夹在真实内容范围内。 */
  function clampedScrollOffset(desired, width, viewportWidth) {
    return Math.max(0, Math.min(desired, Math.max(0, width - Math.max(0, viewportWidth))));
  }

  /** 播放头锁在可滚动内容视口中线时的偏移。 */
  function centeredScrollOffset(playheadX, width, viewportWidth) {
    return clampedScrollOffset(playheadX - Math.max(0, viewportWidth) / 2, width, viewportWidth);
  }

  /**
   * 播放从视口任意位置起步：可见的左半边（0..中线）先让播放头走到中线；右半边
   * 或视口外（含左侧外，例如播放中往回跳转）在 250ms 内让时间轴滚动追上播放头。
   * settled 后调用方改走普通中线锁定。
   */
  function playbackFollowScrollOffset(
    playheadX, currentScroll, width, viewportWidth, startScreenX, progress,
  ) {
    const current = clampedScrollOffset(currentScroll, width, viewportWidth);
    const target = centeredScrollOffset(playheadX, width, viewportWidth);
    const center = Math.max(0, viewportWidth) / 2;
    const start = Number.isFinite(startScreenX) ? startScreenX : playheadX - current;

    if (start >= 0 && start <= center) {
      const screenX = playheadX - current;
      if (screenX + 0.01 < center && target <= current + 0.01) {
        return {scroll: current, settled: false};
      }
      return {scroll: target, settled: true};
    }

    const p = Number.isFinite(progress) ? Math.max(0, Math.min(progress, 1)) : 1;
    const eased = p * p * (3 - 2 * p);
    const screenX = start + (center - start) * eased;
    return {
      scroll: clampedScrollOffset(playheadX - screenX, width, viewportWidth),
      settled: p >= 1,
    };
  }

  /** 刻度步长：首个让一格宽 ≥ 90px 的档；都不够就取最大档 */
  function tickStep(pxps) {
    for (const s of TICK_STEPS) if (s * pxps >= TICK_MIN_PX) return s;
    return TICK_STEPS[TICK_STEPS.length - 1];
  }

  /** 标尺刻度列表（含 0，不超过 dur） */
  function ticks(dur, pxps) {
    const step = tickStep(pxps);
    const out = [];
    for (let t = 0; t <= dur + 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
    return out;
  }

  /* 缩放下限 = min(固定下限 PXPS_FIT_206, 实际时长在当前视口里「适应窗口」的 pxps)：
     短视频照旧停在 4.4，长视频总能缩到整片入镜（可以小于 1%）。 */
  /** 让 dur 正好铺满 viewportW（泳道视口，不含行头列）的 pxps */
  const fitPxps = (dur, viewportW) => (dur > 0 ? (viewportW - PAD * 2) / dur : PXPS_DEFAULT);
  /** 缩小的下限；视口还没量出来（≤ 2×PAD）时退回固定下限。 */
  function minPxps(dur, viewportW) {
    if (!(dur > 0) || !(viewportW > PAD * 2)) return PXPS_FIT_206;
    return Math.min(PXPS_FIT_206, fitPxps(dur, viewportW));
  }
  const clampPxps = (v, floor) => Math.min(PXPS_MAX, Math.max(floor != null ? floor : PXPS_FIT_206, v));
  const zoomIn  = (pxps, floor) => clampPxps(pxps * ZOOM_FACTOR, floor);
  const zoomOut = (pxps, floor) => clampPxps(pxps / ZOOM_FACTOR, floor);

  /** 百分比标签，100% = PXPS_DEFAULT。≥10 取整（"22%"）；1–10 留一位小数、去掉多余的 .0
      （"4.4%"、"5%"）；<1 取两位有效数字、去掉末尾的 0（"0.42%"、"0.05%"）。
      进位跨档（9.96 → "10%"）不会写成 "10.0%"；有效缩放永远不显示 "0%"。 */
  function zoomLabel(pxps) {
    const pct = (pxps / PXPS_DEFAULT) * 100;
    if (!(pct > 0) || !isFinite(pct)) return '—';
    const trim = (s) => (s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s);
    if (pct >= 10) return Math.round(pct) + '%';
    return trim(pct >= 1 ? pct.toFixed(1) : pct.toPrecision(2)) + '%';
  }

  /* ---------- 缩放的滚动锚点 ----------
     下面的时间都是**视图时钟**（经折叠时钟 `view` 后的秒数），x 都是泳道视口坐标
     （不含 144px 行头列），与 `px()` / `centeredScrollOffset` 同一套原点。 */

  /** 换到 nextPxps 后的滚动偏移：播放头在视口内就让它留在原来的屏幕 x；
      否则让当前视口中线对应的时刻不动。 */
  function zoomedScroll(st, nextPxps) {
    const vw = Math.max(0, st.viewportW);
    const screenX = px(st.playVt, st.pxps) - st.scroll;
    const onScreen = screenX >= 0 && screenX <= vw;
    const vt = onScreen ? st.playVt : timeAt(st.scroll + vw / 2, st.pxps);
    const at = onScreen ? screenX : vw / 2;
    return clampedScrollOffset(px(vt, nextPxps) - at, contentWidth(st.viewDur, nextPxps), vw);
  }

  /** 缩放动作 → `{pxps, scroll}`（要不到结果时返回 null）。
      st = {pxps, scroll, viewportW, viewDur, playVt, span?: {start, end}}，span 是 fitclip / fitsel 的视图时钟区间。
      in / out / 100：锚点缩放；fit：整片入镜并回到 0；playhead：放到 PXPS_PLAYHEAD 并让播放头居中；
      fitclip / fitsel：让区间铺满视口并居中（铺不满——到了上限——也居中）。 */
  function zoomPlan(kind, st) {
    const floor = minPxps(st.viewDur, st.viewportW);
    const keep = (next) => ({pxps: next, scroll: zoomedScroll(st, next)});
    if (kind === 'in') return keep(zoomIn(st.pxps, floor));
    if (kind === 'out') return keep(zoomOut(st.pxps, floor));
    if (kind === '100') return keep(clampPxps(PXPS_DEFAULT, floor));
    if (kind === 'fit') return {pxps: clampPxps(fitPxps(st.viewDur, st.viewportW), floor), scroll: 0};
    const centerOn = (vt, next) => clampedScrollOffset(
      px(vt, next) - Math.max(0, st.viewportW) / 2, contentWidth(st.viewDur, next), st.viewportW);
    if (kind === 'playhead') {
      const next = clampPxps(PXPS_PLAYHEAD, floor);
      return {pxps: next, scroll: centerOn(st.playVt, next)};
    }
    if ((kind === 'fitclip' || kind === 'fitsel') && st.span) {
      const len = Math.max(0.1, st.span.end - st.span.start);
      const next = clampPxps(fitPxps(len, st.viewportW), floor);
      return {pxps: next, scroll: centerOn(st.span.start + len / 2, next)};
    }
    return null;
  }

  /** 键盘事件对应哪个缩放动作（与 data.js `zoomMenu` 的快捷键提示一一对应），不是缩放键返回 null。
      ⌥ 按住时 macOS 的 `e.key` 是特殊字符，数字键一律认 `e.code`。 */
  function zoomKey(e) {
    if (!(e.metaKey || e.ctrlKey)) return null;
    const code = e.code || '', key = e.key || '';
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
    if (e.altKey) {
      if (e.shiftKey || !digit) return null;
      return {'1': 'fit', '2': 'fitclip', '3': 'playhead', '4': 'fitsel'}[digit[1]] || null;
    }
    if (code === 'Equal' || code === 'NumpadAdd' || key === '=' || key === '+') return 'in';
    if (code === 'Minus' || code === 'NumpadSubtract' || key === '-' || key === '\u2212') return 'out';
    if (!e.shiftKey && ((digit && digit[1] === '0') || key === '0')) return '100';
    return null;
  }

  /** 播放头落在哪一章（末章含右端点） */
  function chapterAt(chapters, t) {
    for (let i = 0; i < chapters.length; i++) {
      const c = chapters[i];
      if (t >= c.start && (t < c.end || (i === chapters.length - 1 && t <= c.end))) return i;
    }
    return -1;
  }

  /** 章节只切分播放进度条；没有有效章节时仍保留一条全长播放进度。 */
  function playbackSpans(chapters, dur, projectTitle) {
    const authored = (chapters || []).filter((c) => c.end > c.start);
    return authored.length || !(dur > 0)
      ? authored
      : [{id: 'playback', title: projectTitle || '', start: 0, end: dur, playbackOnly: true}];
  }

  /** « / » ：上一个 / 下一个章节起点，端点 clamp（§12.3） */
  function prevChapterStart(chapters, t) {
    let best = 0;
    for (const c of chapters) if (c.start < t - 0.05) best = c.start;
    return best;
  }
  function nextChapterStart(chapters, t) {
    for (const c of chapters) if (c.start > t + 0.05) return c.start;
    return chapters.length ? chapters[chapters.length - 1].end : t;
  }

  /** 播放头所在的 clip 下标；不在任何 clip 内返回 -1 */
  function clipAt(clips, t) {
    for (let i = 0; i < clips.length; i++) {
      const k = clips[i];
      if (t >= k.start && (t < k.end || (i === clips.length - 1 && t <= k.end))) return i;
    }
    return -1;
  }

  /* 「播放头处一刀」切的是视频元素（2026-09-16，`BC_VIDEO_EDIT.splitElementAt`），
     `clips` 表不再有 UI；`clipAt` 只剩 `frameAt` 的取帧种子在用。 */

  /** 跨切点的条（元素 / 文本 / 字幕 cue）同步切分——Split 的联动那一半 */
  function splitSpan(span, t) {
    const end = span.end == null ? Infinity : span.end;
    if (!(t > span.start + 0.05 && t < end - 0.05)) return null;
    return [
      Object.assign({}, span, {id: span.id + 'a', end: t}),
      Object.assign({}, span, {id: span.id + 'b', start: t}),
    ];
  }

  /**
   * 行序（§12.6，自上而下）：
   * 元素动态行（按类别序）→ 文本 → 模板 → 字幕 → 视频 clip → 音频 → 音乐。
   *
   * **同类共道（2026-09-11，§12.6 全局规则）**：同一类别的元素尽量摆在**一条**行上——
   * 像日历那样，只有时间重叠才另起一条，而且新条子总先塞回已有行里尾端空出来的位置
   * （first-fit），所以一类的行数永远等于它的最大同时重叠数、不多一条。一类之内高道
   * 在上、0 道贴近字幕。与内核 `timeline_lanes::plan`（App `lane_plans` / Web `buildRows`）
   * 同一套判据，重叠容差也同为 `LANE_EPSILON`（1ms）。行 key 写成 `el:<kind>@<道>`，
   * 元素挪动后行不会因此改名；一行上的元素在 `row.els`，`row.el` 是它的头一件。
   * 例外两类：模板本就一件贯穿全片；文本组下面挂着自己的成员行，多组共道时成员行
   * 无处挂，原型仍一组一行（App / Web 的 `tr-text` 已按道叠，见台账）。
   */
  const LANE_EPSILON = 0.001;
  /** first-fit 分道（镜像 `timeline_lanes::partition`）：按 start 稳定排序，每件塞进
      第一条「上一件已经结束」的道，没有就开新道；`end == null` 视为开放到 `endAt`。 */
  function laneFit(list, endAt) {
    const ordered = list.map((e, i) => [e, i]).sort((a, b) => a[0].start - b[0].start || a[1] - b[1]);
    const lanes = [];
    ordered.forEach(([e]) => {
      const endOf = (x) => (x.end == null ? endAt : x.end);
      let i = lanes.findIndex((lane) => endOf(lane[lane.length - 1]) <= e.start + LANE_EPSILON);
      if (i < 0) { lanes.push([]); i = lanes.length - 1; }
      lanes[i].push(e);
    });
    return lanes;
  }
  /* 'counter' 排在 'wave' 后面（第 88 轮）：它在浏览面板里与进度 / 声波同属可视化那一栏，
     时间轴上跟着摆在一起。不在这张表里的类别一律沉到末尾——计时刚加进来那会儿正是
     这样，一条本该挨着声波的行掉到了模板下面。 */
  const CLASS_RANK = ['textgroup', 'sticker', 'confetti', 'image', 'whiteboard', 'video', 'shape', 'progress', 'wave',
    'counter', 'overlay', 'vframe', 'tpl'];
  /* 两层高的媒体行（74）：视频是「上半缩略图 + 下半波形」，白板手绘（2026-09-11）是
     「上半画面带 + 下半画时带」——都要那 42 + 24 的两层，30px 的元素行装不下一张画面。 */
  const MEDIA_KINDS = ['video', 'whiteboard'];
  const isMediaKind = (kind) => MEDIA_KINDS.indexOf(kind) >= 0;
  function rows(elements, opts) {
    const o = opts || {};
    const rank = (e) => {
      const i = CLASS_RANK.indexOf(e.kind);
      return i < 0 ? CLASS_RANK.length : i;
    };
    const els = elements.slice().sort((a, b) => rank(a) - rank(b) || a.start - b.start);
    /* 停用位（第 120 轮）：行留在时间轴上，画面与导出都跳过它。真相各在各家——
       元素在 `hiddenEls[id]`、字幕轨在 `track.hidden`、音频 / 音乐在两个 muted 位；
       这里只把它们折成每行一个 `off`，行头与导出清单读同一个字。 */
    const hiddenEls = o.hiddenEls || {};
    const out = [];
    /* 同类共道：先按类别把元素分好道，再沿类别序逐类吐行——一类的所有道挨在一起、
       高道在上。开放式片尾（`end == null`）按最长的已知终点或传入的 `end` 算。 */
    const endAt = o.end != null ? o.end
      : els.reduce((m, e) => (e.end != null && e.end > m ? e.end : m), 0);
    const byKind = {};
    els.forEach((e) => {
      if (e.kind === 'tpl' || e.kind === 'textgroup') return;
      (byKind[e.kind] || (byKind[e.kind] = [])).push(e);
    });
    const done = {};
    els.forEach((e) => {
      // 视频元素行要高一档：它和主轨的 clip 一样是「上半缩略图 + 下半波形」两层
      const kind = e.kind === 'tpl' ? 'template' : e.kind === 'textgroup' ? 'text' : 'element';
      if (kind === 'element') {
        if (done[e.kind]) return;
        done[e.kind] = true;
        const lanes = laneFit(byKind[e.kind], endAt);
        for (let lane = lanes.length - 1; lane >= 0; lane--) {
          const list = lanes[lane];
          out.push({key: 'el:' + e.kind + '@' + lane, kind, elKind: e.kind, lane,
            h: isMediaKind(e.kind) ? ROW_H.video : ROW_H[kind], el: list[0], els: list,
            off: list.every((x) => !!hiddenEls[x.id])});
        }
        return;
      }
      const off = kind !== 'template' && !!hiddenEls[e.id];
      out.push({key: 'el:' + e.id, kind, h: ROW_H[kind], el: e, els: [e], off});
      // 文本组：一条组行 + 缩进的成员行（§14.2 / §12.7）。成员泳道**常开**（第 105 轮：
      // 此前只在文字 Tab 下展开，与 App v2 的文档派生泳道相反；时间轴不读 Tab）。
      // 成员表跟着组走（第 58 轮：用户造出来的组各有各的成员），没有就退回传进来的那份
      const mem = e.members && e.members.length ? e.members : o.textMembers;
      if (kind === 'text' && mem) {
        mem.forEach((m) => {
          out.push({key: 'mem:' + m.id, kind: 'member', h: ROW_H.member, el: e, member: m, indent: true, off});
        });
      }
    });
    /* **一门语言 = 一条字幕轨 = 时间轴上一行**（第 45 轮）。轨落到时间轴上就
       固定在那里：切 Tab、切面板的语言下拉都不会改变这里有哪几行——第 105 轮把
       这条不变式收紧到**行的状态**：字幕行恒为展开态逐条 cue（46），两态退役。
       行序 = 组的叠序（自上而下），所以在属性页里把译文挪到上面，时间轴上它也上去。
       没有轨集传进来时退回一行——旧调用点与测试仍然拿得到那一行。 */
    const subTracks = Array.isArray(o.subTracks) ? o.subTracks : [{id: 'subs', name: '字幕'}];
    subTracks.forEach((t) => {
      out.push({key: 'subs:' + t.id, kind: 'subs', track: t, h: ROW_H.subs, label: t.name, off: !!t.hidden});
    });
    /* 只读的「文稿」行（2026-10-08，§12.6）：视频转录过、却一条字幕轨都没有（转录时没建字幕，
       或把字幕都拿下了）——文稿照样落在时间轴上，占字幕行的位置，看得见哪里在说话、点一句落播放头。
       它不是轨：没有开关、不进导出、不可选中。调用方显式传 `transcript` 才出这一行，
       所以「显式空轨集」的旧语义（新建空白项目不补虚构轨）不变。 */
    if (o.transcript && !subTracks.length) {
      out.push({key: 'transcript', kind: 'transcript', h: ROW_H.subs, label: '文稿'});
    }
    /* 没有 `clips` 行（2026-09-16）：项目原片是普通 `video` 元素，走上面的同类共道；
       时间轴上所有轨平等，没有「主视频」。 */
    /* 翻译配音（2026-09-11，§12.6；2026-09-14 改成**一种语言一组**）：一组 = 配音行 + 它自己的
       背景声行——背景声是这次配音跑 HTDemucs 拆出来的伴奏，跟着这一组走，不同语言**不共用**
       （`dub-<lang>/background.wav`）；再配一种语言就再拆一份。组头是配音行（`dub:<lang>`），背景声行
       缩进跟在下面（`bed:<lang>`，`indent`），组的停用位是 `dubOff[lang]`（关了整组都灰），背景声
       自己再有一份 `bedOff[lang]`；原声那行的 `audioMuted` 在配音应用时被置上（老调用给单个
       `dub` + `dubMuted` / 一位 `bedMuted` 也认——`bedMuted` 视作所有组的背景声都关）。 */
    const dubs = Array.isArray(o.dubs) ? o.dubs : o.dub ? [o.dub] : [];
    const dubOff = o.dubOff || (o.dub ? {[o.dub.lang]: !!o.dubMuted} : {});
    const bedOff = o.bedOff || {};
    dubs.forEach((d) => {
      const lang = d.lang || '';
      const off = !!dubOff[d.lang];
      const name = d.langName ? ' · ' + d.langName : '';
      out.push({key: 'dub:' + lang, kind: 'dub', h: ROW_H.dub, label: (d.role === 'narration' ? '旁白' : '配音') + name, dub: d, off, group: !!d.bed});
      if (d.bed) out.push({key: 'bed:' + lang, kind: 'bed', h: ROW_H.bed, label: '背景声' + name, dub: d, lang: d.lang,
        indent: true, grouped: true, groupOff: off, bedOff: !!(bedOff[d.lang] || o.bedMuted), off: !!(off || bedOff[d.lang] || o.bedMuted)});
    });
    const ducked = dubs.some((d) => d.original === 'duck' && !dubOff[d.lang]);
    /* 音频行只在两种情况下出现（2026-09-16，没有常驻的「主音频」行）：
       (a) 纯音频项目（第 225 轮 `mainAudio`）——它就是主轨，标 `main` 让行头高亮；
       (b) 有配音组——这一行是「原声」：从**所有**源片视频元素剥离出来的原始人声 + 背景，
           标 `split`，默认停用、随时拨回。没有配音时视频元素各自的行就带着声音
           （行头喇叭 `VideoMute`），不另出一行。 */
    if (o.audio !== false && (o.mainAudio || dubs.length)) out.push({key: 'audio', kind: 'audio', h: ROW_H.audio,
      label: dubs.length ? '原声' : '音频', off: !!o.audioMuted,
      main: !!o.mainAudio, split: dubs.length > 0, ducked: !!(ducked && !o.audioMuted)});
    // 音乐行：§12.6 的行序里一直写着，实现里一直没有——素材库那条 bgm 标着
    // 「已在时间轴」，时间轴上却找不到它
    if (o.music !== false) out.push({key: 'music', kind: 'music', h: ROW_H.music, label: '音乐', off: !!o.musicMuted});
    /* 配乐轨（剧情短片 §5.5，2026-09-24）：动画项目的配乐按总线拆成几路 stem，一路一行，
       排在音乐行之后、按 `score` 表的顺序。行高与音乐行同档；停用位是 `scoreOff[bus]`
       ——只在时间轴上关掉这一路，不写回动画稿（`BC_SCORE.MUTE_NOTE`）。 */
    const SC = (typeof window !== 'undefined' && window.BC_SCORE) || null;
    (Array.isArray(o.score) ? o.score : []).forEach((t) => {
      const off = !!(o.scoreOff || {})[t.bus];
      out.push({key: 'score:' + t.bus, kind: 'score', h: ROW_H.music, bus: t.bus, score: t,
        label: SC ? SC.laneName(t.bus) : '配乐 · ' + t.bus, stale: !!t.stale, off});
    });
    const placed = applyTrackOrder(out, o.trackOrder);
    let y = 0;
    for (const r of placed) { r.y = y; y += r.h; }
    return {rows: placed, height: y};
  }

  /* ---------- 轨道换序（2026-10-08，product-design §5.1 时间线） ----------
     画布图层 = 时间线轨道：按住行头上下拖，只在同类轨道（画面 / 字幕 / 声音）之间换位。
     与 App 共用 UI 的 `moveTrack` 同一套语义——每类有一份按 `order` 升序的键表（模型序），
     画面与字幕在时间线上按 `order` 降序显示（上面的在前面），声音按升序显示，
     所以声音行显示上的「上 / 下」要翻成模型的 below / above（`trackPlacement`）。
     本原型的行由元素派生（同类共道），没有持久的轨道表：换过的次序记在 `trackOrder`
     （`{picture: [...], audio: [...], subs: [...]}`，键为行 key），`rows()` 在每类原来占的
     那些位置里按它重排，表里没有的行留在派生位置。随行（文字组的成员行、配音组的背景声行）
     跟着它前面那一行走，自己不是轨、不能单拖；模板与文稿行不参与。 */
  function trackClass(row) {
    if (!row) return null;
    if (row.kind === 'element' || row.kind === 'text') return 'picture';
    if (row.kind === 'subs') return 'subs';
    if (row.kind === 'audio' || row.kind === 'music' || row.kind === 'dub' || row.kind === 'score') return 'audio';
    return null;
  }
  const ridesAlong = (row) => row.kind === 'member' || row.kind === 'bed';
  /** 行按「轨 + 它的随行」分成单元，保持显示顺序。 */
  function trackUnits(rows) {
    const units = [];
    let cur = null;
    rows.forEach((r) => {
      if (cur && ridesAlong(r)) { cur.rows.push(r); return; }
      cur = {key: r.key, cls: trackClass(r), rows: [r]};
      units.push(cur);
    });
    return units;
  }
  /** 模型序（`order` 升序）↔ 显示序（自上而下）：声音一致，画面与字幕相反。互为逆运算。 */
  function displayKeys(cls, keys) {
    return cls === 'audio' ? keys.slice() : keys.slice().reverse();
  }
  function applyTrackOrder(rows, trackOrder) {
    if (!trackOrder) return rows;
    const units = trackUnits(rows);
    Object.keys(trackOrder).forEach((cls) => {
      if (!Array.isArray(trackOrder[cls])) return;
      const slots = [];
      units.forEach((u, i) => { if (u.cls === cls) slots.push(i); });
      if (slots.length < 2) return;
      const current = slots.map((i) => units[i]);
      const byKey = {};
      current.forEach((u) => { byKey[u.key] = u; });
      const next = displayKeys(cls, trackOrder[cls]).filter((k) => byKey[k]).map((k) => byKey[k]);
      current.forEach((u, i) => { if (next.indexOf(u) < 0) next.splice(Math.min(i, next.length), 0, u); });
      slots.forEach((slot, i) => { units[slot] = next[i]; });
    });
    return units.reduce((all, u) => all.concat(u.rows), []);
  }
  function unitsOf(rows, cls) { return trackUnits(rows).filter((u) => u.cls === cls); }
  function unitOf(rows, key) { return trackUnits(rows).find((u) => u.key === key) || null; }

  /** 时间线上的上下 → 模型的上下：声音行的「上面」是 `order` 更小的那边。 */
  function trackPlacement(cls, position) {
    if (cls !== 'audio') return position;
    return position === 'above' ? 'below' : 'above';
  }
  /** 镜像引擎的 `moveTrack`：在 `order` 升序键表里把 `key` 挪到 `target` 之上（`order` 更大）或之下。 */
  function moveTrack(orderAsc, key, target, position) {
    if (key === target || orderAsc.indexOf(key) < 0 || orderAsc.indexOf(target) < 0) return null;
    const rest = orderAsc.filter((k) => k !== key);
    const at = rest.indexOf(target) + (position === 'above' ? 1 : 0);
    return rest.slice(0, at).concat([key], rest.slice(at));
  }
  /** 同类的轨多于一条、没锁着才能拖；随行、模板、文稿行不能拖。`isLocked(row)` 可选——
   *  本原型的时间线还没有轨道锁，调用方不传就当都没锁。 */
  function canDragTrack(rows, key, isLocked) {
    const unit = unitOf(rows, key);
    if (!unit || !unit.cls) return false;
    if (isLocked && isLocked(unit.rows[0])) return false;
    return unitsOf(rows, unit.cls).length > 1;
  }
  /** 拖到紧挨着自己的行、又落在靠自己的那一边：位置不变，不算换。 */
  function trackDropChanges(rows, key, drop) {
    const own = unitOf(rows, key);
    if (!own || !own.cls || !drop) return false;
    const list = unitsOf(rows, own.cls).map((u) => u.key);
    const from = list.indexOf(key);
    const to = list.indexOf(drop.key);
    if (from < 0 || to < 0 || from === to) return false;
    if (drop.position === 'above' && to === from + 1) return false;
    if (drop.position === 'below' && to === from - 1) return false;
    return true;
  }
  /** 指针在行区里的纵坐标 `y`（从第一行顶上量）落在同类哪一轨的上半 / 下半；
   *  落点不改变次序时给 null（不画落点线、松手不提交）。 */
  function trackDropAt(rows, key, y) {
    const own = unitOf(rows, key);
    if (!own || !own.cls) return null;
    for (const u of unitsOf(rows, own.cls)) {
      if (u.key === key) continue;
      const first = u.rows[0], last = u.rows[u.rows.length - 1];
      const top = first.y, bottom = last.y + last.h;
      if (y < top || y >= bottom) continue;
      const drop = {key: u.key, position: y < (top + bottom) / 2 ? 'above' : 'below'};
      return trackDropChanges(rows, key, drop) ? drop : null;
    }
    return null;
  }
  /** 松手：这一类的新模型序（`order` 升序），合进 `trackOrder` 返回；不变时原样返回。 */
  function trackOrderAfterDrop(rows, trackOrder, key, drop) {
    const own = unitOf(rows, key);
    if (!own || !own.cls || !trackDropChanges(rows, key, drop)) return trackOrder || {};
    const asc = displayKeys(own.cls, unitsOf(rows, own.cls).map((u) => u.key));
    const next = moveTrack(asc, key, drop.key, trackPlacement(own.cls, drop.position));
    return Object.assign({}, trackOrder, {[own.cls]: next});
  }
  /** 一类在显示上的键序（自上而下），由模型序换算。 */
  function trackDisplay(cls, orderAsc) { return displayKeys(cls, orderAsc || []); }

  /* 画布元素的「层级」四项（F / ⌘↑ / ⌘↓ / B）落在轨道上：画面元素独占一条轨时与相邻的同类轨换位
     （前移 = 拖到上一条之上，移到最前 = 拖到最上一条之上），走到边就灰掉；与别的元素共一条轨时
     引擎会把它拆到一条新的相邻轨上——本原型的道由同类共道派生、拆不出新轨，只报一个 `split`。 */
  const ARRANGE_DIRS = ['front', 'forward', 'backward', 'back'];
  function arrangePlan(rows, elId, dir) {
    const row = rowOfEl(rows, elId);
    if (!row || trackClass(row) !== 'picture') return null;
    if (rowEls(row).length > 1) return {split: true};
    const list = unitsOf(rows, 'picture');
    const i = list.findIndex((u) => u.key === row.key);
    const n = list.length;
    const drop = dir === 'front' ? (i > 0 ? {key: list[0].key, position: 'above'} : null)
      : dir === 'forward' ? (i > 0 ? {key: list[i - 1].key, position: 'above'} : null)
      : dir === 'backward' ? (i < n - 1 ? {key: list[i + 1].key, position: 'below'} : null)
      : dir === 'back' ? (i < n - 1 ? {key: list[n - 1].key, position: 'below'} : null) : null;
    return drop ? {key: row.key, drop} : null;
  }

  /* ---------- 盖住视频的元素（2026-09-11，白板手绘；2026-09-16 起每条视频行都算） ----------
     白板铺了纸就是一整幅不透明画面：它在的那几秒下层视频还在轨上、还在出声，画面却一点
     看不见。此前时间轴对此一无所知——视频行照常铺缩略帧，看起来那一段舞台该是视频。
     这里从元素表推出「哪一段被谁盖住」，视频行的缩略带上压一层斜纹带（波形那半不压：
     声音没被盖）。判据是几何 + 不透明：铺满画布（place 50/50/100/100，scale ≥ 1）、
     没停用、白板要铺了纸（透明纸露出下层，不算盖）、图片 / 视频不透明度要满。
     只看「整幅盖住」，不做局部遮挡的面积账——那是渲染器的事，时间轴回答的是
     「这一段画面还是不是视频」。 */
  const COVER_KINDS = ['whiteboard', 'image', 'video'];
  function covers(el, doc, style) {
    if (!el || COVER_KINDS.indexOf(el.kind) < 0) return false;
    const d = doc || {};
    if (d.hidden) return false;
    /* 铺满画幅的视频也盖住它下面的视频（2026-09-16）——没有「主视频不盖自己」的豁免，
       `coverSpans` 只跳过目标元素本身。 */
    const p = Object.assign({}, el.place, d.pose);
    const near = (v, want) => Math.abs((v == null ? want : v) - want) < 0.5;
    const full = near(p.x, 50) && near(p.y, 50) && (p.w || 0) >= 99.5 && (p.h || 0) >= 99.5
      && (p.scale == null ? 1 : p.scale) >= 1;
    if (!full) return false;
    const st = style || {};
    if (el.kind === 'whiteboard') return !!(st.whiteboard && st.whiteboard.paper);
    return st.opacity == null || st.opacity >= 100;
  }
  /** 视频元素 `target` 上被盖住的时段（每条视频行都算，2026-09-16）：`[{start, end, by: [{id, name, icon, kind}]}]`，
      按时间排、相接或重叠的合并，`by` 按叠序（元素表顺序）。 */
  function coverSpans(target, elements, docs, styleOf) {
    if (!target) return [];
    const ds = docs || {};
    const raw = [];
    (elements || []).forEach((e) => {
      if (e.id === target.id) return;
      if (!covers(e, ds[e.id], styleOf ? styleOf(e.id) : null)) return;
      const s = Math.max(target.start, e.start), t = Math.min(target.end, e.end);
      if (t - s > 0.01) raw.push({start: s, end: t, by: {id: e.id, name: e.name, icon: e.icon, kind: e.kind}});
    });
    raw.sort((a, b) => a.start - b.start);
    const out = [];
    raw.forEach((r) => {
      const last = out[out.length - 1];
      if (last && r.start <= last.end + 0.01) { last.end = Math.max(last.end, r.end); last.by.push(r.by); }
      else out.push({start: r.start, end: r.end, by: [r.by]});
    });
    return out;
  }

  /** 这一行的启停开关拧在哪：`{kind: 'subs'|'el'|'audio'|'music'|'score', id}`；
   *  主轨、成员行与模板行没有开关（模板那层的开合在它自己的属性页），返回 null。
   *  同类共道后一条元素行可能坐着多件：开关拧的是**整行**，多件时多带一份 `ids`
   *  （`id` 仍是头一件，旧调用点照读），`setLaneOn` 逐件写 `hidden`。 */
  function laneSwitch(row) {
    if (!row) return null;
    if (row.kind === 'subs') return {kind: 'subs', id: row.track.id};
    if ((row.kind === 'element' || row.kind === 'text') && row.el) {
      const ids = rowEls(row).map((e) => e.id);
      return ids.length > 1 ? {kind: 'el', id: ids[0], ids} : {kind: 'el', id: row.el.id};
    }
    if (row.kind === 'audio') return {kind: 'audio', id: 'audio'};
    if (row.kind === 'music') return {kind: 'music', id: 'music'};
    if (row.kind === 'score') return {kind: 'score', id: row.bus};
    if (row.kind === 'dub') return {kind: 'dub', id: (row.dub && row.dub.lang) || 'dub'};
    if (row.kind === 'bed') return {kind: 'bed', id: row.lang || 'bed'};
    return null;
  }

  /** 这一行上摆着的元素：元素行按道摆着一件或多件（`row.els`，按 start 排），
   *  成员行 / 模板行 / 字幕行 / 声音行没有。 */
  function rowEls(row) {
    if (!row || row.member || row.kind === 'template') return [];
    return row.els || (row.el ? [row.el] : []);
  }
  /** 同一行里 `el` 左右两侧到邻块的间隙（秒）：没有邻块给 `Infinity`。抓取带按它收。 */
  function rowGaps(row, el) {
    let left = Infinity, right = Infinity;
    rowEls(row).forEach((x) => {
      if (x.id === el.id) return;
      if (x.end != null && x.end <= el.start + LANE_EPSILON) left = Math.min(left, el.start - x.end);
      else if (el.end != null && x.start + LANE_EPSILON >= el.end) right = Math.min(right, x.start - el.end);
    });
    return {left: Math.max(0, left), right: Math.max(0, right)};
  }
  /** 元素 `id` 落在哪一行。 */
  function rowOfEl(rows, id) {
    return rows.find((r) => rowEls(r).some((e) => e.id === id)) || null;
  }

  /* ---------- 元素条的拖动、裁剪与吸附（第 39.2 轮） ----------
       · 吸附阈值 10px（按**像素**判距离，不是按秒，所以缩放越小越难吸）；
       · 吸附点 = 播放头（参考线贯穿全高、从标尺下沿起）
         ＋ 每个其它元素的左右缘（参考线只覆盖相关的行）；
       · 手势分整条拖动、裁左端、裁右端三种；
       · 块宽 < 45px 就不画图标与文字——低缩放下名字会顶出条子。
     这一套在前身画板里是「刻意不采纳」的（`.dc.html` 不支持 drag），换成 React 载体后
     那条限制不存在了，所以这里补上。 */
  const SNAP_PX = 10;          // 吸附阈值（像素）
  const LABEL_MIN_W = 45;      // 块宽小于这个数就只剩色块
  const TRIM_MIN = 0.2;        // 元素最短时长（秒）
  const HANDLE_W = 8;          // 两端裁剪手柄的宽度

  /* ---------- 两端修边热区与抓取边距（第 226 轮） ----------
     此前手柄是两根 4px 的装饰条，只在 hover / 选中且块宽 ≥ 45 时才出：一条十几像素
     宽的贴纸（`w < 45`）于是**根本没有边可拖**，要改时间范围只能回属性面板敲数字。
     现在改成两段**热区**：宽度 `min(7, w/3)`——除以三是给中间那一段「整条拖动」留活路，
     不然窄块两端一夹，中间没地方按了。热区窄到 3px 以下就整个不画：点不准的光标是
     空头承诺。热区里仍画那根 4px 的条，只是它不再是判据，只是标记。

     判据（`blockEdgeZone` / `blockEdgeSide`）与 App v2 的
     `bcut_editor_core::timeline_edit` 同源同名，两处逐像素相同。 */
  const BLOCK_EDGE_ZONE = 7;
  const HANDLE_MIN_ZONE = 3;
  const blockEdgeZone = (w) => Math.min(BLOCK_EDGE_ZONE, Math.max(0, w) / 3);
  /** 块内横坐标落在哪一端的热区上；中间返回 null（= 整条拖动）。 */
  const blockEdgeSide = (x, w) => {
    const zone = blockEdgeZone(w);
    if (!(zone > 0)) return null;
    if (x <= zone) return 'left';
    if (x >= w - zone) return 'right';
    return null;
  };

  /* 块两侧向**空白**借出来的抓取边距。元素行高 30、条子只有 22（`top: 4` + `height: h-8`），
     上下各 4px 谁也不接——瞄一条窄贴纸稍微偏上偏下就按到行底色上（在 App v2 上那等于
     取消选中 + 播放头飞走）。所以热区纵向吃满整行、横向再各借 3px。
     本原型一条元素一行（`layoutRows` 逐个 push），行内没有兄弟，两侧恒借满。 */
  const BLOCK_GRAB_MARGIN = 3;
  /** 抓取带一侧实际借多少像素：常数封顶，但**绝不越过与邻块间隙的一半**
      （镜像 `core::timeline_edit::block_grab_margin`）。同类共道后一行里会并排多件，
      借满常数会抢到邻居边缘的可点性。 */
  function blockGrabMargin(gapPx) {
    if (gapPx !== gapPx) return 0;
    return Math.min(BLOCK_GRAB_MARGIN, Math.max(0, gapPx / 2));
  }

  /** 吸附点表。`full` 的那条参考线贯穿全高（播放头），其余只覆盖它自己那一行。 */
  function snapPoints(spans, selfId, playT, dur) {
    const out = [{t: playT, full: true}, {t: 0}, {t: dur}];
    spans.forEach((s) => {
      if (s.id === selfId) return;
      out.push({t: s.start, row: s.id});
      out.push({t: s.end, row: s.id});
    });
    return out;
  }

  /** 把一个候选时间吸到最近的点。距离按像素算——10px 是屏幕上的 10px，不是 10 秒。 */
  function snapTime(t, points, pxps) {
    let best = null;
    points.forEach((p) => {
      const d = Math.abs(p.t - t) * pxps;
      if (d <= SNAP_PX && (!best || d < best.d)) best = {d, p};
    });
    return best ? {t: best.p.t, snap: best.p} : {t, snap: null};
  }

  /** 整条拖动：长度不变，夹在 [0, dur]；两端都试吸附，先命中的那端赢。 */
  function dragSpan(span, dt, dur, points, pxps) {
    const len = span.end - span.start;
    let start = Math.max(0, Math.min(dur - len, span.start + dt));
    const a = snapTime(start, points, pxps);
    const b = snapTime(start + len, points, pxps);
    let snap = null;
    if (a.snap && (!b.snap || Math.abs(a.t - start) <= Math.abs(b.t - (start + len)))) {
      start = a.t; snap = a.snap;
    } else if (b.snap) {
      start = b.t - len; snap = b.snap;
    }
    start = Math.max(0, Math.min(dur - len, start));
    return {start, end: start + len, snap};
  }

  /** 裁剪一端：另一端不动，保底 TRIM_MIN。 */
  function trimSpan(span, side, dt, dur, points, pxps) {
    if (side === 'left') {
      const r = snapTime(Math.max(0, Math.min(span.end - TRIM_MIN, span.start + dt)), points, pxps);
      const start = Math.max(0, Math.min(span.end - TRIM_MIN, r.t));
      return {start, end: span.end, snap: r.snap};
    }
    const r = snapTime(Math.max(span.start + TRIM_MIN, Math.min(dur, span.end + dt)), points, pxps);
    const end = Math.max(span.start + TRIM_MIN, Math.min(dur, r.t));
    return {start: span.start, end, snap: r.snap};
  }

  /** 块够不够宽画图标与名字（45px 判据） */
  const showsLabel = (w) => w >= LABEL_MIN_W;

  /** In / Out 动画在条内占的秒数。Loop 没有起止，只出一个徽标。
      时长被条子本身夹住：一条 1 秒的元素放不下 0.6s 入场 + 0.6s 出场。 */
  function animBands(span, anim) {
    const len = Math.max(0, span.end - span.start);
    if (!anim || !len) return {in: 0, out: 0, loop: false};
    const on = (a) => a && a.k && a.k !== 'none';
    let i = on(anim.in) ? Math.min(anim.in.dur || 0.6, len) : 0;
    let o = on(anim.out) ? Math.min(anim.out.dur || 0.6, len) : 0;
    if (i + o > len) { const k = len / (i + o); i *= k; o *= k; }
    return {in: i, out: o, loop: on(anim.loop)};
  }

  /* ---------- 字幕行（第 39.3 轮，第 105 轮收敛为恒展开） ----------
     逐条 cue 一个块，块上写的是**这一条字幕的文字本身**，白字压在饱和底色上、
     `break-all` 换行、超出裁掉，左右各让 14px 给裁剪手柄，同样吃 45px 阈值。
     第 39.3 轮还有一个「合并成一条带」的态（进字幕 Tab 自动切换），第 105 轮退役：
     本产品裁决**时间轴不随右栏 Tab 改变**，这条不变式优先，`condensedSpan`
     随之删除。
     还有一条判据：字幕轨不进「其它元素的位置表」，
     所以**cue 的边缘不进吸附点表**——62 条 cue 会变成 124 个吸附点，拖别的元素
     就会一路被咬住。`snapPoints` 只吃元素，天然满足这条，测试把它钉住。 */
  const CUE_TEXT_INSET = 14;   // 文字两侧各让出 14px 给手柄

  /** 块上写什么：原文，双语时再带一行译文。太窄就什么都不写（45px 阈值）。 */
  function cueLabel(cue, w, bilingual) {
    if (!showsLabel(w)) return null;
    return bilingual && cue.trans ? {text: cue.text, trans: cue.trans} : {text: cue.text};
  }

  /* ---------- 视频轨与音频轨（第 39.4 轮） ----------
       · 视频块 = **上半缩略图带 + 下半自己的音频波形**。波形层贴着块底、高半条轨，
         带波形底色、2px 描边与下方圆角；音频块的波形则铺满整条高度。
         波形按固定宽度切成多段画，缩略图同理只渲染视口内那一段。
       · 块宽 ≤ 4px 就不画波形——那点宽度画什么都是一团。
       · **选中环分三档**：宽 ≤ 4 是 `small`——**不描边，改把整块染成选中色**
         （极窄的块描边根本看不见）；≤ 8 是 `medium`，选中 2px；再宽是 `large`，选中 4px、
         常态 1px。
       · 音频块上写的是**素材名**，图标随静音切换。 */
  const THUMB_W = 46;      // 缩略帧宽度（按固定宽度分块）
  const MEDIA_MIN_W = 4;   // 块宽 ≤ 这个数就不画波形与缩略图

  /** 一段能铺几张缩略帧；末帧按剩余宽度裁，不留空也不溢出 */
  function thumbs(w, tw) {
    const width = tw || THUMB_W;
    if (!(w > 0)) return [];
    const n = Math.ceil(w / width);
    const out = [];
    for (let i = 0; i < n; i++) out.push({left: i * width, width: Math.min(width, w - i * width)});
    return out;
  }

  /* ---------- 缩略帧 ----------
     原型不解码真视频，缩略帧是**确定性渐变色板**（§12.6 早写明「真实帧缩略图不做」）。
     两处要用它：时间轴上视频块的上半条，和全屏进度条上悬停给出的那一格预览。
     所以配方只有这一份——两边各写一遍，同一秒会画出两张不同的画面，而预览的
     全部意义就是「松手会落到哪一帧」。

     索引按**源秒数**取，不按第几个格子：把时间轴放大一档不该换一批画面，也只有
     按秒取，进度条上那一格才跟时间轴上那一格是同一张。一帧管 2 秒——在 100%
     （20px/s）下恰好接近 46px 的格宽，看起来与此前那版一致。 */
  const FRAME_S = 2;

  /** 源秒数 → 这一段里的第几帧（`from` 是该段在源上的起点，也就是它的种子） */
  function frameIndex(t, from) {
    return Math.max(0, Math.floor(((t || 0) - (from || 0)) / FRAME_S));
  }

  /** 第 n 帧长什么样。色相随种子与帧号走，同一秒恒等于同一张。 */
  function frameCss(seed, n) {
    const a = 196 + (seed || 0) * 26 + (n || 0) * 7, b = 228 + (seed || 0) * 26 + (n || 0) * 5;
    /* @ds-allow: 画的是视频画面本身（§12.6 的渐变色板兜底），不是 S2 表面 */
    return 'linear-gradient(150deg, oklch(0.62 0.09 ' + a + '), oklch(0.42 0.11 ' + b + '))';
  }

  /** 时间轴时钟的某一秒画什么：先落到哪一段 clip，再取那一段里的第几帧。
      落在缝里（片尾之后、或片段之间）就按 0 起算——预览格永远得有东西可画。 */
  function frameAt(clips, t) {
    const i = clipAt(clips || [], t || 0);
    const from = i < 0 ? 0 : clips[i].start;
    return frameCss(from, frameIndex(t, from));
  }

  /** 选中环的档位 */
  function ringSize(w) { return w <= 4 ? 'small' : w <= 8 ? 'medium' : 'large'; }
  /** 环宽：small 不描边（改整块染色），medium 选中 2px，large 选中 4px、常态 1px */
  function ringWidth(w, on) {
    const size = ringSize(w);
    if (size === 'small') return 0;
    if (!on) return 1;
    return size === 'medium' ? 2 : 4;
  }
  /** small 档选中时整块染色——描边这时候一个像素都挤不下 */
  const ringFills = (w, on) => !!on && ringSize(w) === 'small';
  const showsMedia = (w) => w > MEDIA_MIN_W;

  /** 确定性的镜像包络波形路径。相位由起始秒数决定，同一段永远画出同一条。 */
  function wavePath(w, h, t0) {
    const mid = h / 2;
    const phase = (t0 || 0) * 0.7;
    const amp = (x) => {
      const u = x / 9 + phase;
      const a = Math.sin(u) * 0.42 + Math.sin(u * 2.7) * 0.3 + Math.sin(u * 0.31) * 0.28;
      return Math.min(0.98, Math.abs(a) + 0.06);
    };
    const step = 3;
    let top = `M 0 ${mid.toFixed(2)}`;
    let bottom = '';
    for (let x = 0; x <= w; x += step) {
      const a = amp(x) * mid;
      top += ` L ${x} ${(mid - a).toFixed(2)}`;
      bottom = ` L ${x} ${(mid + a).toFixed(2)}` + bottom;
    }
    return top + bottom + ' Z';
  }

  /* ---------- 文字轨（第 39.5 轮） ----------
     文本块上写的是**文字内容本身**，不是「文本」这样的类型名；另有两条：
       · 标签 **20 字截断加省略号**——
         与字幕块的 `break-all` 换行相反，文本块是单行截断；
       · **文本组**画成组行 + 按 `delay` 错峰的成员行，成员**堆叠成子行**、每层一行高，
         位置**相对组行**算（组被拖动时成员跟着走）。§14.2 / §12.7 早写着
         「一条组行 + 缩进成员行」，实现里一直只有组行；第 105 轮起成员泳道常开。
     成员的起点由 delay 决定，所以**成员行不可单独拖**——错峰是预设参数，改它去面板的组视图。 */
  const LABEL_MAX = 20;   // 标签超过 20 字截断

  /** 20 字截断加省略号 */
  function truncate(t, n) {
    const s = String(t == null ? '' : t);
    const max = n || LABEL_MAX;
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  /** 成员的区间：起点 = 组起点 + delay，终点跟组一起收（错峰不改变结束） */
  function memberSpan(group, member) {
    const start = group.start + (member.delay || 0);
    return {start: Math.min(start, group.end), end: group.end};
  }

  /* ---------- 素材导入态（第 39.6 轮） ----------
     图片 / 视频块在素材还没就绪时，标签换成「导入中」，块内另有一条
     `width: N%` 的填充；关键是它**分两段**：
       导入完成且需要转码 → 显示「转码中」并改读 `transcodePct`，
       `active = !imported || transcoding`。
     「导入完 ≠ 可用」这条不能省——进度条走到 100% 之后素材还要转码，少了第二段，
     用户会以为已经好了。BaoCut 是本地优先、没有上传，两段是**导入（探测/拷贝）→ 转码**。 */
  function importState(m) {
    if (!m) return {label: '', pct: 0, active: false};
    const transcoding = !!m.imported && !!m.needTranscode;
    const raw = transcoding ? m.transcodePct : m.pct;
    const pct = Math.max(0, Math.min(100, Math.floor(100 * (raw || 0))));
    return {label: transcoding ? '转码中' : '导入中', pct, active: !m.imported || transcoding};
  }

  window.BC_TL = {
    languageBadge, headLabel,
    PAD, PXPS_DEFAULT, PXPS_MAX, PXPS_FIT_206, ZOOM_FACTOR, PXPS_PLAYHEAD,
    TICK_STEPS, TICK_MIN_PX, HEADS_W, RULER_H, CHAPTER_BAND_H, TRANSPORT_H,
    TRACKS_ORIGIN_Y, MIN_HEIGHT, DEFAULT_HEIGHT, ROW_H, CLASS_RANK,
    px, timeAt, devicePx, contentWidth, tickStep, ticks,
    BLANK_TAIL, BLANK_ROW_H, displayDuration,
    PLAYBACK_FOLLOW_ENTRY_MS, clampedScrollOffset, centeredScrollOffset,
    playbackFollowScrollOffset,
    clampPxps, zoomIn, zoomOut, zoomLabel, fitPxps, minPxps, zoomedScroll, zoomPlan, zoomKey,
    chapterAt, playbackSpans, prevChapterStart, nextChapterStart, clipAt, splitSpan, rows, laneSwitch, rowEls, rowOfEl,
    trackClass, trackUnits, trackPlacement, moveTrack, canDragTrack, trackDropChanges, trackDropAt, trackOrderAfterDrop,
    trackDisplay, ARRANGE_DIRS, arrangePlan,
    LANE_EPSILON, laneFit, rowGaps,
    MEDIA_KINDS, isMediaKind, COVER_KINDS, covers, coverSpans,
    SNAP_PX, LABEL_MIN_W, TRIM_MIN, HANDLE_W, CUE_TEXT_INSET, THUMB_W, MEDIA_MIN_W,
    BLOCK_EDGE_ZONE, HANDLE_MIN_ZONE, BLOCK_GRAB_MARGIN, blockGrabMargin, blockEdgeZone, blockEdgeSide,
    thumbs, FRAME_S, frameIndex, frameCss, frameAt,
    ringSize, ringWidth, ringFills, showsMedia, wavePath,
    LABEL_MAX, truncate, memberSpan, importState,
    cueLabel,
    snapPoints, snapTime, dragSpan, trimSpan, showsLabel, animBands,
  };
})();
