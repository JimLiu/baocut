/* 舞台与舞台工具条 —— product-design §5.3。
   舞台工具条：画幅 · 倍速 · spacer · 字幕 · 音量 · 全屏。左边两件是图标加当前值，右边三件只有图标。
   所有弹层一律向上翻（工具条贴着时间轴）。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const L = window.BC_LAYOUT;
  const T = window.BC_TIME;
  const P = window.BC_POSE;

  /** 演示画面：确定性的渐变底 + 网格，不假装是真帧。
   *  `player`（第 222 轮）：全屏播放器复用同一份画面——元素、模板、字幕、逐词动效、
   *  播放头都是同一条渲染路，观看面不该有第二个实现，不然两处会慢慢长歪。
   *  差别只有三件：不留内边距、不接编辑手势（选中框 / 框选 / 预览贴片一律不画，
   *  见 `.stage--player` 的 pointer-events）、字幕按播放器的档位过滤而不是 `subsOn`。 */
  function StageView({ctx: ctx0, player}) {
    /* 观看时把「编辑态」蒙掉：选中、多选、悬停预览在这里没有对应的操作对象，
       留着只会在画面上多出一圈把手。蒙的是**副本**，编辑器那边的选中原样保留——
       退出全屏回到原来选中的东西上，是用户预期的。 */
    const ctx = player ? Object.assign({}, ctx0, {sel: null, multi: [], peek: null}) : ctx0;
    const {ratio, sel, pick, subsOn, playT} = ctx;
    const [box, setBox] = React.useState({w: 800, h: 450});
    /* 元素样式也过一遍悬停预览（§13.2）：Elements 目录里停在一格上，画面立刻是那个
       样子。与字幕走同一格状态，只是 kind 不同。 */
    const {setElStyle: set} = ctx;
    const st = ctx.peekOf('el', ctx.elStyle);
    /* 文字的字符样式跟着元素走（第 58 轮）——画面上可以有很多块文字，共用一份袋子
       的话，新加一块黄色强调会把刚写好的白色标题一起染黄。其余类型仍读共用袋。 */
    /* 字幕的浮动条读写的是**这一条轨（或这一条 cue）自己的样式**，不是元素样式袋。
       §16.1 早写着「画布字幕、浮动工具条、属性页共用同一份文档，任意改动即时同步」
       ——第 102 轮之前这句话在工具条上是假的：那条子拿到的 `st` / `set` 是 `elStyle` /
       `setElStyle`，于是在条子上给字幕换个颜色，画面上的字幕纹丝不动，倒是把画面里
       还没设过色的元素一起染了。属性页一直是对的，两个入口因此各说各的。
       `subScope === 'cue'` 时落到覆盖表上，与属性页同一条分流（§16.3）。 */
    const subCueId = ctx.subScope === 'cue' && ctx.curCue ? ctx.curCue.id : null;
    const subSt = (id) => window.BC_SUB.line(ctx.subStyle, id, subCueId) || {};
    const subSet = (id) => (patch) => (subCueId
      ? ctx.setSubCue(subCueId, id, patch) : ctx.setSubTrack(id, patch));
    const ref = React.useRef(null);
    /* 手势要量的是**画面框**（`.frame`），不是舞台留白；吸附导引线也画在它里面。
       线是手势中**现算**的（§5：语义是「此刻确实对齐了」而非「刚刚被吸住了」），
       松手清空。 */
    const frameRef = React.useRef(null);
    const [guides, setGuides] = React.useState([]);
    /* 框选（第 115 轮）：起手挂在 `.frame` 上，因为主视频铺满整幅画面——「舞台空白」
       在视觉上就是画面本身。真的拖过阈值时 `swallow()` 会吞掉尾随的那次 click，
       否则刚框中的东西会被下面那条「点空白清选」立刻清掉。 */
    const mq = window.useMarquee(ctx, frameRef);
    React.useLayoutEffect(() => {
      const el = ref.current; if (!el) return;
      const ro = new ResizeObserver(([e]) => setBox({w: e.contentRect.width, h: e.contentRect.height}));
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    const fit = L.fitStage(box.w, box.h, L.ratioValue(ratio), player ? 0 : undefined);
    /* 第 220 轮：转录中画面上的字幕跟着转录位置走——没转录到的那段没有字幕可放，
       整句识别到了才放（`BC_TX.cueRecognized`，与时间轴字幕轨同一把尺），没有写到一半的句子（第 243 轮）。
       视频本身照常放：门控的是字幕这一层，不是画面。 */
    const cueHit = window.BC_SUB_PREFS.cueAt(ctx.cues, playT, ctx.subStyle.displayTiming);
    const cue = cueHit && window.BC_TX.cueRecognized(cueHit, ctx.liveAt) ? cueHit : null;
    /* 悬停预览时，画面要**把这一句放出来**，不能只摆一个静帧（第 53 轮）。
       停着的播放头给不出「当前词」的推进，而逐词动画的全部内容就在那一个词上——
       静帧看不出卡拉OK 与颜色高亮的差别，那样的预览等于没预览。

       所以预览期间当前词改跟**画廊那只节拍器**（与缩略图同相位）；一旦真的在播放，
       播放头本来就在推进，仍然跟播放头——那才是画面的真实时间。 */
    const previewing = !!ctx.peek;
    const cueWords = cue ? window.BC_WA.split(cue.text).length : 0;
    const subPreviewing = !!(ctx.peek && ctx.peek.kind === 'sub' && !ctx.peek.win);
    const beatCur = window.useSubBeat(cueWords, subPreviewing);
    const k = fit.w / 880;                       // 画面缩放系数，元素尺寸跟着走
    /* 叠放次序（product-design §5.1）：画面元素与字幕是同一叠，名次读时间线行（`BC_TL.stackRank`），
       拖行头、画布「层级」换过的次序在这里落到画面上。名次只在 `.stagestack` 里比，不出这一层。 */
    const rank = window.BC_TL.stackRank(window.BC_TL.rows(ctx.elements || [],
      {subTracks: ctx.subStyle.tracks, audio: false, music: false, trackOrder: ctx.trackOrder}).rows);
    const subZ = (id) => rank['subs:' + id] ?? 0;
    /* 元素的选中判定与画法整体搬去 [stage-elements.jsx](stage-elements.jsx)（第 115 轮
       拆分：本文件此前 770 行）。这里只留舞台自己的事：画幅、字幕与工具条。 */
    const mode = (ctx.ent && ctx.ent.canvas) || 'mono';   // §9 六入口：画布也跟着改

    return (
      <div className={cx('stage', player && 'stage--player')} ref={ref}
        onMouseDownCapture={player ? undefined : (ev => {
          // 载入/卡住遮罩（stage-load.jsx）接住的按下不算点画面：不暂停。
          if (!ctx.playing || ev.button !== 0 || ev.target.closest('.mtb, .stageload')) return;
          ev.preventDefault(); ev.stopPropagation(); ctx.setPlaying(false);
          // Consume the click belonging to this press, even after React has paused.
          const consume = click => { click.preventDefault(); click.stopPropagation(); };
          window.addEventListener('click', consume, {capture: true, once: true});
          window.addEventListener('mouseup', () => window.setTimeout(() => window.removeEventListener('click', consume, true), 0), {once: true});
        })}
        onClick={player ? undefined : (() => {
          /* 框选与元素手势各立一面旗，两面都要读一次再判——只读到第一面为真就 return
             会把另一面留成脏的，下一次真点空白时反而清不掉选中。 */
          const mqSw = mq.swallow();
          const dragSw = window.swallowDrag ? window.swallowDrag() : false;
          if (mqSw || dragSw) return;
          ctx.stopEdit(); pick(null);
        })}>
        {/* 锐化的四档滤镜（`BC_EL.sharpStep` 量化到 1..4）。CSS 没有锐化原语，只能走
            SVG 的 feConvolveMatrix；量化成四份预声明的定义，省得每改一格生成一份新的。
            挂在舞台上一次，全页按 id 引用。 */}
        <svg width="0" height="0" aria-hidden="true" style={{position: 'absolute'}}>
          <defs>
            {[1, 2, 3, 4].map((n) => {
              const a = 0.35 * n;                       // 中心增益随档位线性抬
              return (
                <filter key={n} id={'bcfx-sharp' + n}>
                  <feConvolveMatrix order="3" preserveAlpha="true"
                    kernelMatrix={`0 ${-a} 0  ${-a} ${1 + 4 * a} ${-a}  0 ${-a} 0`} />
                </filter>
              );
            })}
          </defs>
        </svg>
        <div className="frame" ref={frameRef} style={{width: fit.w, height: fit.h}}
          onMouseDown={player ? undefined : mq.onMouseDown}>
          {/* 悬停预览的回执（第 102.1 轮）。此前的立论是「鼠标一扫过画面就变了，不用
              写出来」——那句话只在**看得见变化**时成立：逐词动效的差别常常只落在某一个
              词上，画面一小、句子一长，人会以为自己什么都没触发。所以补一枚贴片，说清
              画面此刻演的是「停在哪一格上的那个样子」、移开就回去。
              它跟着 `peek` 走，所以样式画廊、动画页与条子上那张下拉三处共用一份。
              **必须是 `.frame` 的直接子节点**：画面里那些选中框各自是定位上下文，挂在
              它们中间会被就近的那个当成参照，贴到画面中央去。 */}
          {previewing && !player ? (
            <div className="peekflag"><Ic n="info" className="ic--14" />
              {ctx.peek.localWin ? '局部预览' : '预览中'}{ctx.peek.label ? ' · ' + ctx.peek.label : ''} · {ctx.peek.manual ? 'Esc 退出' : '移开鼠标恢复'}</div>
          ) : null}
          {/* 纯音频项目的纯色底（第 225 轮）：向导 6 色板选的那一档，铺在网格与元素之下。
              画布背景选「黑」或「颜色」（G11a，`main.background`）时这一层铺那一色；「模糊」不铺，
              原型不画模糊放大的主画面（示意），纯音频项目仍回落到向导选的底色 */}
          {ctx.canvasBg ? <div className="frame__bg" style={{background: ctx.canvasBg}} /> : null}
          <div className="frame__grid" />

          {/* blank 入口：画布即引导，不再多给一句 toast（§9） */}
          {mode === 'empty' && !ctx.elements.length && !player ? (
            <div className="framedrop">
              <Ic n="upload" className="ic--26" />
              <div className="drop__t">把素材拖进来</div>
              <div className="t-detail-xs">或从右侧面板添加</div>
            </div>
          ) : null}

          {/* a2v 入口的声波不再是画在这里的示意图（第 225 轮）：它是元素表里一条真的 wave
              元素，与别的元素一样经 StageElements 画、可选可拖可换样式 */}

          {/* 模板 chrome（§14.5，第 112 轮）：项目里套着的那份 BC_TPL 文档按层画在画面上，
              位置按画面框百分比落位；有没有模板看 tplDoc，不再看入口 */}
          {ctx.tplDoc ? <window.TemplateChrome ctx={ctx} fw={fit.w} fh={fit.h} /> : null}

          {/* 画面元素与字幕同在一叠（`.stagestack`）：各带 `zIndex` = 名次，谁盖谁跟着轨道次序走 */}
          <div className="stagestack">
          <window.StageElements ctx={ctx} st={st} k={k} frameRef={frameRef}
            onGuides={setGuides} mode={mode} swallow={mq.swallow} rank={rank} />

          {/* 播放器里字幕开关是那四档（关闭 / 原文 / 译文 / 双语），不是编辑器的
              `subsOn`——观看时选「只看译文」不该写回文档，见 model-player.js。 */}
          {/* 倒鸭子（2026-09-17）：源语言轨带 `kinetic` 时，它那一行不在下面「按当前 cue 逐轨
              画一行」的循环里——那是**跨句**的一张 canvas（历史块与镜头在两条 cue 之间的空档
              里也得在），在循环外挂一次。译文轨照旧逐 cue 画在下沿（设计稿 §3.6「原文动态、
              译文固定」）。悬停试穿时没有播放头可读，那一格从播放头所在段起循环放（`loop`）。 */}
          {(player ? player.capMode !== 'off' : subsOn) ? (() => {
            const doc = ctx.peekOf('sub', ctx.subStyle);
            const src = window.BC_SUB.source(doc);
            const kin = src && !src.hidden && src.kinetic
              && (!player || window.BC_PLAYER.captionVisible(player.capMode, 'source')) ? src.kinetic : null;
            if (!kin) return null;
            return (
              <div key="dz" className="stagestack__dz" style={{zIndex: subZ(src.id)}}>
                <window.DaoyaziStage ctx={ctx} track={src} kin={kin} cues={ctx.cues}
                  playT={playT} loop={subPreviewing} fit={fit} duration={ctx.duration}
                  bilingual={!!window.BC_SUB.stackOrder(doc)} editable={!player} />
              </div>
            );
          })() : null}
          {(player ? player.capMode !== 'off' : subsOn) && cue ? (() => {
            // 字号跟着画面宽走（20px @ 880 基准宽，§11），不是 transform——
            // 缩放整条会让它在小窗口里溢出画面下沿。
            const fz = Math.max(9, +(fit.w * (20 / 880)).toFixed(1));
            /* 悬停预览：鼠标停在一张样式卡 / 一格动画上时，画面立刻是那个样子（§13.2）。
               它是一份临时覆盖，不进文档也不进历史——`peekOf` 拿不到预览就原样返回。 */
            const doc = ctx.peekOf('sub', ctx.subStyle);
            const src = window.BC_SUB.source(doc) || {};

            /* 画面上的字幕 = timeline 上那几条字幕轨，**各自摆各自的**（第 47 轮去掉了
               「组」）。每条轨自带锚点 ＋ 偏移，所以拖一条只动那一条；此前整栈共用一对
               锚点/偏移，拖动是把两行一起挪，属性页也得为此单开一档「整组」。
               要两行一起挪：⇧ / ⌘ 点选或框选把几条轨都选上，拖统一框（stage-marquee.jsx 的
               `SubsMultiBox`，2026-10-09）。

               点一条 = 选中那条轨 → 属性页直接落到它自己的属性上。这与「点画布元素 →
               属性页」是同一条规矩，只是字幕轨是派生出来的，文本与时间不可在这里改。 */
            const goProps = (trackId) => (e) => {
              e.stopPropagation();
              /* 在字幕上起手、拖过阈值的框选，松手补发的 click 落在这一行上：吞掉，不然框中的又被收成这一条。 */
              if (mq.swallow()) return;
              if (e.shiftKey || e.metaKey || e.ctrlKey) { ctx.pick({kind: 'subs', trackId}, {toggle: true}); return; }
              ctx.pick({kind: 'subs', trackId});
              ctx.setTab('subtitle');   // 第 152 轮起原文 / 译文都在同一个 Tab，选中决定编辑对象
              ctx.setPaneHidden(false);
              ctx.setPaneView('subprops');
            };

            /* 画面上的字幕与画廊缩略图、属性页预览条走**同一个** paintCss，
               逐词动画走**同一张取帧表**（`BC_WA.frame`）——「点下去画面就是缩略图
               的样子」只能这么兑现：涂装一份、取帧一份，两处都不许有第二个实现。

               差别只在谁在驱动「当前词」：画廊跟节拍器循环，画面跟**播放头**。
               演示口径下词位是把 cue 的时长均分出来的（`BC_WA.at`），真实实现读
               transcript `words[]` 的起止——登记在 README 分歧台账。 */
            /* 选中了两条及以上的字幕轨：逐条的选中框收起，只留细描边，统一框接管拖动（同元素的多选，§6）。 */
            const subSel = window.BC_SELECT.subMembers(ctx.sels);
            const subMulti = subSel.length >= 2;
            /* 停用的轨（第 120 轮）：行留在时间轴上，画面与导出都跳过它 */
            return window.BC_SUB.tracks(doc)
              .filter((t) => !t.hidden)
              .filter((t) => !player || window.BC_PLAYER.captionVisible(player.capMode, t.role))
              .map((t) => {
              /* **画面恒读这一条 cue 的有效样式**（第 102 轮）：`cue.id` 无条件传进去，
                 与属性页此刻在哪个作用域无关。覆盖表是文档的一部分，不是编辑态——
                 只在「仅这一条」那一档才把它画出来的话，切回「全部字幕」画面就会
                 变回去，用户会以为自己那一笔被撤销了。 */
              const ln = window.BC_SUB.line(doc, t.id, cue.id);
              const isSrc = t.role === 'source';
              // 倒鸭子接管的源语言轨在上面循环外那张 canvas 上，这里不再画一行
              if (isSrc && ln.kinetic) return null;
              /* 读的是 `ln`（这一条 cue 的**有效**样式），不是 `src`（轨上那份）。
                 第 102.1 轮把词级那几件也收进逐条覆盖之后，照 `src` 读会让「仅这一条」
                 里选的动效在画面上不生效——连带悬停预览也演不出来（预览走的是同一条读路）。 */
              const anim = isSrc ? ln.wordAnim || 'none' : 'none';
              const sourceText = window.BC_SUB_PREFS.displayText(cue.text, doc.punct !== false);
              const displayText = isSrc ? sourceText : window.BC_SUB_PREFS.displayText(cue.trans, doc.punct !== false);
              const n = window.BC_WA.split(sourceText).length;
              /* 锚线 `y` ＋ 「哪条边钉在锚线上」——与核心 `stack_layout` 的
                 `y` / `verticalAlign` 同一套（第 49 轮）。底边钉住时块往上长，
                 这正是字幕的常态，也是 CSS 里一句 translateY(-100%) 的事。 */
              /* 模板避让（第 112 轮）：底部有整宽的模板带时，字幕底边最多抬到带的上沿 */
              const lift = ctx.tplDoc && ctx.tplDoc.subsAvoid !== false ? window.BC_TPL.subsBottom(ctx.tplDoc, 0) : 0;
              const y = lift ? Math.min(ln.y, 100 - lift) : ln.y;
              /* `x` 是字幕框的水平中心，`width` 是画宽百分比；Shorts 预设落 64。 */
              const width = ln.width == null ? 80 : ln.width;
              const x = ln.x == null ? 50 : ln.x;
              const pos = {position: 'absolute', left: (x - width / 2) + '%', width: width + '%',
                top: y + '%', bottom: 'auto',
                transform: 'translateY(' + P.subShift(ln.valign) + '%)', zIndex: subZ(t.id)};
              const picked = !!sel && sel.kind === 'subs' && sel.trackId === t.id;
              /* 字号换算（第 74.1 轮改口径）：名义字号 32 ↔ 画面基准 fz（20px@880），
                 每条轨各自按自己的字号折算。此前按 `src.size` 归一——源语言轨恒画成
                 fz，它自己的字号滑杆在画面上是空操作，倒转叠法（主行字号换人）后
                 整块还会跟着缩小。默认轨集（源 32）下两种算法逐像素相同。 */
              /* 可读下限只托底、不放大（2026-09-27 Shorts）：字号大于缺省的轨按真比例折算，
                 否则小窗口里 99 号的 Shorts 预设会被下限 × 3 撑出画面。缺省及更小的字号与此前逐像素相同。 */
              const fzBase = D.subtitle.trackDefaults.size || 32;
              const fzl = +(ln.size > fzBase ? Math.max(fz, fit.w * (20 / 880) * ln.size / fzBase) : fz * ln.size / fzBase).toFixed(1);
              /* 动效字幕（`ln.caption`）走**第二条渲染路径**：一份 emphasis 配方自带
                 涂装、排版与四档时间通道（词 / 字形簇 / 行 / 整条），画在 canvas 上，所以
                 这一条既不读轨上的涂装也不读 `wordAnim`——整条交给 `CaptionCanvas`
                 （app/subcaption.jsx）。字号仍按画面宽给基准，配方内部再按 `layout.size` 折算。

                 时钟是**播放头的真秒**（`playT − cue.start`），不是当前词下标：配方的时间
                 通道要连续秒才解得开（词前 640ms 起跳、`progress: 2` 的尾巴都在词窗之外）。
                 词位仍是把 cue 时长均分出来的演示口径（同 `BC_WA.at`），真实实现读 transcript
                 `words[]` 的起止——登记在 README 分歧台账。悬停预览时没有播放头可读，
                 那一格退回节拍器的循环时间线（与画廊同相位）。 */
              const cap = isSrc ? ln.caption : null;
              const wcur = subPreviewing ? beatCur : window.BC_WA.at(playT, cue.start, cue.end, n);
              const line = ln.textMotion || ln.wordBackground ? (
                <div className="subline subline--cap"><window.SubTextMotion paint={ln} text={displayText}
                  fz={fzl} t={playT - cue.start} dur={cue.end - cue.start} loop={subPreviewing} timed={isSrc} /></div>
              ) : cap ? (
                <div className="subline subline--cap">
                  <window.CaptionCanvas presetK={cap} text={sourceText} fz={fz}
                    loop={subPreviewing} t={playT - cue.start} dur={cue.end - cue.start}
                    still={window.subReduced} />
                </div>
              ) : (
                <div className={cx('subline', ln.mono && 't-mono')} style={window.paintCss(ln, fzl)}>
                  <window.WordLine text={displayText} anim={anim}
                    active={ln.activeColor} cur={wcur}
                    highlight={isSrc ? ln.highlight : null} cueId={cue.id}
                    plate={window.plateCss(ln, fzl)} />
                </div>
              );
              /* `data-subs` 给框选与统一框量行框用；不挂 `data-el`，免得没选中的字幕变成元素拖动时的吸附对象。 */
              if (subMulti || !picked) {
                const mine = subMulti && subSel.some((s) => s.trackId === t.id);
                return (
                  <div key={t.id} className={cx('subs', mine && 'selthin')} data-subs={t.id} style={pos}
                    onClick={goProps(t.id)}>{line}</div>
                );
              }
              /* 字幕多半贴底：所有弹层一律向上开，工具条抬高跨过（它没有旋转把手，
                 但下方没有位置）——§16.3。拖动写回**这一条轨**的锚线 `y` 与水平中心 `x`，
                 与属性页「位置」里的距顶、水平位置是同一对值；吸附与参考线同元素的移动。 */
              return (
                <window.SelectionBox key={t.id} kind="subtitle" id={'subs:' + t.id}
                  el={D.elements[0]} ctx={ctx} st={subSt(t.id)} set={subSet(t.id)}
                  bottomAnchored style={pos}
                  inner={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}
                  pose={{x, y, w: ln.width || 84, scale: 1, rot: 0}}
                  setPose={(patch) => {
                    // 拖动直接写锚线 y 与水平中心 x——都是绝对的帧百分比，不需要「换锚点再折算」那一套。
                    // 宽度柄的补丁（带 w）不改宽也不挪 x：只认移动。
                    const next = {};
                    if (patch.y != null) next.y = P.subClampY(patch.y);
                    if (patch.x != null && patch.w == null) next.x = P.subClampY(patch.x);
                    if (next.y != null || next.x != null) ctx.setSubTrack(t.id, next);
                  }}
                  frameRef={frameRef} onGuides={setGuides}
                  onClick={(e) => {
                    e.stopPropagation();
                    /* 拖完补派的 click 不是点选（同元素，stage-elements.jsx）：⇧ 拖一次不该把它移出选中。 */
                    if (window.swallowDrag && window.swallowDrag()) return;
                    ctx.pick({kind: 'subs', trackId: t.id}, {toggle: e.shiftKey || e.metaKey || e.ctrlKey});
                  }}>
                  {line}
                </window.SelectionBox>
              );
            });
          })() : null}
          </div>

          {/* 多选统一框（第 115 轮）：≥2 件时逐件手柄收起，改画一个可整体拖动与
              等比缩放的外包框。 */}
          {player ? null : <window.MultiBox ctx={ctx} frameRef={frameRef} />}
          {player ? null : <window.SubsMultiBox ctx={ctx} frameRef={frameRef} />}
          {player ? null : <window.Marquee box={mq.box} />}

          {/* §5 的对齐参考线：1px accent，松手消失 */}
          {guides.map((g, i) => (
            <i key={i} className={cx('gline', g.v ? 'gline--v' : 'gline--h')}
              style={g.v ? {left: g.p} : {top: g.p}} />
          ))}


          {/* 平台安全区（2026-09-27，Shorts 设计稿 §5.1）：竖幅时画出平台 UI 盖住的三块，
              只是参考线——不接鼠标、不进导出、全屏播放器里不画。数字只在 BC_SHORTS.SAFE。 */}
          {!player && ctx.safeArea && window.BC_SHORTS.isPortrait(ratio) ? <SafeAreaOverlay /> : null}

          {/* 舞台状态胶囊（§11.2）：BCF 预览代理在烧 MP4 时的「正在优化播放 · N%」，
              与「上一版画面」提示同一列。挂在 `.frame` 最后、直接子节点——理由同上面的
              预览贴片。全屏播放器不画：观看面只留播放 chrome，左下角也被控制条压着（§11.1）。 */}
          {player ? null : <StageChips />}
          <StageMediaNotice proj={ctx.proj} />
          <window.StageLoadNotice proj={ctx.proj} />
        </div>
      </div>
    );
  }

  /** 舞台左下角的一列只读胶囊（§11.2），自上而下：「正在优化播放 · N%」、「上一版画面」。
   *  判据全在 `BC_PROXY`（model-proxy.js）；这里只排一次「满 1 秒」的计时器、把结论画出来。
   *  原型的状态来自「原型开关」（store `proxyDemo`）；产品里 App 进程内查代理状态、
   *  Web 轮询 serve 的状态端点，都是 1 秒刷新一次。
   *  不收指针、不抢焦点、不逐秒播报——它只是告诉人「卡是暂时的」，不是一个可操作的东西。 */
  function StageChips() {
    const app = useApp();
    const X = window.BC_PROXY;
    const px = app.proxyDemo;
    const [, wake] = useState(0);
    React.useEffect(() => {
      const w = X.waitMs(px, Date.now());
      if (w == null) return undefined;
      const id = setTimeout(() => wake((n) => n + 1), w);
      return () => clearTimeout(id);
    }, [px.status, px.since]);
    const col = X.column(px, px.stale, Date.now(), 'zh');
    if (!col.length) return null;
    return (
      <div className="stagechips">
        {col.map((c) => <div key={c.key} className={cx('stagechip', 'stagechip--' + c.key)}>{c.text}</div>)}
      </div>
    );
  }

  /** 主媒体放不出来（§11.3）：画面正中一张常驻卡，播放中也不收——字幕、元素照常画在
   *  它周围往下走。挂在 `.frame` 上，全屏播放器里同样要看见：那边更需要知道为什么是黑的。
   *  不收指针：点画面照旧是选中 / 清选。判据与文案全在 `BC_STAGE_MEDIA`。 */
  function StageMediaNotice({proj}) {
    const app = useApp();
    const n = window.BC_STAGE_MEDIA.notice(proj, app.stageMediaDemo, window.BC_SURFACE);
    if (!n) return null;
    return (
      <div className="stagemedia" role="alert">
        <div className="stagemedia__card">
          <div className="stagemedia__t"><Ic n="alert" className="ic--16" />{n.title}</div>
          <div className="stagemedia__name">{n.name}</div>
          <div>{n.body}</div>
          {n.hint ? <div className="stagemedia__hint">{n.hint}</div> : null}
        </div>
      </div>
    );
  }

  const volIcon = (v, muted) => (muted || v === 0 ? 'vol0' : v <= 33 ? 'vol1' : v <= 66 ? 'vol2' : 'vol3');

  function SafeAreaOverlay() {
    const S = window.BC_SHORTS;
    const b = S.safeBox();
    const pct = (r) => ({left: r.x + '%', top: r.y + '%', width: r.w + '%', height: r.h + '%'});
    return (
      <div className="safearea" aria-hidden="true">
        {S.zones().map((z) => (
          <div key={z.k} className={cx('safearea__z', 'safearea__z--' + z.k)} style={pct(z)}>
            <span className="safearea__tag">{z.label}</span>
          </div>
        ))}
        <div className="safearea__box" style={pct(b)} />
      </div>
    );
  }

  /* 舞台下沿的工具条（product-design §5.3）：左边画幅、倍速，图标加当前值；右边字幕显隐、音量、全屏，只有图标。
     音量钮只管监听音量：切听配音还是原声在配音轨行头的菜单里（timeline-dub.jsx）。 */
  function StageBar({ctx}) {
    const app = useApp();
    const R = window.RSP;
    const {ratio, setRatio, ratioLock, vol, setVol, muted, setMuted, speed, setSpeed,
           subsOn, setSubsOn, fs, setFs, pop, setPop} = ctx;
    const [custom, setCustom] = useState(false);
    const toggle = (k) => setPop(pop === k ? null : k);
    const close = () => setPop(null);
    /* 画幅锁（第 218 轮）：模板锁着画幅时，钮上的画幅图标换成一枚锁，弹层顶上先说是谁锁的、去哪解；
       九档只剩锁定那一档能点（点了也只是关弹层），其余全灰——不是藏起来：
       用户得看见「本来有这些档，是模板不让改」。解锁不放这里：它是模板的设置。 */
    const lock = ratioLock || null;
    const portrait = window.BC_SHORTS.isPortrait(ratio);

    return (
      <div className="stagebar">
        <div style={{position: 'relative'}}>
          <Tip label={lock ? lock.note : '画幅'}>
            <R.ActionButton size="S" isQuiet aria-label={'画幅 ' + ratio} onPress={() => toggle('ratio')}
              UNSAFE_className={cx('stagebar__chip', lock && 'is-locked')}>
              {lock ? <Ic n="lock" /> : <R.Icons.AspectRatio />}
              <R.Text>{ratio}</R.Text>
            </R.ActionButton>
          </Tip>
          <Popover open={pop === 'ratio'} onClose={close} dir="up" align="left" width={236}>
            {lock ? (
              <div className="locknote">
                <Ic n="lock" className="ic--14" />
                <div className="locknote__t">
                  <b>画幅由模板锁定</b>
                  <span>「{lock.name}」把画幅定在 {window.BC_TPL.ratioLabel(lock.ratio)}，改画幅要先在模板设置里解锁。</span>
                  <Btn size="s" variant="secondary" icon="template" onClick={() => { close(); ctx.openTplProps(); }}>去模板设置</Btn>
                </div>
              </div>
            ) : null}
            <Menu>
              {D.ratios.map((r) => (
                <MenuItem key={r} label={r} on={r === ratio} disabled={!!lock && r !== lock.ratio}
                  sub={lock && r === lock.ratio ? '模板锁定' : null}
                  onClick={() => { setRatio(r); close(); }} />
              ))}
              <MenuRule />
              <MenuItem label="自定义…" disabled={!!lock} onClick={() => { close(); setCustom(true); }} />
              <MenuRule />
              {/* 平台安全区（2026-09-27）：竖幅才可点；Shorts 项目进编辑器时默认开着。开关不进文档、不进撤销。 */}
              <MenuItem label="平台安全区" check={portrait && !!ctx.safeArea} disabled={!portrait} wrap
                sub={portrait ? '标出平台按钮和文案会挡住的地方' : '竖屏画幅才有平台按钮遮挡'}
                onClick={() => ctx.setSafeArea(!ctx.safeArea)} />
            </Menu>
          </Popover>
        </div>

        {/* 倍速与全屏播放器共用一份（ctx.speed），退出全屏后保持。 */}
        <div style={{position: 'relative'}}>
          <Tip label="倍速">
            <R.ActionButton size="S" isQuiet aria-label={'倍速 ' + speed + '×'} onPress={() => toggle('speed')}
              UNSAFE_className="stagebar__chip">
              <R.Icons.SpeedFast />
              <R.Text>{speed}×</R.Text>
            </R.ActionButton>
          </Tip>
          <Popover open={pop === 'speed'} onClose={close} dir="up" align="left" width={120}>
            <Menu>
              {D.speeds.map((s) => (
                <MenuItem key={s} label={s + '×'} on={s === speed} onClick={() => { setSpeed(s); close(); }} />
              ))}
            </Menu>
          </Popover>
        </div>

        <div className="spacer" />

        {/* 纯图标的小号钮框只比图标宽 4px，挨着排会挤成一团：组内拉开 12px。 */}
        <div className="stagebar__icons">
          <IconBtn icon="captions" size="s" onLayer on={subsOn}
            tip={subsOn ? '隐藏字幕' : '显示字幕'} onClick={() => setSubsOn(!subsOn)} />

          <div style={{position: 'relative'}}>
            <IconBtn icon={volIcon(vol, muted)} size="s" onLayer tip="音量" onClick={() => toggle('vol')} />
            <Popover open={pop === 'vol'} onClose={close} dir="up" align="right" width={240} className="pop--pad" label="音量">
              <div className="stvol-row">
                <IconBtn icon={volIcon(vol, muted)} size="s" onClick={() => setMuted(!muted)} tip={muted ? '取消静音' : '静音'} />
                <VolumeSlider value={muted ? 0 : vol} onChange={(v) => { setVol(v); setMuted(false); }} />
              </div>
            </Popover>
          </div>

          {/* 真全屏要在**这一拍**里要（第 222 轮）：浏览器只认用户手势当场发出的
              requestFullscreen，挪到覆盖层挂载后再要会被静默拒绝——那正是此前
              「点全屏只占了一部分」的一半原因（另一半是当时压根没有覆盖层）。 */}
          <IconBtn icon={fs ? 'exitfs' : 'fullscreen'} size="s" onLayer
            tip={fs ? '退出全屏' : '全屏'}
            onClick={() => { if (!fs) window.enterFullscreen(); setFs(!fs); }} />
        </div>

        <Dialog open={custom} title="自定义画幅比" onClose={() => setCustom(false)} width={300}
          footer={[
            <Btn key="c" variant="secondary" onClick={() => setCustom(false)}>取消</Btn>,
            <Btn key="k" variant="accent" onClick={() => { setRatio('21:9'); setCustom(false); app.toast('画幅已改为 21:9'); }}>应用</Btn>,
          ]}>
          <div className="row gap8">
            <div style={{width: 96}}><Field size="s" defaultValue="21" /></div>
            <span className="t-detail">:</span>
            <div style={{width: 96}}><Field size="s" defaultValue="9" /></div>
          </div>
        </Dialog>
      </div>
    );
  }

  /* 音量杆（product-design §5.3；与 packages/ui 的 stage-bar.tsx 同一种做法）：杆上不写数字，
     鼠标停在杆上或拖着拇指时，拇指上方出 S2 提示写当前音量。提示锚在整条杆上、横向偏到拇指的位置，拖动时跟着走。
     步长 5：↑ / ↓ 一档 10，25 一档的杆会把 70% 吸成 75%。 */
  function VolumeSlider({value, onChange}) {
    const R = window.RSP;
    const trackRef = React.useRef(null);
    return (
      <R.AriaSlider aria-label="音量" className="stvol" minValue={0} maxValue={100} step={5} value={value}
        formatOptions={{style: 'unit', unit: 'percent'}} onChange={onChange}>
        <R.SliderTrack ref={trackRef} className="stvol__track">
          {({state, isHovered}) => {
            const at = state.getThumbPercent(0);
            const shift = (at - 0.5) * (trackRef.current ? trackRef.current.clientWidth : 0);
            return (
              <>
                <div className="stvol__rail" />
                <div className="stvol__fill" style={{width: at * 100 + '%'}} />
                <R.SliderThumb className="stvol__thumb" />
                <TrackTip anchorRef={trackRef} open={isHovered || state.isThumbDragging(0)} crossOffset={shift}>
                  {state.getThumbValueLabel(0)}
                </TrackTip>
              </>
            );
          }}
        </R.SliderTrack>
      </R.AriaSlider>
    );
  }

  /* 由调用方决定开合、锚在任意元素上的 S2 提示。TooltipTrigger 要一个能聚焦的触发器，杆上那个是拇指里藏起来的
     input，鼠标碰不到；这里直接把开合与锚点交给 react-aria 的提示上下文。读屏从滑杆自己的读数念音量。 */
  function TrackTip({anchorRef, open, crossOffset, children}) {
    const R = window.RSP;
    const state = React.useMemo(() => ({isOpen: open, open() {}, close() {}, shouldSkipAnimation: false}), [open]);
    return (
      <R.TooltipTriggerStateContext.Provider value={state}>
        <R.TooltipContext.Provider value={{triggerRef: anchorRef, crossOffset}}>
          <R.Tooltip>{children}</R.Tooltip>
        </R.TooltipContext.Provider>
      </R.TooltipTriggerStateContext.Provider>
    );
  }

  Object.assign(window, {StageView, StageBar});
})();
