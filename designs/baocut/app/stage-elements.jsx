/* 舞台上的元素层 —— §14（第 115 轮从 [stage.jsx](stage.jsx) 拆出来）。
   ============================================================================
   这一份管画面里**除字幕之外**的一切：普通视频、十三条演示装置、按需那六类、用户造
   出来的元素，以及它们各自的选中框、就地文字编辑与逐帧动效求值。拆出来的直接原因
   是行数——stage.jsx 到第 115 轮已经 770 行，早过了 600 的上限；边界选在这里是因为
   `paint()` 与那张渲染循环只依赖 `ctx` 与画面缩放系数 `k`，与画幅、字幕、工具条无关。

   第 115 轮在搬家之外新增三件（§6）：
     · **多选不各自出手柄**：`sels` 里有两件及以上时，每件只留一条细描边（`.selthin`），
       手柄归 [stage-marquee.jsx](stage-marquee.jsx) 的统一框；
     · **双击就地改字**：`text` 走 contentEditable，提交写回 `setElDoc`，进撤销栈；
     · **播放中点一件 = 暂停 ＋ 选中**：不暂停的话手柄下一帧就被起播那条规则收走。
   ============================================================================ */
(function () {
  const {useEffect} = React;
  const D = window.BC_DATA;
  const P = window.BC_POSE;
  const PV = window.BC_PREV;

  /* 画布上的演示元素（§14）。位置按百分比，极端比例下不会像 px 定位那样出框。
     每一个都走「点击 = 选中 + 按类型工具条 + 面板切到对应 Edit 视图」这一条。 */
  /* 画布上的演示元素（§14.2 的默认摆位）。前六个常驻，后五个**选中时才出**——
     §14.2 的模型是「点磁贴 = 创建 + 自动选中」，十一类同时铺在画面上没法看，
     但它们的浮动工具条得够得着（第 39.7 轮：所有类型的条子都要能打开）。 */
  /* 摆位不在这里——它是 `place`（x/y 中心百分比 ＋ w 画幅宽百分比），第 40 轮起随
     scale/rot 一起住在 `ctx.elDocs[id].pose` 里，初值来自 `D.elements[].place`。
     这两张表只回答「常驻还是按需」与「画布上叫什么」。 */
  const CANVAS_ELEMENTS = [
    /* 画布上这一块是**文本组**（§14.2 / round17：点画布 = 选中整组，再点成员 = 钻入）。
       两级各有自己的一套工具条：组走 `groups` 那一族（解组 / 删除，没有 `···`），
       成员走 `text`（文字样式 / 颜色字体字号 / 动画效果）。两处都不出「存到品牌库」
       ——第 79 轮起它只住在属性面板（Edit text 的「存为文字样式 +」）。 */
    {kind: 'text',    id: 'e-txt', alt: 'textgroup'},
    {kind: 'sticker', id: 'e-stk'},
    {kind: 'shape',   id: 'e-shp'},
    {kind: 'image',   id: 'e-img'},
    {kind: 'video',   id: 'e-vid'},
  ];
  const ON_DEMAND = [
    {kind: 'progress', id: 'e-prg'},
    {kind: 'wave',     id: 'e-wav'},
    {kind: 'counter',  id: 'e-cnt'},
    {kind: 'overlay',  id: 'e-ovl'},
    {kind: 'vframe',   id: 'e-vfr'},
  ];

  /* 就地文字编辑（§2）：contentEditable 而不是覆一层 textarea——字幕与文字元素的
     涂装（描边、底板、字距）全在 CSS 上，textarea 复刻不出来，编辑中与编辑后会是
     两个样子。Enter 提交、⇧Enter 换行、Esc 提交并退出；失焦（点空白）同样提交。
     所有 keydown 就地吞掉：编辑器的全局快捷键在这一格里一律失效（editor-keys.jsx
     的 `inField` 也认 contentEditable，两道守卫都留着）。 */
  function TextEdit({ctx, id, text, css}) {
    const ref = React.useRef(null);
    React.useEffect(() => {
      const n = ref.current;
      if (!n) return;
      n.focus();
      /* 进来就整段选中：双击的语义是「改这块字」，不是「在某个字缝里落一个光标」。 */
      const r = document.createRange();
      r.selectNodeContents(n);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }, [id]);
    const commit = () => {
      const v = (ref.current ? ref.current.innerText : text).replace(/\n+$/, '');
      if (v !== text) ctx.setElDoc(id, {text: v});
      ctx.stopEdit();
    };
    return (
      <div ref={ref} className="txtedit" contentEditable suppressContentEditableWarning
        style={Object.assign({display: 'block'}, css)}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); commit(); }
        }}>{text}</div>
    );
  }

  /* 第 122 轮：**每一件元素的属性都是它自己的**。此前只有文字（第 58
     轮）、图片（第 58.2 轮）、视频（第 84 轮）读自己那份，其余每类只有一条演示元素，
     一律读共用袋 `elStyle`——于是造两个形状就只能是同一个填充色，改第二个会把第一个
     一起改掉。现在共用袋降格成**这一类的缺省值**（`data.js` 的 `canvasStyle`），
     真相是 `elDocs[id].style` 盖在它上面（合并规则在 `elStyleOf`，一处）。 */
  const TEXTY = (kind) => kind === 'text' || kind === 'textgroup';

  /* 按 id 选中一件舞台元素，连带右侧面板那两步。渲染循环与「穿过主视频选中框」
     （[stage-frame.jsx](stage-frame.jsx)）都走这一条，免得两处各写一遍面板副作用。 */
  const pickStageEl = (ctx, id, opts) => {
    const known = CANVAS_ELEMENTS.concat(ON_DEMAND).filter((e) => e.id === id)[0];
    const doc = (ctx.elements || []).filter((e) => e.id === id)[0];
    const kind = (known && known.kind) || (doc && doc.kind) || 'element';
    ctx.pick({kind: 'element', id, elKind: kind}, opts || {});
    ctx.setTab(TEXTY(kind) ? 'text' : kind === 'image' ? 'image' : kind === 'video' ? 'video' : 'elements');
    ctx.setPaneHidden(false);
  };

  /** 画面上的元素层。`k` 是画面缩放系数，`st` 是共用样式袋（悬停预览之后的那一份）。 */
  function StageElements({ctx, st, k, frameRef, onGuides, mode, swallow, rank}) {
    const app = useApp();
    const {sel, playT} = ctx;
    const localElapsed = window.useLocalMotionPreview(ctx.peek, ctx.playing, ctx.setPeek);
    const {setElStyle: set} = ctx;
    /* 这一件此刻的样式：`elStyleOf` 把它自己那份盖在类缺省（`st`）上。
       悬停预览（`peekOf('el', …)`）**只作用在选中的那一件**上——袋子逐元素之后，
       不收敛的话在目录里停一格会把画面上同类的每一件一起改样子。 */
    const styleOf = (id) => {
      const own = ctx.elStyleOf ? ctx.elStyleOf(id) : st;
      return ctx.isSel('element', id) || ctx.isSel('member', id) ? ctx.peekOf('el', own) : own;
    };
    const memberStyle = (base, member) => {
      const own = Object.assign({}, base, member.style);
      return ctx.isSel('member', member.id) ? ctx.peekOf('el', own) : own;
    };
    const setOf = (e) => (patch) => set(patch, e.id);
    /* 组与成员各有各的一套条子（§14.2 / round17）；盒子仍是组的，所以命中一律按 id。 */
    const memberSel = !!(sel && sel.kind === 'member');
    const selKind = sel && sel.kind === 'element' ? sel.elKind
      : memberSel ? (sel.member && sel.member.kind === 'image' ? 'image' : 'text')
      : null;
    const selId = sel && sel.kind === 'element' ? sel.id
      : sel && sel.kind === 'member' && ctx.groupOf ? ((ctx.groupOf(sel.id) || {}).id || null)
      : null;
    /* 统一框接管手柄的判据（§6）：元素那一家（元素与字幕条）里选了两件及以上；字幕轨的多选另画（stage-marquee.jsx）。 */
    const multi = window.BC_SELECT.elMembers(ctx.sels).length >= 2;
    // 删掉的不再画；停用的（第 120 轮，时间轴行头那只眼睛）也不画——它还在文档里，只是这一轮不上画面
    const live = (id) => (ctx.elements || []).some((e) => e.id === id) && !((ctx.elDocs || {})[id] || {}).hidden;
    const userEls = (ctx.elements || []).filter((e) => e.added && e.kind !== 'audio');
    /* 叠放次序（product-design §5.1）：时间线上越靠上的轨道越在前面，画面与字幕同一叠。`rank` 由
       stage.jsx 按时间线行算好（`BC_TL.stackRank`，字幕轨也在里面），这里每件的 `zIndex` 就是它的名次，
       只在 `.stagestack` 里比——压不过模板、参考线与统一框。同一条轨道上名次相同，按 DOM 先后。 */
    const zOf = (id) => (rank || {})[id] ?? 0;
    const byStack = (list) => list.map((e, i) => [e, i])
      .sort((a, b) => zOf(a[0].id) - zOf(b[0].id) || a[1] - b[1]).map((x) => x[0]);
    /* 按需那六类「在不在画面上」与「选没选中」第 115 轮起分开：选中一次就留在画面上
       （进 `ctx.shown`），取消选中不再让它消失，删除才拿走。 */
    const shown = ctx.shown || [];
    useEffect(() => {
      ON_DEMAND.forEach((o) => { if (ctx.isSel('element', o.id)) ctx.showEl(o.id); });
    });
    const elDoc = (kind) => D.elements.find((e) => e.kind === kind) || D.elements[0];
    // 缺省摆位在 `BC_POSE.POSE0` 一处（第 85 轮）——菜单里那几件也读同一份
    const poseOf = (id) => window.BC_POSE.poseOf(ctx.elDocs[id]);

    /* 双击进编辑（§2）。**成员组暂不进这条路**：一个组没有单一的 `doc.text`，
       改哪一条成员得先有「双击命中的是哪一件」——那一层归属登记在 README 台账，
       这一轮先把单块文字打通，组仍在右侧属性面板逐条改写。 */
    const beginEdit = (e) => {
      if (!TEXTY(e.kind)) return;
      const mem = ((ctx.elements || []).filter((x) => x.id === e.id)[0] || {}).members;
      if (mem && mem.length) { app.toast('文本组的文字在右侧属性面板逐条改写'); return; }
      if (ctx.playing) ctx.setPlaying(false);
      ctx.startEdit(e.id, e.kind);
    };
    const editBody = (e, pose) => (
      <TextEdit ctx={ctx} id={e.id}
        text={(ctx.elDocs[e.id] || {}).text || e.label || e.name || ''}
        css={window.BC_TP.textCss(window.BC_TP.fromStyle(styleOf(e.id)), k * (pose.scale || 1))} />
    );

    /* ---------- 文字的逐帧状态（第 59 轮） ----------
       预设自带的入场 / 出场 / 循环由 `BC_TA` 按 `playT` 现算，不挂 CSS keyframes——
       挂 keyframes 的话动画只认自己的时钟，与播放头无关，播到哪一秒画面上都对不上。

       两条边界规矩，都是为了「点了目录，画面上要有东西」：

       1. **演示装置一直画着**。`D.elements` 那十三条是每类一条的取景装置，不按时间
          收放——否则默认播放头一落在 12.4s，画面上就只剩底图了。用户造出来的那些
          （`added`）按自己的时间段收放，那才是真元素的行为。
       2. **暂停时画稳定帧，播放时才走动效**。落点恒等于播放头，所以刚点完那一刻
          `t = 0`，逐帧求值给出的正是入场的第一帧——淡入的第一帧是全透明的，用户
          看到的就是「点了没反应」。暂停时看构图、播放时看动效，两件事分开。 */
    const TA = window.BC_TA;
    const TP = window.BC_TP;
    const HIDDEN = Object.assign({}, TA.ID, {op: 0, hidden: true});
    const spanOf = (id, e) => {
      const d = ctx.elDocs[id] || {};
      const s0 = d.start == null ? (e.start || 0) : d.start;
      const s1 = d.end == null ? (e.end == null ? D.DUR : e.end) : d.end;
      return {start: s0, end: s1};
    };
    /* 一条成员（或单块文字）此刻的画面状态。
       **画不画看的是这一组的时间段，不是成员延迟之后的那一小段**：错峰是入场时序，
       不是可见窗口——按延迟去卡，组刚开始那一帧带延迟的成员就整条不见，用户看到的
       是一个缺了两行的下三分。延迟只在播放时参与求值。 */
    const frameOf = (anim, sp, delay, added, prev) => {
      if (prev && prev.local) {
        const sample = PV.localSample(ctx.peek, prev.id, localElapsed);
        return TA.at(sample.anim, sample.t, sample.duration);
      }
      /* `prev` = 这一件正被悬停预览着（第 122 轮）。预览要绕开上面第 1 条：
         演示装置本来一直画稳定帧，不绕开的话，动画目录停在哪一格画面都不动。 */
      if (!added && !prev) return TA.ID;
      if (playT < sp.start || playT > sp.end) return prev ? TA.ID : HIDDEN;
      if (!ctx.playing) return TA.ID;
      /* Zoom 是第四个槽，`TA.isStatic` 只看 in/out/loop——只设了运镜的元素会被它
         判成「不动」，画面上就永远推不起来。 */
      if (TA.isStatic(anim) && !PV.hasZoom(anim)) return TA.ID;
      const d = delay || 0;
      const f = TA.at(anim, playT - sp.start - d, (sp.end - sp.start) - d);
      const z = PV.zoomScale(anim && anim.zoom, playT - sp.start, window.BC_EL.ZOOM_SCALE);
      if (z === 1 || f.hidden) return f;
      return Object.assign({}, f, {sx: f.sx * z, sy: f.sy * z});
    };
    /** 正被悬停预览的是不是这一件。 */
    const prevOf = (id, groupId) => {
      const peek = ctx.peek;
      if (peek && peek.localWin) return peek.targetId === id ? {local: true, id} : false;
      return !!(peek && (peek.kind === 'anim' || peek.kind === 'segment') && peek.id === (groupId || id));
    };
    /** 这一件此刻该按哪份动画求值：预览把被指的那一支**临时**盖上去（不进文档、
        不进历史）。`peekOf` 只按 kind 配对，元素身份写在文档里——不是这一件就原样退回。 */
    const animOf = (id, own) => (ctx.peekOf ? ctx.peekOf('anim', {id, anim: own}).anim : own);

    /* 元素本体的画面呈现——只是示意，不假装是真渲染。
       `fillH`（第 122 轮）：这一件写过显式高度（`pose.h`，四边缩放的产物）时内容
       **非等比铺满**盒子——盒子这时是用户拉出来的，不再是内容的宽高比说了算。
       只有自由比例那一族（贴纸 / B-roll / 进度条 / 声波 / 占位盒）会有 `pose.h`。 */
    const paint = (e, pose) => {
      const fillH = pose.h != null && P.caps(e.kind).resize === 'free';
      /* 画的一律是**这一件自己**那份样式（第 122 轮）：外层那个共用袋只是类缺省，
         `styleOf` 已经把它当底了。遮住同名的 prop，免得下面几十处再逐个改。 */
      const st = styleOf(e.id);
      if (e.kind === 'text' || e.kind === 'textgroup') {
        const ts = styleOf(e.id);
        const sp = spanOf(e.id, e);
        const doc = ctx.elDocs[e.id] || {};
        /* 文本组画的是它自己的成员（各自的字号、色与落位），所以画布上看到的就是目录卡
           上那一格的样子——「点下去画面就是缩略图的样子」这条对文字预设同样成立。
           成员表从投影里取（第 58.1 轮）：改一条成员的文字，画面跟着变。 */
        const mem = ((ctx.elements || []).filter((x) => x.id === e.id)[0] || {}).members;
        const bx = doc.box || e.box || null;
        if (mem && mem.length && bx && mem.some((m) => m.place && m.place.x != null)) {
          /* 场景式的组（那 51 条文字预设里的下三分与整屏标题）：每一件各摆各的，位置换算
             成**相对组包围盒**的百分比，整组仍然是一个可拖可缩的盒子。 */
          const rel = (m) => ({
            position: 'absolute',
            left: ((m.place.x - (bx.x - bx.w / 2)) / bx.w * 100) + '%',
            top: ((m.place.y - (bx.y - bx.h / 2)) / bx.h * 100) + '%',
            width: m.place.w == null ? 'auto' : (m.place.w / bx.w * 100) + '%',
          });
          return <span style={{display: 'block', position: 'relative', width: '100%',
            paddingTop: (bx.h * 495 / (bx.w * 880) * 100) + '%'}}>
            {mem.map((m) => {
              const f = frameOf(animOf(m.id, animOf(e.id, m.anim)), sp, m.delay, e.added, prevOf(m.id, e.id));
              if (f.hidden) return null;
              const box = Object.assign(rel(m), TA.css(f, 'translate(-50%, -50%)'));
              if (!box.transform) box.transform = 'translate(-50%, -50%)';
              if (m.kind === 'shape') {
                const sh = TP.shapeCss(m.shape, k);
                sh.width = '100%';
                sh.paddingTop = (m.place.h * 495 / (m.place.w * 880) * 100) + '%';
                return <span key={m.id} style={box}><span style={Object.assign({display: 'block'}, sh)} /></span>;
              }
              const cs = TP.textCss(TP.fromStyle(memberStyle(ts, m)), k * (pose.scale || 1));
              return <span key={m.id} style={Object.assign({}, box, {textAlign: cs.textAlign})}>
                <span style={Object.assign({display: 'block'}, cs)}>
                  {TA.revealText(m.text, f.reveal)}
                </span>
              </span>;
            })}
          </span>;
        }
        if (mem && mem.length) {
          /* 老式的堆叠组（演示装置那条）：成员没有自己的落位，一行一行往下码。 */
          return <span style={{display: 'block'}}>
            {mem.map((m) => (m.kind === 'image' ? (
              /* 图片成员画成一小块（第 58.2 轮）：不画的话，成员页上的替换/圆角/
                 不透明度全都是改了看不见的旋钮。 */
              <span key={m.id} style={{display: 'block', width: '34%', paddingTop: '20%',
                margin: '0 auto ' + 0.3 + 'em',
                borderRadius: ((m.style || {}).round ? ((m.style || {}).radius || 0) : 0) * k,
                opacity: ((m.style || {}).opacity == null ? 100 : (m.style || {}).opacity) / 100,
                filter: window.BC_EL.fxCss(m.style) || null,
                background: ((window.imageSourceOf(m.text) || {}).grad) || 'var(--gray-400)'}} />
            ) : (
              <span key={m.id} style={Object.assign({display: 'block', textAlign: memberStyle(ts, m).align || 'center'},
                TA.css(frameOf(animOf(m.id, animOf(e.id, m.anim)), sp, m.delay, e.added, prevOf(m.id, e.id))))}>
                <span style={Object.assign({display: 'block'}, TP.textCss(TP.fromStyle(memberStyle(ts, m)), k * (pose.scale || 1)))}>
                  {TA.revealText(m.text, frameOf(animOf(m.id, animOf(e.id, m.anim)), sp, m.delay, e.added, prevOf(m.id, e.id)).reveal)}
                </span>
              </span>
            )))}
          </span>;
        }
        // 文字内容也跟着元素走：用户造出来的那些各写各的（`elDocs[id].text`）
        const txt = doc.text || e.label || e.name;
        const f = frameOf(animOf(e.id, doc.anim), sp, 0, e.added, prevOf(e.id));
        if (f.hidden) return null;
        // A per-line background uses inline box-decoration-break. Transforms need a
        // block wrapper; applying motion to that inline span silently drops movement.
        const cs = Object.assign({display: 'block'}, TP.textCss(TP.fromStyle(ts), k * (pose.scale || 1)));
        return <span className="text-motion-surface" style={Object.assign({display: 'block', textAlign: ts.align || 'center'}, TA.css(f))}>
          <span style={cs}>{TA.revealText(txt, f.reveal)}</span>
        </span>;
      }
      if (e.kind === 'sticker') {
        /* 贴纸画的是素材本身（assets/stickers/ 那份贴纸目录）。换色按填充色分组：
           素材里有几个填充色分组就出几张色卡、逐张改（判据在
           [model-svgfill.js](model-svgfill.js)），而不是把它压成一块单色剪影
           （第 39.1 轮那个「着色」是猜的，第 122 轮退场）。 */
        /* 目录里点的是哪一张，画面上就是哪一张（第 60.1 轮）：`asset` 是目录写进
           共用袋的完整路径，`builtin` 是核心那十款矢量贴纸的 id，两者互斥；
           都没有时回落到演示装置自带的那一张。 */
        const SF = window.BC_SVGFILL;
        const fills = (ctx.elDocs[e.id] || {}).fillList || [];
        if (st.builtin) {
          const b = window.BC_SK.BUILTIN.filter((x) => x.id === st.builtin)[0];
          if (b) {
            /* 内置那十款仍按 `layers` 直接画（`preserveAspectRatio` 是属性，改不了
               CSS，显式高度那一档要靠它），色卡按层的原色排第几取第几张。 */
            return (
              <svg viewBox="0 0 1 1" width="100%" height={fillH ? '100%' : null}
                preserveAspectRatio={fillH ? 'none' : null}
                style={{display: 'block'}} aria-hidden="true">
                {b.layers.map((l, i) => (
                  <path key={i} d={l.d} fill={SF.layerFill(b.layers, fills, i)}
                    stroke={l.stroke || 'none'}
                    strokeWidth={l.w || 0} strokeLinecap="round" strokeLinejoin="round" />
                ))}
              </svg>
            );
          }
        }
        const src = st.asset
          || window.BC_SK.DIR + ((D.elements.filter((x) => x.id === e.id)[0] || {}).asset || 'podcast-02.svg');
        /* Lottie（第 238 轮）：五个内置动态分类与品牌库上传的 `.json` 走 lottie-web。
           帧号由**播放头**给（`LottieSticker` 的 `time`），不是它自己跑一只钟——
           拖播放头、暂停、逐帧看到的都是同一帧，与 SMIL 那条路径同口径。换过色
           就把重建出来的 `animationData` 交进去，没改过用 URL 让它吃 HTTP 缓存。 */
        const source = {src: src, kind: st.assetKind || null};
        /* Codex Pet（第 242 轮）：雪碧图按 `BC_PET` 的时长表逐格步进，帧号同样由播放头给；
           盒子（不透明度 / 圆角 / 调整层）在 `PetStage` 里与下面两支同口径。 */
        if (window.BC_STSRC.isPet(source)) {
          const t0 = (ctx.elDocs[e.id] || {}).start ?? e.start ?? 0;
          return <window.PetStage st={st} src={src} k={k} fillH={fillH} time={Math.max(0, ctx.playT - t0)} />;
        }
        if (window.BC_STSRC.isLottie(source)) {
          const doc = window.useJsonSync ? window.useJsonSync(src) : null;
          const data = window.paintLottie ? window.paintLottie(src, doc, fills) : null;
          const t0 = (ctx.elDocs[e.id] || {}).start ?? e.start ?? 0;
          return (
            <span className="fxwrap" style={{display: 'block',
              height: fillH ? '100%' : null,
              borderRadius: window.BC_EL.radiusCss(st, k) || null,
              opacity: (st.opacity == null ? 100 : st.opacity) / 100}}>
              <window.LottieSticker src={src} data={data} time={Math.max(0, ctx.playT - t0)}
                style={{height: fillH ? '100%' : null,
                  filter: window.BC_EL.fxCss(st) || null}} />
              {window.BC_EL.fxLayers(st).map((l) => (
                <i key={l.k} className="fxlayer" style={{opacity: l.opacity,
                  background: l.background, backgroundSize: l.backgroundSize}} />
              ))}
            </span>
          );
        }
        /* 改过色的素材换成 `applyFills` 产出的 data URI，没改过
           就是原 URL——素材文本还没读到时同样是原 URL，画面不会先空一帧。
           `fillH` 这一档还要多一步 `stretch`：外部 SVG 自带的 `preserveAspectRatio`
           盖过 `object-fit: fill`，不改素材根标签就会在拉长的盒子里留黑边。 */
        const raw = window.useSvgSync ? window.useSvgSync(/\.svg(\?|$)/i.test(src) ? src : null) : null;
        const paint = window.stickerPaint ? window.stickerPaint(src, raw, fills, fillH) : src;
        /* 位图 / 动图贴纸（第 84 轮）：不透明度 / 圆角 /
           九项调整都作用在这张图上。矢量换过色的那一支也从这里出画面。 */
        return (
          <span className="fxwrap" style={{display: 'block',
            height: fillH ? '100%' : null,
            borderRadius: window.BC_EL.radiusCss(st, k) || null,
            opacity: (st.opacity == null ? 100 : st.opacity) / 100}}>
            {raw && raw.includes('<animate') ? <window.IntrinsicSticker
              raw={window.BC_SVGFILL.applyFills(raw, fills)} time={Math.max(0,ctx.playT - ((ctx.elDocs[e.id] || {}).start ?? e.start ?? 0))}
              fillH={fillH} filter={window.BC_EL.fxCss(st)} /> : <img src={paint} alt="" draggable="false"
              style={{display: 'block', width: '100%',
                height: fillH ? '100%' : null, objectFit: fillH ? 'fill' : null,
                filter: window.BC_EL.fxCss(st) || null}} />}
            {window.BC_EL.fxLayers(st).map((l) => (
              <i key={l.k} className="fxlayer" style={{opacity: l.opacity,
                background: l.background, backgroundSize: l.backgroundSize}} />
            ))}
          </span>
        );
      }
      if (e.kind === 'progress') {
        return <div style={{width: '100%', height: fillH ? '100%' : Math.max(4, 8 * k),
          borderRadius: 4 * k, background: st.progTrack, overflow: 'hidden'}}>
          <div style={{width: '33%', height: '100%', background: st.progColor}} />
        </div>;
      }
      if (e.kind === 'wave') {
        return (
          <svg width="100%" height={fillH ? '100%' : Math.max(24, 72 * k)}
            viewBox="0 0 240 72" preserveAspectRatio="none">
            {Array.from({length: 40}, (_, i) => {
              const a = Math.abs(Math.sin(i / 3.1) * 0.55 + Math.sin(i / 7.7) * 0.45);
              return <rect key={i} x={i * 6 + 1} y={36 - a * 32} width="3.4" height={Math.max(3, a * 64)}
                rx="1.7" fill={st.waveColor} />;
            })}
          </svg>
        );
      }
      /* 计时（第 88 轮）：画面上写的就是 `counterText` 现算出来的那串字——**读数是播放头
         的纯函数**，这是它唯一需要被看见的性质（设计稿 ADR-CT02）。窗外写一个破折号
         而不是把值夹回窗内：半开区间是契约的一部分（`t = end` 起不再渲染，倒计时因此
         不显示 0），夹一下就把它演成了假的。 */
      if (e.kind === 'counter') {
        const sp = spanOf(e.id, e);
        const txt = window.BC_EL.counterText(st.cntMode, st.cntFmt, playT, sp.start, sp.end);
        /* 字符样式与文字元素同一批控件、同一条折算（`TP.fontStack`）——计时就是一条
           文字元素。等宽数字（`tabular-nums`，在 CSS 里）留着：读数逐秒换字，比例字距
           下 1 与 8 不一样宽，整串会随着数字跳来跳去。

           第 89.1 轮两处：① **读数铺满容器并按 `cntAlign` 对齐**——容器有了宽度柄，
           读数就不再等于盒子，两者之间那段留白归对齐管；② 字号乘 `pose.scale`，与文字
           元素同式（`k * pose.scale`）。此前只乘 `k`，于是拖四角把盒子缩了、读数一动
           不动——`CAPS.counter.scale` 早就是 true，缺的是画面这一半。 */
        return <span className="cntval" style={{color: st.cntColor,
          width: '100%', textAlign: st.cntAlign || 'center',
          fontFamily: TP.fontStack(st.cntFont),
          fontWeight: st.cntBold ? 800 : 400,
          fontStyle: st.cntItalic ? 'italic' : null,
          fontSize: Math.max(12, (st.cntSize == null ? 96 : st.cntSize) * k * (pose.scale || 1))}}>
          {txt == null ? '—' : txt}
        </span>;
      }
      if (e.kind === 'overlay') {
        return <div style={{width: '100%', paddingTop: '56%', borderRadius: 6,
          // 覆盖层用**自己的**不透明度键（第 84 轮）：贴纸与视频也长出了这一项
          opacity: (st.ovlOpacity == null ? 55 : st.ovlOpacity) / 100,
          background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.9), transparent 40%), radial-gradient(circle at 70% 60%, rgba(255,255,255,0.7), transparent 35%)'}} />;
      }
      if (e.kind === 'vframe') {
        return <div style={{width: '100%', paddingTop: '56%', borderRadius: 6,
          boxShadow: `inset 0 0 0 ${Math.max(2, 3 * k)}px ${st.chrome}`}} />;
      }
      if (e.kind === 'shape') {
        // 第 39 轮：画的是 24 格目录里选中的那一格的真路径，不再是一块圆角方块
        const sh = window.BC_EL.shapeAt(st.shapeI == null ? 0 : st.shapeI);
        const bw = st.borderOn === false ? 0 : (st.borderW || 0);
        return (
          <svg viewBox="-4 -4 108 108" width="100%" style={{display: 'block', aspectRatio: '1'}}>
            {sh.k === 'rect'
              ? <rect x="0" y="0" width="100" height="100" rx={sh.r} fill={st.fill}
                  stroke={st.stroke} strokeWidth={bw} />
              : <path d={sh.path} fill={st.fill} stroke={st.stroke} strokeWidth={bw} strokeLinejoin="round" />}
          </svg>
        );
      }
      if (e.kind === 'video') {
        /* B-roll：画面上是一块盖在口播上的画中画，角上标着素材名。
           第 84 轮起画的是**这一条自己的**画面设置：滤镜 / 效果 / 九项调整走同一份
           `BC_EL.fxCss`，四角圆角走 `radiusCss`——与属性页顶上那块预览、图片那一支
           是同一套换算，不各算各的。 */
        const vs = styleOf(e.id);
        const selected = {...e, ...ctx.elDocs[e.id]};
        const asset = selected.asset;
        const src = window.BC_VIDEO_REPLACE.sourceFor(selected, ctx.sources.video)
          || (!selected.srcId && !selected.sourceId && window.videoSourceOf ? window.videoSourceOf(asset) : null);
        return (
          <span className="fxwrap" style={{display: 'block',
            height: fillH ? '100%' : null,
            borderRadius: window.BC_EL.radiusCss(vs, k) || (vs.radius == null ? 12 : vs.radius) * k,
            opacity: (vs.opacity == null ? 100 : vs.opacity) / 100, position: 'relative'}}>
            {src && src.crop ? <span style={{display: 'block', height: fillH ? '100%' : null, aspectRatio: fillH ? null : `${src.naturalW} / ${src.naturalH}`,
                filter: window.BC_EL.fxCss(vs) || null}}><window.CropVideo source={src} el={e} ctx={ctx} fillH /></span>
              : src && src.url ? <window.RemoteVideo source={src} el={e} ctx={ctx} style={vs} fillH={fillH} />
              : <span style={{display: 'block', width: '100%',
              paddingTop: fillH ? 0 : '58%', height: fillH ? '100%' : null,
              filter: window.BC_EL.fxCss(vs) || null,
              background: (src || D.sources.video[1]).grad}} />}
            {window.BC_EL.fxLayers(vs).map((l) => (
              <i key={l.k} className="fxlayer" style={{opacity: l.opacity,
                background: l.background, backgroundSize: l.backgroundSize}} />
            ))}
            {(ctx.elements.find(x => x.id === e.id) || e).broll ?
              <span className="pipmark" style={{fontSize: Math.max(8, 10 * k)}}>B-roll</span> : null}
          </span>
        );
      }
      if (e.kind === 'image') {
        /* 画的是**这一条元素自己的**素材与调整（第 58.2 轮）：换素材、拉亮度、加模糊
           在画面上立刻看得见，属性页顶上那块预览与这里走同一份 `BC_EL.fxCss` /
           `fxLayers`（噪点与暗角 CSS 没有原语，只能盖一层）。 */
        const is = styleOf(e.id);
        const asset = (ctx.elDocs[e.id] || {}).asset || e.asset;
        const src = ctx.sources.image.find(s => s.name === asset) || window.imageSourceOf(asset);
        return (
          <span className="fxwrap" style={{borderRadius: window.BC_EL.radiusCss(is, k),
            opacity: (is.opacity == null ? 100 : is.opacity) / 100}}>
            <span style={{display: 'block', width: '100%', paddingTop: '62%',
              filter: window.BC_EL.fxCss(is) || null,
              /* @ds-allow: 未解码素材的固定内容占位底，不随 UI 主题变化 */
              background: (src || {}).grad || '#20252e'}} />
            {window.BC_EL.fxLayers(is).map((l) => (
              <i key={l.k} className="fxlayer" style={{opacity: l.opacity,
                background: l.background, backgroundSize: l.backgroundSize}} />
            ))}
          </span>
        );
      }
      if (e.kind === 'confetti') {
        /* 彩纸（第 231 轮）：没有素材，整块盒子就是一张 2D canvas，按
           `playT − start` 现算一帧（`BC_CONFETTI.sample`）。时长是时间轴那条的
           起止差——`settle` 与「片尾」都按它算，所以拖长条子画面跟着变，不是拉伸。 */
        const sp = spanOf(e.id, e);
        return <window.ConfettiCanvas props={styleOf(e.id).confetti}
          t={playT - sp.start} dur={sp.end - sp.start} />;
      }
      if (e.kind === 'whiteboard') {
        /* 白板手绘：同彩纸——整块盒子是一张 2D canvas，按 `playT − start` 现算一帧
           （`BC_WHITEBOARD.sample`）；暂停看到的就是导出那一帧，画时按条子时长夹取。 */
        const sp = spanOf(e.id, e);
        return <window.WhiteboardCanvas props={styleOf(e.id).whiteboard}
          t={playT - sp.start} dur={sp.end - sp.start} />;
      }
      return null;
    };

    return (
      <React.Fragment>
          {byStack(CANVAS_ELEMENTS
            .filter((e) => live(e.id))
            .concat(ON_DEMAND.filter((o) => live(o.id) && (shown.indexOf(o.id) >= 0 || ctx.isSel('element', o.id))))
            /* 用户造出来的元素（第 58 轮）。上面两张表是**每类一条**的演示装置，认的是
               kind；这些认 id——同一类可以有很多条。 */
            .concat(userEls.map((u) => Object.assign({}, u, {added: true})))).map((e) => {
            /* 命中一律按 id（第 115 轮）：此前演示元素按 kind 认，同类两件必然同时亮，
               而多选也无从表达。`alt` 只影响「按哪一族画工具条」，不再参与命中。 */
            /* 多选时**不各自出手柄**（§6）：统一框只画一个，成员各留一条细描边。 */
            const mine = ctx.isSel('element', e.id);
            const on = !multi && (mine || (memberSel && selId === e.id));
            const asAlt = !!(e.alt && sel && sel.kind === 'element' && sel.id === e.id && sel.elKind === e.alt);
            /* 关键帧（G11a，示意）：**没选中**时按 `playT` 取样，位置 / 缩放 / 旋转取代静态值，不透明度
               在最外层再乘一层；选中时回到静态姿态——手柄改的是静态值，跟着运动跑的手柄没法拖。
               规范的取样在内核（动画下沉），这里只让人在画布上看见「它在动」。 */
            const kfDoc = (ctx.elDocs[e.id] || {}).keyframes;
            const kfOn = !on && !(multi && mine) && window.BC_KF.any(kfDoc);
            const kfSpan = kfOn ? spanOf(e.id, e) : null;
            const pose = kfOn
              ? window.BC_KF.poseAt(poseOf(e.id), kfDoc, playT - kfSpan.start, kfSpan.end - kfSpan.start)
              : poseOf(e.id);
            /* 盒宽 = `w% × scale`（与 App v2 `static_box` 同式）；`data-el` 是吸附时
               收集邻居盒用的钩子。
               **盒高**（第 122 轮）：`pose.h` 没写过就仍由内容的宽高比撑（`undefined`），
               写过就是 `h% × scale`——四边缩放会把两条边都写成显式值，此后这一件的
               高度归用户管，不再跟着素材比走。 */
            const hasH = pose.h != null;
            const box2 = {position: 'absolute', left: pose.x + '%', top: pose.y + '%',
                          width: (pose.w * (pose.scale || 1)) + '%',
                          height: hasH ? (pose.h * (pose.scale || 1)) + '%' : null,
                          transform: 'translate(-50%, -50%)', zIndex: zOf(e.id)};
            /* 镜像归几何（核心 ADR-E01 的 `place.flipX/flipY`），但只翻**内容**：
               翻在盒子上会把选中框、手柄与浮动条一起镜像，条子上的字都要倒过来。 */
            const mir = (pose.flipX ? ' scaleX(-1)' : '') + (pose.flipY ? ' scaleY(-1)' : '');
            /* 动画（第 122 轮）：文字与文本组在 `paint` 里逐成员求值（各带各的延迟），
               **其余那几族的动效套在这一层**——它们的画面是一段 SVG 或一个盒子，
               `paint` 里从来没有逐帧求值，所以此前贴纸 / 形状 / 声波 / 进度 / 计时
               无论设了什么动画，画布上都一动不动（悬停时看到的那一下是格子自己在演
               一段 CSS keyframes，与元素真正会怎么走无关）。 */
            const efr = TEXTY(e.kind) ? null
              : frameOf(animOf(e.id, (ctx.elDocs[e.id] || {}).anim || e.anim),
                        spanOf(e.id, e), 0, e.added, prevOf(e.id));
            const ecss = efr && !efr.hidden ? TA.css(efr) : null;
            let body = paint(e, pose);
            if (hasH) body = <span className="elh">{body}</span>;
            if (e.kind === 'video' && ctx.playing) {
              const sp = spanOf(e.id, e);
              body = <span className="anfr" style={window.BC_VIDEO_TRANSITION.at(
                (ctx.elDocs[e.id] || {}).transitions, playT - sp.start, sp.end - sp.start)}>{body}</span>;
            }
            if (ecss && (ecss.transform || ecss.opacity != null || ecss.filter || ecss.clipPath)) {
              body = <span className="anfr" style={ecss}>{body}</span>;
            }
            if (mir) body = <span style={{display: 'block', transform: mir.trim()}}>{body}</span>;
            if (kfOn && pose.opacity != null) body = <span className="anfr" style={{opacity: Math.max(0, Math.min(1, pose.opacity))}}>{body}</span>;
            if (ctx.editing && ctx.editing.id === e.id) body = editBody(e, pose);
            if (efr && efr.hidden) return null;
            if (!on) {
              return (
                <div key={e.id} data-el={e.id} className={cx(multi && mine && 'selthin')}
                  style={{...box2, cursor: 'pointer',
                    transform: `translate(-50%, -50%) rotate(${pose.rot || 0}deg)`}}
                  onDoubleClick={(ev) => { ev.stopPropagation(); beginEdit(e); }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    if (swallow && swallow()) return;
                    /* 播放中点一件 = 暂停 ＋ 选中（§2）：不暂停的话手柄下一帧就被
                       起播那条规则收走，点了等于没点。 */
                    if (ctx.playing) ctx.setPlaying(false);
                    pickStageEl(ctx, e.id,
                      {toggle: ev.shiftKey || ev.metaKey || ev.ctrlKey});
                  }}>
                  {body}
                </div>
              );
            }
            return (
              <window.SelectionBox key={e.id} id={e.id}
                kind={memberSel ? selKind : asAlt ? e.alt : e.kind}
                el={e.added ? e : elDoc(asAlt ? e.alt : e.kind)} ctx={ctx}
                st={styleOf(e.id)} set={setOf(e)} style={box2}
                inner={hasH ? {height: '100%'} : null}
                pose={pose} setPose={(patch) => ctx.setElPose(e.id, patch)}
                frameRef={frameRef} onGuides={onGuides}
                onDoubleClick={(ev) => { ev.stopPropagation(); beginEdit(e); }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  /* 把手上拖完的那一下 `click` 由浏览器补派到公共祖先（也就是这只
                     `.selbox`），不是用户点的（第 122 轮验收补）：不吞，⇧ 拖一次把手
                     就等于在这件上 ⇧ 点了一下，它当场被移出选中集、框子跟着消失——
                     「⇧ 解锁比例」那条手势因此每次都以取消选中收尾。这里也顺手把旗
                     清掉：本分支 `stopPropagation`，`.stage` 的 `onClick` 读不到它。 */
                  if (window.swallowDrag && window.swallowDrag()) return;
                  /* 已选中的那件上 shift/⌘ 点一下 = 从选中集里移出去。 */
                  if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
                    ctx.pick({kind: 'element', id: e.id, elKind: e.kind}, {toggle: true});
                  }
                }}>
                {body}
              </window.SelectionBox>
            );
          })}
      </React.Fragment>
    );
  }

  Object.assign(window, {StageElements, pickStageEl});
})();
