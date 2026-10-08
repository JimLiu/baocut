/* 时间轴的块与行 —— 第 115 轮从 `timeline.jsx` 拆出来（那份到了 671 行，超了 600 的上限）。
   这一份只画「一行里有什么」：元素条、成员条、字幕 cue、主轨 clip、音频块，以及块内
   两种内容（媒体缩略带 / 导入中的环形进度）。行的排布、标尺、播放头、框选仍在
   `timeline.jsx`。

   第 115 轮同时改的是**点选语义**（§7）：块上点一下走 `ctx.pick`，shift / ⌘ 追加或
   移出（clip 与 element 可混选）；播放中点一下先暂停；播放头不在这一段里就带过去
   （判据是纯函数 `BC_SELECT.seekForSel`，有单测；**追加选择不带播放头**——按住
     shift / ⌘ 往多选里加一件时播放头原地不动）。右键交给 `timeline-menu.jsx`。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const TL = window.BC_TL;
  /* 折叠时钟（第 197 轮）：块的横向位置与宽度都过 `ctx.tmap.view`——「剪辑」开关关着按成片时钟
     折叠，开着 `view` 恒等。拖动 / 裁剪的增量仍按 dx / pxps 读成时间轴时钟。 */
  const vx = (ctx, t, pxps) => TL.px(ctx && ctx.tmap ? ctx.tmap.view(t) : t, pxps);
  const vw = (ctx, a, b, pxps) => (ctx && ctx.tmap ? ctx.tmap.view(b) - ctx.tmap.view(a) : b - a) * pxps;
  const T = window.BC_TIME;
  const SEL = window.BC_SELECT;
  const CUT = window.BC_CUT;

  /* shift / ⌘ / ctrl 一律是「加入或移出」（§1 的 toggle 语义）；没按修饰键就是换成这一件。 */
  const modsOf = (e) => ((e.shiftKey || e.metaKey || e.ctrlKey) ? {add: true, toggle: true} : null);

  /* 时间轴上点一条 = 「我要看这一件」：暂停 → 选中 → 需要的话把播放头带过去。
     顺序不能换：`setPlaying(true)` 才清选中（`BC_SELECT.playState`），暂停不动选中，
     所以先暂停再 pick 是安全的；反过来则会在多选途中被清掉。 */
  const pickBlock = (ctx, sel, span, e, selected) => {
    if (ctx.playing) ctx.setPlaying(false);
    const mods = e ? modsOf(e) : null;
    ctx.pick(sel, mods);
    /* 带修饰键＝往多选里加减一件，不是「我要看这一件」——这一枪不动播放头
       （判据在 `seekForSel` 里，纯函数有单测）。 */
    /* 第 226 轮：**已经选中的那一件再按下，也不动播放头**。那一枪是手势的起手
       （要拖它 / 要裁它的边），不是「我要看它」；播放头一跳，指针与块的相对位置
       就变了，手上的感觉是块被从手里拽走。第一次点中才跟播放头。 */
    if (selected) return;
    const t = SEL.seekForSel(span, ctx.playT, ctx.duration, mods);
    if (t != null) ctx.seek(t);
  };

  /* 一类元素一套四色。第 39.2 轮按类别补上 hover 档：
     底 hue-200 / 选中底 hue-300 / 边 hue-400 / **hover 与选中的边同为 hue-800** / 字 hue-1000。
     选中不换成全局蓝——选中的边就是该类自己的 hover 色，同一条轨上
     「哪一类」比「有没有选中」更常需要一眼认出。 */
  const stops = (hue) => {
    const S = D.ELEMENT_HUE_STOPS;
    const set = hue === 'gray' ? S.gray : S.normal;
    const h = hue;
    return {bg: `var(--${h}-${set.bg})`, sel: `var(--${h}-${set.sel})`,
            border: `var(--${h}-${set.border})`, hover: `var(--${h}-${set.hover})`,
            fg: `var(--${h}-${set.fg})`};
  };
  /* ---------- 媒体块的内容：上半缩略图带 + 下半自己的波形 ----------
     主轨的 clip 与 B-roll 视频元素共用这一份——它们本来就是同一套视觉，
     B-roll 只在块上多一枚角标。 */
  function MediaBody({w, h, seed, pxps, hue = 'blue', muted}) {
    const waveH = 24;
    /* 缩略帧的配方在 [model-timeline.js](model-timeline.js)——全屏进度条上的悬停预览
       读的是同一份，两处各画各的话，同一秒在两个地方就是两张画面。帧号按**秒**取
       （`left / pxps` 换回源秒数），所以放大时间轴只会把同一张帧铺得更宽。 */
    const vw = Math.max(20, Math.round(w));
    return (
      <>
        <div className="tclip__th" style={{height: h - waveH}}>
          {TL.thumbs(w).map((t, n) => (
            <i key={n} style={{left: t.left, width: t.width - 1,
              background: TL.frameCss(seed, TL.frameIndex(seed + t.left / Math.max(0.01, pxps), seed))}} />
          ))}
        </div>
        <div className="tclip__wave" style={{height: waveH, background: `var(--${hue}-200)`,
          boxShadow: `inset 0 0 0 1px var(--${hue}-400)`}}>
          <svg width="100%" height={waveH - 4} preserveAspectRatio="none" viewBox={`0 0 ${vw} ${waveH - 4}`}>
            <path d={TL.wavePath(vw, waveH - 4, seed)} fill={`var(--${hue}-1000)`} opacity={muted ? 0.24 : 0.8} />
          </svg>
        </div>
      </>
    );
  }

  /* ---------- 导入 / 转码中的块内容（进度填充 + 环形徽标） ----------
     标签换成「导入中 (63%)」，块内一条 width:N% 的填充，外加一枚环形进度——
     环形徽标只在块宽 ≥ 45 时出（太窄画不下）。 */
  function ImportBody({state, w, hue}) {
    const R = 8, C = 2 * Math.PI * R;
    return (
      <>
        <span className="timp__fill" style={{width: state.pct + '%', background: `var(--${hue}-400)`}} />
        {TL.showsLabel(w) ? (
          <svg className="timp__ring" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <g transform="rotate(-90 12 12)">
              <circle cx="12" cy="12" r={R} fill="none" stroke={`var(--${hue}-400)`} strokeWidth="3" />
              <circle cx="12" cy="12" r={R} fill="none" stroke={`var(--${hue}-1000)`} strokeWidth="3"
                strokeLinecap="round" strokeDasharray={C} strokeDashoffset={(100 - state.pct) * C / 100} />
            </g>
          </svg>
        ) : null}
        {TL.showsLabel(w) ? (
          <span className="t-truncate">{state.label} <b className="t-mono">({state.pct}%)</b></span>
        ) : null}
      </>
    );
  }
  /* ---------- 元素条（可拖、可裁、会吸附） ----------
     手势分整条拖动 / 裁左端 / 裁右端三种（`drag` / `left` / `right`），
     判据与吸附全在 BC_TL 里（纯层，有单测），这一层只把鼠标位移换成秒数。 */
  function ElementBlock({el, row, pxps, on, ctx, onSnap, onDraft, onMenu}) {
    const app = useApp();
    const [hot, setHot] = useState(false);
    const [gesture, setGesture] = useState(null);      // 'drag' | 'left' | 'right'
    const [draft, setDraft] = useState(null);          // 拖动中的临时区间
    const c = stops(el.hue);
    const span = draft || {start: el.start, end: el.end};
    const w = Math.max(2, vw(ctx, span.start, span.end, pxps));
    const label = TL.showsLabel(w);
    const bands = TL.animBands(span, (ctx.elDocs[el.id] || {}).anim);
    /* 块上写什么是**按类型分**的，不是一刀切：
         图片 / 视频 / 音频 → 素材名
         文字 → 文字内容 · 字幕 → 这一条字幕的文字
         贴纸 / 形状 / 声波 / 进度 / 组 → **类型名**
       所以这里只有带素材的几类写文件名，贴纸照旧写「贴纸 · ON AIR」。 */
    const hasAsset = el.kind === 'image' || el.kind === 'video' || el.kind === 'audio';
    const title = hasAsset && el.asset ? TL.truncate(el.asset)
      : el.kind === 'text' && el.text ? window.BC_EL.textLabel(el.text, 20) : el.name;
    const imp = TL.importState((ctx.elDocs[el.id] || {}).media);
    const kfN = window.BC_KF.total((ctx.elDocs[el.id] || {}).keyframes);
    const kfMark = kfN ? <span className="tkf" title={kfN + ' 个关键帧'}><Ic n="keyframe" className="ic--14" /></span> : null;
    const isVideo = el.kind === 'video';
    /* 白板手绘（2026-09-11）：与视频同为两层媒体条——上半画面带、下半画时带，
       内容在 [timeline-whiteboard.jsx](timeline-whiteboard.jsx)；手绘参数读这一件的样式文档
       （与画布 `styleOf(id).whiteboard` 同一份），画时手柄写回同一键。 */
    const isWb = el.kind === 'whiteboard';
    const isMedia = isVideo || isWb;
    const wb = isWb ? window.BC_WHITEBOARD.normalize(((ctx.elStyleOf ? ctx.elStyleOf(el.id) : D.canvasStyle) || {}).whiteboard
      || window.BC_WHITEBOARD.defaults()) : null;
    const writeWb = (patch) => {
      const next = window.BC_WHITEBOARD.normalize(Object.assign({}, wb, patch));
      ctx.setElStyle({whiteboard: next}, el.id);
      app.toast(next.draw == null ? `${el.name} · 画时跟时长走` : `${el.name} · 画时 ${next.draw.toFixed(1)} s`);
    };
    const zone = TL.blockEdgeZone(w);
    /* 抓取带向两侧各借这么多（2026-09-11 起同类共道，一行可以并排多件）：常数 3px
       封顶，但绝不越过与邻块间隙的一半（`TL.blockGrabMargin` 镜像
       `core::block_grab_margin`）——借来的手感不拿邻居边缘的可点性去换。 */
    const gaps = TL.rowGaps(row, el);
    const GRAB_L = TL.blockGrabMargin(gaps.left * pxps);
    const GRAB_R = TL.blockGrabMargin(gaps.right * pxps);
    /* 停用的那一件自己灰下去：整行都停用时行级 `.trow.is-off` 已经压过一层，这里不再叠 */
    const offOne = !!(ctx.elDocs[el.id] || {}).hidden && !row.off;

    const begin = (mode) => (e) => {
      /* 只接左键（与主轨 clip 分支同款）：右键的 mousedown 若走到这里，会先经
         `focus(e)` 单选一次，把已有的多选塌成一件，随后 `onContextMenu` 的
         `if (!on)` 已无从补救——右键菜单必须能对着整组多选开。 */
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const x0 = e.clientX;
      const base = {start: el.start, end: el.end};
      const pts = TL.snapPoints(ctx.elements.map((x) => ({id: x.id, start: x.start, end: x.end})),
        el.id, ctx.playT, ctx.duration);
      setGesture(mode);
      let last = base;
      const move = (ev) => {
        const dt = (ev.clientX - x0) / pxps;
        const r = mode === 'drag'
          ? TL.dragSpan(base, dt, ctx.duration, pts, pxps)
          : TL.trimSpan(base, mode, dt, ctx.duration, pts, pxps);
        last = r;
        setDraft({start: r.start, end: r.end});
        // 组行拖动中成员行要跟着走（成员的位置是相对组行算的）
        if (onDraft) onDraft({id: el.id, start: r.start, end: r.end});
        onSnap(r.snap ? {t: r.snap.t, full: !!r.snap.full, row: r.snap.row} : null);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        setGesture(null); setDraft(null); onSnap(null);
        if (onDraft) onDraft(null);
        if (Math.abs(last.start - base.start) > 0.001 || Math.abs(last.end - base.end) > 0.001) {
          ctx.setElDoc(el.id, {start: +last.start.toFixed(2), end: +last.end.toFixed(2)});
          app.toast(`${el.name} · ${T.timecode(last.start)} → ${T.timecode(last.end)}`);
        }
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      /* 选中在 **mousedown** 里落（第 115 轮）：修饰键在这一枪里，跟拖拽起手同一刻；
         此前 mousedown 与 click 各选一次，加上 toggle 语义后 shift 点一下会被切两回
         （加进去又移出去），净效果等于没点。裁剪手柄不带修饰键——shift 拖手柄是
         「按住 shift 微调」的手感，不该顺手把这一件从多选里踢掉。 */
      focus(mode === 'drag' ? e : null);
    };

    /* 按下先判落在哪一段：两端的热区起修边，中间起整条拖动（第 226 轮）。
       `inset` = 事件目标的左缘到**块**左缘的距离——抓取带比块宽出 `GRAB`，块本身是 0。
       判据只有 `TL.blockEdgeSide` 这一份，热区那两个 span 不再各自挂 handler。 */
    const down = (inset) => (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      begin(TL.blockEdgeSide(e.clientX - r.left - inset, w) || 'drag')(e);
    };

    /* 时间轴上点一条 = 画布上点那个元素（两处走同一条选中路径）：
       选中 + 面板切到对应 Edit 视图。此前时间轴只 pick，不翻面板——同一个选中动作
       在两处给出不同结果。 */
    const focus = (e) => {
      pickBlock(ctx, {kind: 'element', id: el.id, elKind: el.kind}, {start: el.start, end: el.end}, e, on);
      // 文字与文本组都归 Text 栏——此前只映了 `textgroup`，于是时间轴上点文字行翻的是「元素」
      ctx.setTab(el.kind === 'text' || el.kind === 'textgroup' ? 'text'
        : ['image', 'video', 'audio'].includes(el.kind) ? el.kind : 'elements');
      ctx.setPaneHidden(false);
    };

    const edge = on || hot ? c.hover : c.border;
    /* 拖动 / 裁剪中在**原位置**留一块半透明占位（该类的底色 ＋ 一圈边）。条子跟着鼠标走，
       原来在哪就没了——没有这块影子，松手之前判断不出自己挪了多远。 */
    const ghost = gesture ? {left: vx(ctx, el.start, pxps), width: Math.max(2, vw(ctx, el.start, el.end, pxps))} : null;
    return (
      <>
      {ghost ? <div className="tghost" style={{...ghost, top: 4, height: row.h - 8,
        background: c.bg, boxShadow: `inset 0 0 0 1px ${c.border}`}} /> : null}
      {/* 抓取带（第 226 轮）：一层透明的热区，纵向吃满整行、横向比条子各宽出 3px。
          元素行高 30、条子只有 22（`top: 4` + `height: h - 8`），上下各 4px 从前谁也不接：
          瞄一条十几像素宽的贴纸，稍微偏上偏下就按到行底色上，起的是框选而不是拖动。
          同类共道后一行里会并排多件，两侧各借的量按与邻块的间隙收（上面的 GRAB_L / GRAB_R）。
          排在条子**前面**，所以条子仍画在它上面，视觉一动没动。 */}
      <div className="tgrab"
        style={{left: vx(ctx, span.start, pxps) - GRAB_L, width: w + GRAB_L + GRAB_R, height: row.h,
          cursor: gesture === 'drag' ? 'grabbing' : 'grab'}}
        onMouseEnter={() => setHot(true)} onMouseLeave={() => setHot(false)}
        onMouseDown={down(GRAB_L)}
        onContextMenu={(e) => {
          e.preventDefault(); e.stopPropagation();
          if (!on) focus(null);
          onMenu({kind: 'element', id: el.id, name: el.name, x: e.clientX, y: e.clientY});
        }}
        onClick={(e) => e.stopPropagation()} />
      <div className={cx('tblk', 'telb', isMedia && 'telb--media', isWb && 'telb--wb', gesture && 'is-drag', offOne && 'is-off')}
        style={{
          left: vx(ctx, span.start, pxps), width: w, top: 4, height: row.h - 8,
          background: on ? c.sel : c.bg, color: c.fg,
          boxShadow: `inset 0 0 0 ${on ? 2 : 1}px ${edge}`,
          cursor: gesture === 'drag' ? 'grabbing' : 'grab',
        }}
        onMouseEnter={() => setHot(true)} onMouseLeave={() => setHot(false)}
        onMouseDown={down(0)}
        onContextMenu={(e) => {
          e.preventDefault(); e.stopPropagation();
          if (!on) focus(null);
          onMenu({kind: 'element', id: el.id, name: el.name, x: e.clientX, y: e.clientY});
        }}
        onClick={(e) => e.stopPropagation()}>

        {/* 入场 / 出场动画带：条子头尾各占一小段，长度是 In/Out 的时长 */}
        {bands.in ? <span className="tanim tanim--in" style={{width: bands.in * pxps}} /> : null}
        {bands.out ? <span className="tanim tanim--out" style={{width: bands.out * pxps}} /> : null}

        {/* 视频元素与主轨的 clip 同一套视觉：上半缩略图带 + 下半自己的波形 */}
        {isVideo && !imp.active && TL.showsMedia(w)
          ? <MediaBody w={w} h={row.h - 8} seed={el.start} pxps={pxps} hue={el.hue} muted={el.muted} /> : null}
        {isWb && TL.showsMedia(w)
          ? <window.WhiteboardBody ctx={ctx} w={w} h={row.h - 8} pxps={pxps} wb={wb}
              dur={Math.max(0.1, span.end - span.start)} c={c} write={writeWb} /> : null}

        {/* 运动标记（G11a）：元素带关键帧（整段运动、多段、音量包络都算）时标签里一枚菱形，
            悬停读「N 个关键帧」；只画标记，不在块上逐点画——逐点编辑不在界面上做 */}
        {imp.active ? <ImportBody state={imp} w={w} hue={el.hue} /> : label ? (
          isMedia ? (
            // 名字压在缩略图上，得有一层深底才读得出——与 clip 的场景编号角标同一套
            <span className="tmedlb"><Ic n={el.icon} className="ic--14" />{title}{kfMark}</span>
          ) : (
            <>
              <Ic n={el.icon} className="ic--14" />
              <span className="t-truncate">
                {/* 文本块写的是文字内容本身，不是类型名；
                    文本组写成员数，成员行才写各自的内容 */}
                {el.kind === 'textgroup'
                  ? `文本组 · ${(el.members || D.textGroup.members).length} 个元素` : title}
              </span>
              {kfMark}
              {bands.loop ? <span className="tloop" title="循环动画">∞</span> : null}
            </>
          )
        ) : null}
        {isVideo && el.broll && label ? <em className="tbroll">B-roll</em> : null}
        {isWb && w >= 150 ? <window.WhiteboardMeta wb={wb} /> : null}

        {/* 两端修边热区（第 226 轮）：画的是**两整段热区**，不是两根装饰条——宽度就是
            `TL.blockEdgeZone(w)`，与 `down()` 的判据同一个数，光标承诺的那一段和真正
            会起修边手势的那一段逐像素相同。热区自己不挂 handler，按下冒泡到块本体
            那一个 `down`，判边由 `blockEdgeSide` 独家裁决。
            此前这两根条只在 hover / 选中且 `w ≥ 45` 时才出，窄贴纸因此没有边可拖。 */}
        {zone >= TL.HANDLE_MIN_ZONE ? (
          <>
            <span className="thnd thnd--l" style={{width: zone, ['--thnd-tint']: c.hover}}>
              <i className="thnd__p" style={{background: c.hover}} /></span>
            <span className="thnd thnd--r" style={{width: zone, ['--thnd-tint']: c.hover}}>
              <i className="thnd__p" style={{background: c.hover}} /></span>
          </>
        ) : null}

        {gesture ? (
          <span className="ttip t-mono">
            {gesture === 'right' ? T.timecode(span.end) : T.timecode(span.start)}
            {gesture === 'drag' ? ` · ${(span.end - span.start).toFixed(1)}s` : null}
          </span>
        ) : null}
      </div>
      </>
    );
  }
  /* ---------- 文本组的成员行 ----------
     §14.2 / §12.7 一直写着「一条组行 + 缩进成员行（起点按 delay 错峰）」，
     实现里一直只有组行；第 39.5 轮补上，第 105 轮起成员泳道**常开**
     （时间轴不读 Tab）：成员堆叠成子行、位置相对组行算。
     **成员行只读**：起点由预设自带的 `delay` 决定，改错峰去面板的组视图；
     点一条 = 钻入那个成员（§14.2 的「点时间轴成员行 = 钻入该元素」）。 */
  function MemberBlock({group, member, row, pxps, ctx, draft}) {
    // 组行拖动中读的是草稿区间——不然拖着组走、成员留在原地，看着像坏了
    const sp = TL.memberSpan(draft && draft.id === group.id ? {...group, ...draft} : group, member);
    const c = stops(group.hue);
    const w = Math.max(2, vw(ctx, sp.start, sp.end, pxps));
    const on = ctx.sel && ctx.sel.kind === 'member' && ctx.sel.id === member.id;
    /* 成员各有各的入场出场（第 59 轮：预设自带的那份就落在成员上），所以成员行也画
       动画带——组行只画组自己那份。此前这一条上什么都没有，改完一条成员的入场，
       时间轴上看不出改过。 */
    const bands = TL.animBands(sp, (ctx.elDocs[member.id] || {}).anim || member.anim);
    return (
      <div className={cx('tblk', 'tmem', on && 'is-on')}
        style={{left: vx(ctx, sp.start, pxps), width: w, top: 3, height: row.h - 6,
          background: on ? c.sel : c.bg, color: c.fg,
          boxShadow: `inset 0 0 0 ${on ? 2 : 1}px ${on ? c.hover : c.border}`}}
        title={`${member.name} · ${member.text} · 延迟 ${member.delay}s`}
        onClick={(e) => {
          e.stopPropagation();
          pickBlock(ctx, {kind: 'member', id: member.id, member}, {start: sp.start, end: sp.end}, e, on);
          // 成员的属性页在 Text 栏里（图片成员也是——第 58.1 轮：「图片」栏是素材库，
          // 没有这条成员的任何属性）
          ctx.setTab('text');
          ctx.setPaneHidden(false);
        }}>
        {bands.in ? <span className="tanim tanim--in" style={{width: bands.in * pxps}} /> : null}
        {bands.out ? <span className="tanim tanim--out" style={{width: bands.out * pxps}} /> : null}
        {TL.showsLabel(w) ? (
          <>
            <Ic n={member.icon} className="ic--14" />
            <span className="t-truncate">{TL.truncate(member.text)}</span>
            {member.delay ? <i className="tdelay">+{member.delay}s</i> : null}
            {bands.loop ? <span className="tloop" title="循环动画">∞</span> : null}
          </>
        ) : null}
      </div>
    );
  }
  /* ---------- 字幕行（恒展开，第 105 轮） ----------
     逐条 cue、块上写这一条字幕的**文字本身**。第 39.3 轮做的
     「非字幕 Tab 收成合并带」两态已退役——时间轴不随右栏 Tab 改变。
     字幕块与元素块不同的两点：
       · 底色是**饱和的深色 + 白字**，不是别的类别那种浅底深字——小块上要塞真文字，
         浅底浅字读不出来；
       · **选中换的是底色**（更深一档），不是加一圈描边——一行 62 个块，描边会糊成一片。
     色相留在蓝系：字幕是本产品的核心对象，蓝是它从第 14 轮起的 lane 色，
     rail 图标、画布选中、音频轨都跟着这一支；换色要一路改过去，收益不抵成本。 */
  function SubsRow({ctx, row, pxps}) {
    const {sel} = ctx;
    /* 一行 = 一条字幕轨（第 45 轮）。轨落在时间轴上就固定在那里——点它、切 Tab、
       换语言下拉都不会把它拿走，只会换「我在编辑哪一条」。块上写的是这条轨自己
       那门语言的文字，所以双语项目的两行读起来是两种语言，不是同一行叠两句。 */
    const track = row.track || {};
    const isSrc = track.role !== 'translation';
    /* §12.6：点字幕行 = **内容意图** —— 进这条轨的校对列表，顺带把隐藏的
       字幕开回来。与画布点字幕（样式意图，进属性页）刻意分成两条路。
       点某一条 cue 时选中的是那条 cue，不被整轨的选中盖掉——cue 选中带着 `trackId`，
       字幕 Tab 的列表据此落到这条轨上（译文轨 = 双语对照，第 152 轮起同一个 Tab）。 */
    const enter = () => {
      ctx.setSubsOn(true);
      ctx.setTab('subtitle');
      ctx.setPaneHidden(false);
    };

    /* 第 196 轮：剪口播剪掉的那段从字幕块里抠掉——块跟着主视频**行内分割**，整句剪掉的不画。
       译文块另加一道标记：原文有字被剪、译文还没按剪后原文处理的，标「原文被剪切」（§13.1），
       成批处理走 AI 工具的「刷新过期译文」。只剪掉句尾停顿的不标——译文不用动。 */
    const cuts = ctx.cuts || [];
    /* 第 220 轮：转录中**只门控这一条轨**——视频照常放、别的行照常在。转录到第几秒，
       轨就画到第几秒：`at` 之前整句识别到的 cue 照常画，最后一条末尾挂一根光标（识别中；
       没有写到一半的句子，第 243 轮）；`at` 到片尾铺一条「转录中」待定带（斜纹、低对比，宽度够时
       写「转录中 · 还剩 mm:ss」），带的前缘就是文稿面板正流到的那个位置。带上点一下 =
       正常 seek（它不是块，没有选中语义）。两段的切法是纯函数 `BC_TX.liveTrackSlice`。
       只在第一次转录（视频还没有字幕）时这样画；重新转录时 `ctx.liveAt` 是 null，已有的轨原样（`product-design` §5.7）。 */
    const live = ctx.liveAt != null ? window.BC_TX.liveTrackSlice(ctx.cues, ctx.duration, ctx.liveAt) : null;
    const shown = live ? live.settled : ctx.cues;
    const out = [];
    const paint = (cu, tail) => {
      const pieces = CUT.keptPieces(cuts, cu.start, cu.end);
      if (!pieces.length) return;
      const on = sel && sel.kind === 'cue' && sel.id === cu.id && sel.trackId === track.id;
      const text = isSrc ? cu.text : cu.trans;
      const stale = !isSrc && !!CUT.transStale(cuts, cu);
      pieces.forEach((pc, i) => {
        const w = Math.max(2, vw(ctx, pc.start, pc.end, pxps) - 2);
        const lb = TL.cueLabel(Object.assign({}, cu, {text, start: pc.start, end: pc.end}), w, false);
        out.push(
          <div key={cu.id + ':' + i} className={cx('tblk', 'tcue', !isSrc && 'tcue--tr', stale && 'tcue--cutstale', on && 'is-on')}
            style={{left: vx(ctx, pc.start, pxps), width: w, top: 5, height: row.h - 10}}
            onClick={(e) => {
              e.stopPropagation();
              enter();
              pickBlock(ctx, {kind: 'cue', id: cu.id, trackId: track.id},
                {start: cu.start, end: cu.end}, e, on);
            }}
            title={tail ? `${text} · 识别中` : stale ? `${text} · 原文被剪切，译文待处理` : text}>
            {lb ? <span className="tcue__t">{lb.text}{tail ? <b className="tcue__cur" /> : null}</span>
              : tail ? <b className="tcue__cur" /> : null}
          </div>
        );
      });
    };
    shown.forEach((cu) => paint(cu, !!live && isSrc && live.tail === cu));
    if (live && live.pending) {
      const {start, end} = live.pending;
      const w = Math.max(2, vw(ctx, start, end, pxps));
      const left = Math.round(vx(ctx, start, pxps));
      const remain = T.timecode(end - start, {decimals: 0});
      const pct = Math.round(ctx.liveJob.pct);
      out.push(
        <div key="pending" className="tpend" style={{left, width: w, top: 5, height: row.h - 10}}
          title={`转录中 ${pct}% · 已到 ${T.timecode(start, {decimals: 0})} · 还剩 ${remain}`}
          onClick={(e) => {
            e.stopPropagation();
            /* 带上点哪里播放头就落哪里——它是时间轴上一段普通的地面，不是可选中的块 */
            const r = e.currentTarget.getBoundingClientRect();
            const f = (ctx.tmap ? ctx.tmap.view(start) : start) + (e.clientX - r.left) / pxps;
            const t = ctx.tmap ? ctx.tmap.skip(ctx.tmap.unview(f)) : f;
            ctx.seek(Math.max(start, Math.min(end, t)));
          }}>
          <i className="tpend__dot" />
          {w >= 150 ? <span className="tpend__t">转录中 · 还剩 {remain}</span>
            : w >= 60 ? <span className="tpend__t">转录中</span> : null}
        </div>
      );
    }
    return out;
  }
  /* ---------- 只读的文稿行（2026-10-08，§12.6） ----------
     转录过、却一条字幕轨都没有时，文稿一句一块落在字幕行的位置上（`TL.rows` 的 `transcript`）。
     块是中性灰、不是字幕蓝：它不上画面、不进导出；不可选中、不可裁，点一句只把播放头落到句首。
     剪掉的段照样从块里抠掉（与字幕块同一套 `keptPieces`）。 */
  function TranscriptRow({ctx, row, pxps}) {
    const cuts = ctx.cuts || [];
    const out = [];
    ctx.cues.forEach((cu) => {
      CUT.keptPieces(cuts, cu.start, cu.end).forEach((pc, i) => {
        const w = Math.max(2, vw(ctx, pc.start, pc.end, pxps) - 2);
        const lb = TL.cueLabel(Object.assign({}, cu, {start: pc.start, end: pc.end}), w, false);
        out.push(
          <div key={cu.id + ':' + i} className="tblk ttx"
            style={{left: vx(ctx, pc.start, pxps), width: w, top: 5, height: row.h - 10}}
            onClick={(e) => { e.stopPropagation(); ctx.seek(pc.start); }}
            title={`${cu.text} · 文稿（只读）`}>
            {lb ? <span className="tcue__t">{lb.text}</span> : null}
          </div>
        );
      });
    });
    return out;
  }

  /* 主轨 `VideoClip` 已退役（2026-09-16）：项目原片是普通视频元素，走上面的 `ElementBlock`
     （`telb--media`，同样的「上半缩略图带 + 下半波形」两层）。 */
  /* ---------- 音频 / 音乐块 ----------
     音频块的波形铺满整条高度（与视频块只占下半相对），块上写**素材名**，
     图标随静音切换；45px 阈值同样生效。 */
  function AudioBlock({name, start, end, pxps, h, muted, kind, ctx, ducked}) {
    const app = useApp();
    const w = Math.max(2, vw(ctx, start, end, pxps) - 2);
    const waveH = h - 8;
    // 配音后原声「压低到 −18 dB」（§15.4）：不是静音，块上标出来，波形也压扁
    const label = ducked && !muted ? `${name} · −18 dB` : name;
    return (
      <div className={cx('tblk', 'taud', kind === 'music' && 'taud--music', kind === 'bed' && 'taud--bed', muted && 'is-muted', ducked && 'is-ducked')}
        style={{left: vx(ctx, start, pxps), width: w, top: 4, height: h - 8}}
        onClick={() => app.toast(muted ? `${name}（已静音）` : label)} title={label}>
        {TL.showsMedia(w) ? (
          <svg className="taud__w" width="100%" height={waveH} preserveAspectRatio="none"
            viewBox={`0 0 ${Math.max(20, Math.round(w))} ${waveH}`}>
            <path d={TL.wavePath(Math.max(20, Math.round(w)), waveH, start)} fill="currentColor" opacity="0.38" />
          </svg>
        ) : null}
        {TL.showsLabel(w) ? (
          <span className="taud__n"><Ic n={muted ? 'vol0' : ducked ? 'vol1' : 'vol3'} className="ic--14" />{label}</span>
        ) : null}
      </div>
    );
  }

  /* 配音行搬到 timeline-dub.jsx（2026-09-11：淡色块、拉伸把手、行头菜单，这里放不下了） */

  /* ---------- 模板行（第 218 轮） ----------
     此前模板行借用 ElementBlock 画：一条可拖可裁的紫条，写着「模板」——看不出是哪套、
     也看不出它管着画幅，还能被拖成半截（模板没有「一半时间生效」这回事）。
     现在是自己的一块：贯穿全片、不可拖不可裁；块上一张小缩略图 ＋ 「模板 · 名字」＋
     锁着画幅时一枚锁章（写着锁的那一档）。点一下 = 选中模板、面板翻到模板属性页；
     双击 = 直接进版面编辑器。右键仍走元素菜单（移除模板在属性页底部）。 */
  function TemplateBlock({row, ctx, on, pxps, onMenu}) {
    const el = row.el;
    const tpl = ctx.tplDoc;
    const c = stops(el.hue);
    const w = Math.max(2, vw(ctx, 0, ctx.duration, pxps));
    const lock = ctx.ratioLock;
    const label = TL.showsLabel(w);
    const open = (e) => {
      pickBlock(ctx, {kind: 'element', id: el.id, elKind: 'tpl'}, {start: 0, end: ctx.duration}, e, on);
      ctx.setTab('elements');
      ctx.setPaneHidden(false);
    };
    return (
      <div className={cx('tblk', 'ttpl', on && 'is-on')}
        style={{left: vx(ctx, 0, pxps), width: w, top: 4, height: row.h - 8,
          background: on ? c.sel : c.bg, color: c.fg,
          boxShadow: `inset 0 0 0 ${on ? 2 : 1}px ${on ? c.hover : c.border}`}}
        title={tpl ? `模板「${tpl.name}」贯穿全片，不能拖动或裁剪` + (lock ? ` · ${lock.note}` : '') : undefined}
        onMouseDown={(e) => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); open(e); }}
        onDoubleClick={(e) => { e.stopPropagation(); if (tpl) ctx.openTplStudio({source: 'project', tpl}); }}
        onContextMenu={(e) => {
          e.preventDefault(); e.stopPropagation();
          if (!on) open(null);
          if (onMenu) onMenu({kind: 'element', id: el.id, name: el.name, x: e.clientX, y: e.clientY});
        }}
        onClick={(e) => e.stopPropagation()}>
        {tpl && w >= 96 ? <window.TemplateThumb tpl={tpl} h={row.h - 12} ctx={ctx} className="ttpl__th" /> : null}
        {label ? (
          <>
            <Ic n={el.icon} className="ic--14" />
            <span className="t-truncate">{el.name}</span>
            {lock && w >= 160 ? (
              <span className="ttpl__lock" style={{background: c.sel, boxShadow: `inset 0 0 0 1px ${c.border}`}}>
                <Ic n="lock" className="ic--12" />{window.BC_TPL.ratioLabel(lock.ratio)}
              </span>
            ) : null}
            {w >= 260 ? <span className="ttpl__span">贯穿全片</span> : null}
          </>
        ) : null}
      </div>
    );
  }

  Object.assign(window, {stops, MediaBody, ImportBody, ElementBlock, MemberBlock, SubsRow, TranscriptRow, TemplateBlock,
    AudioBlock, timelineModsOf: modsOf, pickTimelineBlock: pickBlock});
})();
