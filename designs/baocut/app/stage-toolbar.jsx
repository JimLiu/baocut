/* 画布浮动工具条 —— §14.3。
   ============================================================================
   分段与词表来自 `BC_BAR`（`app/model-toolbar.js`）。这里只负责**把 id 画成控件**，不再各类型手写一遍
   ——此前 inline 是一条平的 chip 流，分段信息全丢了，而分段本身是语义：
   颜色/字体/字号是一组、动画/效果是另一组，它们之间不该看起来一样近。

   第 39.7 轮跟着配置表补齐的：
     · **组间竖分隔线**（`visible` 就是分组的数组）；
     · **贴纸改走 `SVG` 那一条**——`fill-list` 列出素材里每一个填充色分别改，
       替掉第 39.1 轮那个猜的「着色 · 只染单色层」；
     · **文本组走 `groups`**：解组 / 删除两件（不放「存到品牌库」——
       第 79 轮起浮动条一处都不放它，入口只在属性面板），**不出 `···`**；
     · 覆盖层 / 取景框 / 模板从「只有一颗属性钮」的兜底分支里出来。
   ============================================================================ */
(function () {
  const {useState, useRef, useEffect, useLayoutEffect} = React;
  const D = window.BC_DATA;
  const E = window.BC_EL;
  const B = window.BC_BAR;

  /* 素材文本的取用与 `fillList` 的读写第 122 轮搬进
     [sticker-fills.jsx](sticker-fills.jsx)：属性页上那一行色卡与条子上这一排是
     同一份判据、同一份状态，两处各写一遍必然漂。 */

  /* ---------- 动画下拉（条子上 `animation` 那一格打开的就是这个） ---------- */
  function AnimDD({anim, setAnim, onOpenPane, ctx, peekId}) {
    const [slot, setSlot] = useState('in');
    const cur = anim[slot] || {k: 'none'};
    const a = E.find(slot, cur.k);
    /* 悬停即预览（第 122 轮补上）：这张下拉此前是**唯一**没有预览的动画选择器——
       同一支动画，在属性页上停一下画面会走，在条子上停一下什么都不发生。
       载荷装配与属性页共用一处（`animPeekProps`），窗口规则不写第二遍。 */
    const hover = (it) => window.animPeekProps(ctx, peekId, {
      slot, k: it.k, dur: cur.k === it.k ? cur.dur : null,
      dir: it.dirs ? (cur.k === it.k ? cur.dir : (it.dirs === E.DIR2 ? 'cw' : 'up')) : null,
    });
    return (
      <>
        <div style={{padding: '3px 3px 5px'}}>
          <Segmented size="s" value={slot} onChange={setSlot}
            items={[{k: 'in', label: 'In'}, {k: 'out', label: 'Out'}, {k: 'loop', label: 'Loop'}]} />
        </div>
        <div onMouseLeave={() => (ctx && ctx.setPeek ? ctx.setPeek(null) : null)}>
          {E.ANIMS[slot].map((it) => (
            <BCAction size="M" key={it.k} className={cx('mdi', cur.k === it.k && 'is-on')} {...hover(it)}
              onClick={() => { if (ctx && ctx.setPeek) ctx.setPeek(null); setAnim({...anim, [slot]: {
                k: it.k,
                dir: it.dirs ? (cur.k === it.k ? cur.dir : (it.dirs === E.DIR2 ? 'cw' : 'up')) : null,
                dur: cur.k === it.k ? cur.dur : (slot === 'loop' ? 2 : 0.6),
              }}); }}>
              <span className="nm">{it.name}</span>
              {it.dirs ? <i className="kbd">方向</i> : null}
              {cur.k === it.k ? <Ic n="check" className="ic--14" /> : null}
            </BCAction>
          ))}
        </div>
        {a.dirs ? (
          <>
            <div className="mprule" />
            <div style={{padding: '0 3px 4px'}}>
              <Segmented size="s" value={cur.dir || a.dirs[0].k}
                onChange={(v) => setAnim({...anim, [slot]: {...cur, dir: v}})} items={a.dirs} />
            </div>
            <div className="mval" style={{minHeight: 22}}>
              <span className="t-detail-xs">落成 <b className="t-mono">{E.animEnum(slot, cur.k, cur.dir)}</b></span>
            </div>
          </>
        ) : null}
        {cur.k !== 'none' ? (
          <div className="mval">{slot === 'loop' ? '一轮' : '时长'}
            <Slider value={cur.dur || (slot === 'loop' ? 2 : 0.6)} min={0.1}
              max={slot === 'loop' ? 6 : 3} step={0.1}
              onChange={(v) => setAnim({...anim, [slot]: {...cur, dur: v}})} />
            <span className="v">{(cur.dur || (slot === 'loop' ? 2 : 0.6)).toFixed(1)}s</span>
          </div>
        ) : null}
        <div className="mprule" />
        <BCAction size="M" className="mdi" onClick={onOpenPane}>
          <Ic n="anim" className="ic--14" />
          <span className="nm">在面板里打开</span>
          <NavChevron />
        </BCAction>
      </>
    );
  }

  /* ---------- 条子 ---------- */
  function Toolbar({kind, el, ctx, st, set, below, raised, yielding, clear}) {
    const app = useApp();
    const ref = useRef(null);
    const anchor = useRef(null);
    const [floating, setFloating] = useState(null);
    const [portalRoot, setPortalRoot] = useState(null);
    const popupTrigger = useRef(null);
    const [pop, setPop] = useState(null);          // 单值互斥
    const videoBar = kind === 'video';
    const stagePortal = kind === 'subtitle' || videoBar;
    /* 描边弹层的**取色子页**（第 83 轮）。开在
       Toolbar 这一层而不是弹层内部：弹层的宽度由 `dd(children, w)` 在挂载时给，
       子页要换成取色面板那一档宽度（270），得让这个开关比它先存在。 */
    const [csub, setCsub] = useState(false);
    /* 变速弹层的「自定义」展位（第 84 轮）：它不是第五个档位，是把滑杆放出来的开关，
       所以与 `csub` 一样得住在弹层之外——弹层每次开合都会重挂。 */
    const [spd, setSpd] = useState(false);
    const tg = (k) => setPop(pop === k ? null : k);
    const close = () => setPop(null);
    /* 弹层一关就撤掉悬停预览：条子上会写 `peek` 的只剩元素动画下拉，
       字幕 Animation 仅导航到属性页。点画面别处关掉弹层不经过下拉自己的
       `onMouseLeave`——不撤，画面会停在最后停过的那一格上，看起来像「我明明没点，
       样式却变了」；动画那张更严重：预览是真播放，不撤就一直在那一段里循环。 */
    useEffect(() => {
      const keep = pop === 'animation';
      if (!keep && ctx.setPeek) ctx.setPeek(null);
    }, [pop]);
    useEffect(() => () => { if (ctx.setPeek) ctx.setPeek(null); }, []);
    /* 色卡读的是**画面上现在那一张**（`st.asset` / `st.builtin` 优先于演示装置自带
       的那张），否则在目录里换过素材之后，列出来的还是上一张的填充色。位图与动图
       没有 fill 可换（`vector` 为 false），整段不出。 */
    const fl = window.useStickerFills(ctx, kind === 'sticker' ? el : null, st);

    /* **条子本身也对着画面框夹一次**（第 88 轮）。`.mtb` 是「以选中框中心为准
       `translateX(-50%)`」，所以靠边的元素条子会被 `overflow: hidden` 的画面框裁掉——
       此前没人撞上是因为窄条子只有两三件；计时的条子是五件（模式 ＋ 颜色 / 字体 / 字号
       ＋ 动画 ＋ `···`），落在左上角时最先没掉的正是那枚这一类独有的模式下拉。
       判据与上面弹层那一段同源：对着 `.frame` 量、留 8px 边距。只补一个**横向位移**，
       不改锚点——条子仍然跟着框走，只是不许探出画面。量之前先把上一次的位移减掉，
       否则会一次比一次多补。 */
    const [shift, setShift] = useState(0);
    /* 字幕条子比小画布还宽：挂到 .stage，保留选中框里的锚点；只把 UI 夹在舞台
       工作区内，视频内容仍由 .frame 裁切。不能再把整条塞进视频画幅。 */
    useLayoutEffect(() => {
      if (!stagePortal) return;
      const measure = () => {
        const node = ref.current, host = anchor.current;
        const stage = host && host.closest('.stage');
        if (!node || !stage) return;
        const box = (host.parentElement.querySelector('.selbox') || host.parentElement).getBoundingClientRect();
        const area = stage.getBoundingClientRect();
        const bar = node.getBoundingClientRect();
        const maxWidth = Math.max(0, area.width - 16);
        const width = Math.min(bar.width, maxWidth);
        const left = Math.max(area.left + 8, Math.min(box.left + box.width / 2 - width / 2, area.right - width - 8));
        const desiredTop = below ? box.bottom + 12 : box.top - bar.height - (raised ? 50 : 12) - (clear || 0);
        const top = Math.max(area.top + 8, Math.min(desiredTop, area.bottom - bar.height - 8));
        const next = videoBar ? B.videoPlacement(box, area, bar)
          : {left: Math.round(left - area.left), top: Math.round(top - area.top), maxWidth: Math.round(maxWidth)};
        setPortalRoot(stage);
        setFloating(old => old && old.left === next.left && old.top === next.top && old.maxWidth === next.maxWidth ? old : next);
      };
      measure();
      window.addEventListener('resize', measure);
      window.addEventListener('scroll', measure, true);
      const observer = new ResizeObserver(measure);
      if (anchor.current?.closest('.stage')) observer.observe(anchor.current.closest('.stage'));
      if (ref.current) observer.observe(ref.current);
      return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
    });
    useLayoutEffect(() => {
      if (stagePortal) return;
      const node = ref.current;
      const frame = node && node.closest('.frame');
      if (!node || !frame) return;
      const M = 8;
      const bar = node.getBoundingClientRect();
      const fr = frame.getBoundingClientRect();
      const left = bar.left - shift;
      const right = bar.right - shift;
      let d = 0;
      if (left < fr.left + M) d = (fr.left + M) - left;
      else if (right > fr.right - M) d = (fr.right - M) - right;
      d = Math.round(d);
      if (d !== shift) setShift(d);
    });

    useEffect(() => {
      setCsub(false);                              // 换弹层（或关掉）一律回到子页之前那一层
      setSpd(false);                               // 同上：自定义那一档也回到收起来的样子
    }, [pop]);

    const dd = (children, w) => (
      <Popover open onClose={close} anchorRef={popupTrigger} dir={videoBar ? 'up' : 'down'}
        className="mdd bc-scroll" width={w}>{children}</Popover>
    );
    const num = (k, d) => (st[k] == null ? d : st[k]);

    /* Color controls fit the native Popover content box, including its 8px inset. */
    const ColorPop = ({k, value, scope, onPick, clearLabel}) => (
      pop === k ? (
        <Popover open onClose={close} anchorRef={popupTrigger} className="mpop bc-scroll" width={270}>
          {clearLabel ? (
            <>
              <BCAction size="M" className={cx('mdi', !value && 'is-on')} onClick={() => { onPick(null); close(); }}>
                <span className="cdot cdot--none" /><span className="nm">{clearLabel}</span>
                {!value ? <Ic n="check" className="ic--14" /> : null}
              </BCAction>
              <div className="mprule" />
            </>
          ) : null}
          {/* 拖 SV 方块 / 敲 Hex 是「还在调」（`live`），只有点色板里的一格才收起浮层 */}
          <window.ColorPanel value={value} scope={scope}
            onPick={(c, live) => { onPick(c); if (!live) close(); }} />
        </Popover>
      ) : null
    );

    const openPane = (tab) => { close(); ctx.setTab(tab); ctx.setPaneHidden(false); };
    // 第 152 轮起字幕与翻译是同一个 Tab：选中里的 trackId 决定面板落在哪条轨上
    const openSubPane = () => openPane('subtitle');
    const paneOf = kind === 'text' || kind === 'textgroup' ? 'text'
      : kind === 'image' ? 'image' : kind === 'video' ? 'video'
      : kind === 'subtitle' ? 'subtitle' : 'elements';

    /* ---- 逐 id 的渲染器。分段由配置给，这里只管画一颗。 ---- */
    function renderItem(id) {
      const it = B.item(id);
      switch (id) {
        case 'color': {
          /* 计时走**它自己那一批字符样式键**（`cntColor` / `cntFont` / `cntSize`，见
             `BC_EL.SHARED.counter`）：条子上这三颗与 Text 面板是同一批控件，但计时读
             画布共用袋、文字元素逐元素持有样式，两边共用 `color` / `size` 会让改一次
             计时把画面上还没设过色的文字一起染了。 */
          const key = kind === 'shape' ? 'fill'
            : kind === 'vframe' ? 'chrome' : kind === 'counter' ? 'cntColor' : 'color';
          const scope = kind === 'shape' ? '填充'
            : kind === 'vframe' ? 'Chrome' : kind === 'counter' ? '读数'
            : kind !== 'subtitle' ? '文字'
            // 字幕的取色范围就是当下这一条轨——第 47 轮之后没有「几条一起写」这一档
            : (window.BC_SUB.byId(ctx.subStyle, ctx.sel && ctx.sel.trackId)
               || window.BC_SUB.tracks(ctx.subStyle)[0] || {}).name;
          return (
            <React.Fragment key={id}>
              <BCAction className={cx('mb', pop === id && 'is-on')} onClick={() => tg(id)}>
                <span className="cdot" style={{'--swatch-c': st[key]}} /><span className="mtip">{scope}</span>
              </BCAction>
              <ColorPop k={id} value={st[key]} scope={scope} onPick={(c) => set({[key]: c})} />
            </React.Fragment>
          );
        }
        case 'fill-list':
          /* 矢量贴纸：素材里有几个填充色分组就列几张卡（最多 5 张），逐张改。位图与
             动图没有 fill 可换，整段不出——摆一个永远在「读取素材…」的占位比不摆更糟。
             素材已读到、却一张卡都没有（超过 15 种色的插画）时同样不摆。 */
          if (!fl.vector) return null;
          if (!fl.ready) return <div key={id} className="mchip mchip--mute">读取素材…</div>;
          return (
            <React.Fragment key={id}>
              {fl.cards.map((c, i) => {
                const fk = 'f' + i;
                const scope = '第 ' + (i + 1) + ' 组';
                return (
                  <React.Fragment key={fk}>
                    <BCAction className={cx('mb', pop === fk && 'is-on')} onClick={() => tg(fk)}>
                      <span className="cdot" style={{'--swatch-c': fl.at(i)}} />
                      <span className="mtip">{scope}</span>
                    </BCAction>
                    <ColorPop k={fk} value={fl.at(i)} scope={scope} clearLabel="原色"
                      onPick={(x) => fl.setAt(i, x)} />
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        case 'font': {
          const key = kind === 'counter' ? 'cntFont' : 'font';   // 见上面 `color` 那条
          return (
            <React.Fragment key={id}>
              <BCAction className={cx('mchip', pop === id && 'is-on')} onClick={() => tg(id)}>
                {String(st[key]).split(' ')[0]}<Ic n="chevdown" className="ic--14" />
              </BCAction>
              {pop === id ? dd(<window.FontPicker value={st[key]}
                onPick={(n) => { set({[key]: n}); close(); }} />, 268) : null}
            </React.Fragment>
          );
        }
        case 'size': {
          const steps = B.SIZES;          // 与 Text 面板的字号选择器同一份
          const key = kind === 'counter' ? 'cntSize' : 'size';   // 见上面 `color` 那条
          return (
            <React.Fragment key={id}>
              <BCAction className={cx('mchip', pop === id && 'is-on')} onClick={() => tg(id)}>
                {st[key]}<Ic n="chevdown" className="ic--14" />
              </BCAction>
              {pop === id ? dd(
                <>
                  {steps.indexOf(st[key]) < 0 ? (
                    <div className="mdi is-on"><span className="nm">{st[key]}px</span><Ic n="check" className="ic--14" /></div>
                  ) : null}
                  {steps.map((sz) => (
                    <BCAction size="M" key={sz} className={cx('mdi', st[key] === sz && 'is-on')}
                      onClick={() => { set({[key]: sz}); close(); }}>
                      <span className="nm">{sz}px</span>
                      {st[key] === sz ? <Ic n="check" className="ic--14" /> : null}
                    </BCAction>
                  ))}
                </>, 176) : null}
            </React.Fragment>
          );
        }
        case 'transitions': {
          const doc = (ctx.elDocs || {})[el.id] || {};
          const active = ['in', 'out'].some(slot => doc.transitions?.[slot]?.k && doc.transitions[slot].k !== 'none');
          const inPanel = ctx.tab === 'video' && ctx.paneView === 'transitions' && !ctx.paneHidden;
          return <BCAction key={id} className={cx('mchip', inPanel && 'is-on')}
              onClick={() => { openPane('video'); ctx.setPaneView('transitions'); }} aria-pressed={inPanel}>
              <Ic n="transitions" className="ic--16" />转场{active ? <span className="mdot" /> : null}
            </BCAction>;
        }
        case 'animation': {
          const doc = (ctx.elDocs || {})[el.id] || {};
          const anim = doc.anim || {in: {k: 'none'}, out: {k: 'none'}, loop: {k: 'none'}};
          const on = E.animSummary(anim) !== '未设置';
          if (kind === 'text' || kind === 'textgroup') return <BCAction key={id} className="mb"
            onClick={() => { openPane('text'); ctx.setPaneView('anims'); }}>
            <Ic n="anim" className="ic--16" />{on ? <span className="mdot" /> : null}
            <span className="mtip">动画 · {E.animSummary(anim)}</span>
          </BCAction>;
          return (
            <React.Fragment key={id}>
              <BCAction className={cx(kind === 'video' ? 'mchip' : 'mb', pop === id && 'is-on')} onClick={() => tg(id)}>
                <Ic n="anim" className="ic--16" />
                {kind === 'video' ? '动画' : null}
                {on ? <span className="mdot" /> : null}
                <span className="mtip">动画 · {E.animSummary(anim)}</span>
              </BCAction>
              {pop === id ? dd(<AnimDD anim={anim} setAnim={(v) => ctx.setElDoc(el.id, {anim: v})}
                ctx={ctx} peekId={el.id}
                onOpenPane={() => { openPane(paneOf); ctx.setPaneView('anims'); }} />, 214) : null}
            </React.Fragment>
          );
        }
        case 'border': {
          const bw = num('borderW', 3);
          const bon = st.borderOn !== false && bw > 0;
          const setStroke = (c) => set({stroke: c, borderW: Math.max(1, bw), borderOn: true});
          return (
            <React.Fragment key={id}>
              {/* 「☰ 描边」——图标 + 文字，不是光秃秃一个词加箭头 */}
              <BCAction className={cx('mchip', pop === id && 'is-on')} onClick={() => tg(id)}>
                <Ic n="list" className="ic--14" />描边<Ic n="chevdown" className="ic--14" />
              </BCAction>
              {/* 取色子页（第 83 轮）：整张弹层换页，
                  页头是「‹ 描边颜色 …… 完成」，页身是与全 App 同一张**通用取色面板**。
                  ‹ 与「完成」做的是同一件事：都只是回上一层。
                  此前这一格是 32 色网格：调一个目录里没有的描边色，在这张弹层里无路可走。 */}
              {pop === id ? (csub ? dd(
                <>
                  <div className="mval">
                    <BCAction className="backb" onClick={() => setCsub(false)}>
                      <Ic n="back" className="ic--14" />描边颜色
                    </BCAction>
                    <Btn size="s" className="push" onClick={() => setCsub(false)}>完成</Btn>
                  </div>
                  {/* 拖 SV / 敲 Hex / 点色板都不关页——回上一层由 ‹ 与「完成」给 */}
                  <window.ColorPanel value={st.stroke} scope="描边"
                    onPick={(c) => setStroke(c)} />
                </>, 270) : dd(
                <>
                  {/* 描边弹层第一行是开关（默认开） */}
                  <div className="mval">描边
                    <div style={{marginLeft: 'auto'}}>
                      <Switch on={bon} onChange={(v) => set({borderOn: v, borderW: v ? Math.max(1, bw) : 0})} />
                    </div>
                  </div>
                  <div className="mprule" />
                  {/* 粗细一行是「滑杆 ＋ 可输入的数字框」，不是一个只读读数 */}
                  <div className="mval">粗细
                    <Slider value={bon ? bw : 0} min={0} max={20} disabled={!bon}
                      onChange={(v) => set({borderW: v, borderOn: v > 0})} />
                    <div style={{width: 46, flex: 'none'}}>
                      <Field size="s" className="t-mono" value={bon ? bw : 0} disabled={!bon}
                        onChange={(e) => {
                          const n = Math.max(0, Math.min(20, +e.target.value || 0));
                          set({borderW: n, borderOn: n > 0});
                        }} />
                    </div>
                  </div>
                  <div className="mprule" />
                  {/* 第三行：「颜色 ……色钮」，色板本身在子页里 */}
                  <BCAction className="mval mval--btn" disabled={!bon} onClick={() => setCsub(true)}>
                    颜色<span className="cdot push" style={{'--swatch-c': st.stroke}} />
                  </BCAction>
                </>, 210)) : null}
            </React.Fragment>
          );
        }
        case 'adjust':
          /* `adjust` 开的是**右侧那一整页**（Adjust Image / Adjust Video：颜色校正
             五项 ＋ 效果四项 ＋ 全部重置），不是一个弹层。第 84 轮改过来——此前这里是
             「不透明度 ＋ 圆角」两根滑杆，那两件是 `···` 菜单里的另外两行，
             摆在名叫「调整」的 chip 后面，点开与预期完全不是一回事。 */
          return (
            <BCAction key={id} className="mchip" onClick={() => { openPane(paneOf); ctx.setPaneView('adjust'); }}>
              <Ic n="tune" className="ic--14" />调整
            </BCAction>
          );
        /* 声波 / 进度的色槽（第 213 轮）。1–2 枚色点画在
           样式下拉**前面**——「大部分类型都能直接在浮动条上改色」是浮动条的基线，此前
           这两族的颜色只能钻进属性页改。
           出几枚、每枚叫什么，**按款查表**（`colors` / `labels`），条子上不另写一
           份判据：两条彩虹边框是 0 枚（配色写死在着色器里），声波 10 款都至少 1 枚。 */
        case 'wave-colors':
        case 'progress-colors': {
          const isW = id === 'wave-colors';
          const map = E.SHARED[isW ? 'wave' : 'progress'];
          const list = isW ? E.WAVES : E.PROGRESS;
          const cur = list.filter((x) => x.k === st[map.style])[0] || list[0];
          const keys = [map.main, map.second];
          if (!cur.colors) return null;       // 整段不出（见下面那条空段规则）
          return (
            <React.Fragment key={id}>
              {Array.from({length: cur.colors}, (_, i) => {
                const pk = (isW ? 'wc' : 'pc') + i;
                const key = keys[i];
                const scope = cur.labels[i] || '颜色';
                return (
                  <React.Fragment key={pk}>
                    <BCAction className={cx('mb', pop === pk && 'is-on')} onClick={() => tg(pk)}>
                      <span className="cdot" style={{'--swatch-c': st[key]}} />
                      <span className="mtip">{scope}</span>
                    </BCAction>
                    <ColorPop k={pk} value={st[key]} scope={scope}
                      onPick={(c) => set({[key]: c})} />
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        }
        case 'wave-picker':
        case 'progress-picker': {
          const isWave = id === 'wave-picker';
          const list = isWave ? E.WAVES : E.PROGRESS;
          const key = isWave ? 'waveStyle' : 'progStyle';
          const cur = list.filter((x) => x.k === st[key])[0] || list[0];
          return (
            <React.Fragment key={id}>
              <BCAction className={cx('mchip', pop === id && 'is-on')} onClick={() => tg(id)}>
                {cur.name}<Ic n="chevdown" className="ic--14" />
              </BCAction>
              {pop === id ? dd(list.map((x) => (
                <BCAction size="M" key={x.k} className={cx('mdi', cur.k === x.k && 'is-on')}
                  /* 换款要**连这一款自己的那对色一起写**，与属性页的目录子页
                     （`panel-element-edit` 的 `onPick`）同一条：色位的语义按款不
                     同——涟漪的第 2 色是**背景**（默认透明），其余 13 款的第 2 色
                     根本不出面板、存的只是建出来时留下的白。只写 `k` 就是把一个
                     从没被用户选过的不透明白塞进「整只盒子铺满」的角色里。声波再
                     带上这一款的 dB 窗（4 款是 −120 / −10 那扇窄窗）。
                     点哪一枚就落哪一枚（包括当前亮着的那一枚，重新点一次＝把这一
                     款的原色拿回来），与属性页目录子页同一条，不加「同款不写」的
                     守卫——否则串了色的元素在下拉里点不回来。 */
                  onClick={() => { set(E.toStage(isWave ? 'wave' : 'progress', Object.assign(
                    {style: x.k, main: x.main, second: x.second},
                    x.minDb == null ? {} : {mindb: x.minDb, maxdb: x.maxDb}))); close(); }}>
                  <span className="mthumb"><window.VizGlyph it={x} /></span>
                  <span className="nm">{x.name}</span>
                  {cur.k === x.k ? <Ic n="check" className="ic--14" /> : null}
                </BCAction>
              )), 214) : null}
            </React.Fragment>
          );
        }
        /* 计时的模式下拉（第 88 轮）：与进度 / 声波的样式下拉同一种形态，只是这两格
           是**内容**的模式（倒计 / 正计）而不是着色器样式。 */
        case 'counter-mode': {
          const cur = E.countOf(st.cntMode);
          return (
            <React.Fragment key={id}>
              <BCAction className={cx('mchip', pop === id && 'is-on')} onClick={() => tg(id)}>
                {cur.name}<Ic n="chevdown" className="ic--14" />
              </BCAction>
              {pop === id ? dd(E.COUNTERS.map((x) => (
                <BCAction size="M" key={x.k} className={cx('mdi', cur.k === x.k && 'is-on')}
                  onClick={() => { set({cntMode: x.k}); close(); }}>
                  <span className="mthumb"><window.VizGlyph it={x} /></span>
                  <span className="nm">{x.name}</span>
                  {cur.k === x.k ? <Ic n="check" className="ic--14" /> : null}
                </BCAction>
              )), 190) : null}
            </React.Fragment>
          );
        }
        case 'volume':
          return (
            <React.Fragment key={id}>
              <BCAction className={cx('mb', pop === id && 'is-on')} onClick={() => tg(id)}>
                <Ic n={num('vol', 0) === 0 ? 'vol0' : 'vol3'} className="ic--16" />
                <span className="mtip">音量 {num('vol', 0)}%</span>
              </BCAction>
              {/* 音量弹层是「滑杆 ＋ 数字框」，下面挂一张**音频淡入淡出**卡
                  （开关 ＋ 淡入 / 淡出两根滑杆）。第 84 轮补齐——此前只有一根滑杆
                  与一句说明，淡入淡出在原型上一处都没有。 */}
              {pop === id ? dd(
                <>
                  <div className="mval">
                    <Ic n={num('vol', 0) === 0 ? 'vol0' : 'vol3'} className="ic--14" />
                    <Slider value={num('vol', 0)} min={0} max={100} onChange={(v) => set({vol: v})} />
                    <div style={{width: 52, flex: 'none'}}>
                      <Field size="s" className="t-mono" value={num('vol', 0)}
                        onChange={(e) => set({vol: Math.max(0, Math.min(100, +e.target.value || 0))})} />
                    </div>
                  </div>
                  <div className="mprule" />
                  <div className="mval">音频淡入淡出
                    <div style={{marginLeft: 'auto'}}>
                      <Switch on={!!st.fadeOn} onChange={(v) => set({fadeOn: v})} />
                    </div>
                  </div>
                  {st.fadeOn ? (
                    <>
                      <div className="mval">淡入
                        <Slider value={num('fadeIn', 1)} min={0} max={E.FADE_MAX} step={0.1}
                          onChange={(v) => set({fadeIn: v})} />
                        <span className="v">{num('fadeIn', 1)}s</span>
                      </div>
                      <div className="mval">淡出
                        <Slider value={num('fadeOut', 1)} min={0} max={E.FADE_MAX} step={0.1}
                          onChange={(v) => set({fadeOut: v})} />
                        <span className="v">{num('fadeOut', 1)}s</span>
                      </div>
                    </>
                  ) : null}
                </>, 250) : null}
            </React.Fragment>
          );
        case 'speed': {
          /* 变速弹层是**一行 chip**（0.5× 1× 1.5× 2× 自定义），点「自定义」不改
             速度，只把一根滑杆放出来。第 84 轮改成这样——此前是六档的下拉清单，
             没有自定义，档位里还多出 0.75 / 1.25。 */
          const rate = num('rate', 1);
          const custom = spd || !E.isPresetSpeed(rate);
          return (
            <React.Fragment key={id}>
              <BCAction className={cx('mb', pop === id && 'is-on')} onClick={() => tg(id)}>
                <Ic n="speed" className="ic--16" /><span className="mtip">变速 {rate}×</span>
              </BCAction>
              {pop === id ? dd(
                <>
                  <div className="mval">变速
                    <div className="vchips push">
                      {E.SPEEDS.map((r) => (
                        <BCAction key={r} className={cx('vchip', !custom && rate === r && 'is-on')}
                          onClick={() => { setSpd(false); set({rate: r}); }}>{r}×</BCAction>
                      ))}
                      <BCAction className={cx('vchip', custom && 'is-on')}
                        onClick={() => setSpd(true)}>自定义</BCAction>
                    </div>
                  </div>
                  {custom ? (
                    <div className="mval">
                      <Slider value={rate} min={E.SPEED_MIN} max={E.SPEED_MAX} step={0.05}
                        onChange={(v) => set({rate: v})} />
                      <span className="v">{rate}×</span>
                    </div>
                  ) : null}
                </>, 300) : null}
            </React.Fragment>
          );
        }
        case 'text-styles':
          return <BCAction key={id} className="mb" onClick={() => { openPane('text'); ctx.setPaneView('styles'); }}>
            <Ic n="styles" className="ic--16" /><span className="mtip">样式</span></BCAction>;
        case 'effect':
          return <BCAction key={id} className="mb" onClick={() => app.toast('文字效果：本轮为骨架')}>
            <Ic n="star" className="ic--16" /><span className="mtip">效果</span></BCAction>;
        case 'sub-style':
          return <BCAction key={id} className="mchip" onClick={() => { openSubPane(); ctx.setPaneView('subgallery'); }}>
            <Ic n="styles" className="ic--16" />Styles</BCAction>;
        case 'sub-edit':
          return <BCAction key={id} className="mchip" onClick={() => { openSubPane(); ctx.setPaneView('subedit'); }}>
            <Ic n="cursor-text" className="ic--16" />Edit</BCAction>;
        case 'sub-scope': {
          /* 换一条字幕轨来编辑。这几颗与属性页顶部那排 chip 是同一个开关——选中真相在
             `sel.trackId`，工具条只是它的第二个入口。**没有「整组」那一颗**（第 47 轮）：
             字幕各自选中、各自编辑。只有一条轨时整段不出——没什么可换的。 */
          if (window.BC_SUB.tracks(ctx.subStyle).length < 2) return null;
          return (
            <React.Fragment key={id}>
              {window.BC_SUB.tracks(ctx.subStyle).map((t) => (
                <BCAction key={t.id} className={cx('mchip', 'mscope', (ctx.sel && ctx.sel.trackId) === t.id && 'is-on')}
                  onClick={() => ctx.pickSub(t.id)}>{t.name}</BCAction>
              ))}
            </React.Fragment>
          );
        }
        case 'sub-cue-scope': {
          /* 字幕条子第一段里的作用域：不画成一颗 Detach 链条钮，
             而是一句说得出口的作用域（§16.3 的判断）。

             **两态之间不是链/断链，是「全部字幕」与「仅这一条」**：一颗链条钮按下去
             画面上什么都不会变（落下的只是一张空覆盖表），用户看不出自己进了另一个作用域；
             这一颗把当前作用域印在条子上，改过几项也印在菜单里，回退分两级。 */
          const cue = ctx.curCue;
          const tid = (ctx.sel && ctx.sel.trackId)
            || (window.BC_SUB.tracks(ctx.subStyle)[0] || {}).id;
          const one = ctx.subScope === 'cue';
          const hit = one && cue && tid
            ? window.BC_SUB.overriddenKeys(ctx.subStyle, cue.id, tid) : [];
          return (
            <React.Fragment key={id}>
              <BCAction className={cx('mchip', pop === id && 'is-on', one && 'is-on')}
                onClick={() => tg(id)}>
                <Ic n={one ? 'link' : 'captions'} className="ic--14" />
                {one ? '仅这一条' : '全部字幕'}<Ic n="chevdown" className="ic--14" />
              </BCAction>
              {pop === id ? dd(
                <>
                  <BCAction size="M" className={cx('mdi', !one && 'is-on')}
                    onClick={() => { ctx.setSubScope('all'); close(); }}>
                    <span className="nm">全部字幕</span>
                    {!one ? <Ic n="check" className="ic--14" /> : null}
                  </BCAction>
                  <BCAction size="M" className={cx('mdi', one && 'is-on')}
                    onClick={() => { ctx.setSubScope('cue'); close(); }}>
                    <span className="nm">仅这一条</span>
                    {one ? <Ic n="check" className="ic--14" /> : null}
                  </BCAction>
                  <div className="mprule" />
                  <div className="t-detail-xs" style={{padding: '6px 8px'}}>
                    {one
                      ? (hit.length
                        ? '这一条有 ' + hit.length + ' 项自定义 · 其余跟随全部字幕'
                        : '这一条还没有自定义 · 下面改的只落在它身上')
                      : '改的是全部 ' + ctx.cues.length + ' 条字幕'}
                  </div>
                  {/* 词表与属性页同一套（第 102.2 轮）：名词 `自定义`、动词 `清除`、
                      去处 `全部字幕`。同一件事在两个入口叫两个名字，用户得自己做映射。 */}
                  {hit.length ? (
                    <BCAction size="M" className="mdi" onClick={() => {
                      ctx.clearSubCue(cue.id, tid, null); close();
                      app.toast('已清除这一条的全部自定义 · 它现在完全跟着全部字幕走');
                    }}>
                      <Ic n="undo" className="ic--14" /><span className="nm">清除全部自定义</span>
                    </BCAction>
                  ) : null}
                </>, 220) : null}
            </React.Fragment>
          );
        }
        case 'sub-animation':
          return <BCAction key={id} className="mchip" onClick={() => { openSubPane(); ctx.setPaneView('subanim'); }}>
            <Ic n="anim" className="ic--16" />Animation</BCAction>;
        case 'overlay-opacity':
          /* 覆盖层用**自己的**键（第 84 轮）：贴纸与视频也有了「不透明度」，
             三类共用一个 `opacity` 的话，拉一下贴纸会把满屏的雪花一起调暗。 */
          return (
            <React.Fragment key={id}>
              <BCAction className={cx('mchip', pop === id && 'is-on')} onClick={() => tg(id)}>
                不透明度 {num('ovlOpacity', 55)}%<Ic n="chevdown" className="ic--14" />
              </BCAction>
              {pop === id ? dd(
                <div className="mval">
                  <Slider value={num('ovlOpacity', 55)} min={0} max={100} onChange={(v) => set({ovlOpacity: v})} />
                  <span className="v">{num('ovlOpacity', 55)}%</span>
                </div>, 200) : null}
            </React.Fragment>
          );
        case 'frame-style':
          return (
            <React.Fragment key={id}>
              <BCAction className={cx('mchip', pop === id && 'is-on')} onClick={() => tg(id)}>
                {st.frameStyle || '摄像机取景'}<Ic n="chevdown" className="ic--14" />
              </BCAction>
              {pop === id ? dd(['摄像机取景', '宝丽来', '电视', '手机', '发光', '16mm'].map((x) => (
                <BCAction size="M" key={x} className={cx('mdi', (st.frameStyle || '摄像机取景') === x && 'is-on')}
                  onClick={() => { set({frameStyle: x}); close(); }}>
                  <span className="nm">{x}</span>
                  {(st.frameStyle || '摄像机取景') === x ? <Ic n="check" className="ic--14" /> : null}
                </BCAction>
              )), 170) : null}
            </React.Fragment>
          );
        case 'delete':
          /* 第 115 轮接真删除：元素真的从画布与时间轴上走，撤销走历史栈。 */
          return <BCAction key={id} className="mb mb--neg" onClick={() => ctx.clipboard.remove()}>
            <Ic n="trash" className="ic--16" /><span className="mtip">删除</span></BCAction>;
        case 'ungroup':
          return <BCAction key={id} className="mchip" onClick={() => app.toast('已解组 · 三个成员各自独立')}>解组</BCAction>;
        case 'tpl-props':
          return <BCAction key={id} className="mchip" onClick={() => openPane('elements')}>模板属性</BCAction>;
        case 'tpl-edit':
          return <BCAction key={id} className="mchip" onClick={() => { close(); ctx.openTplStudio({source: 'project', tpl: ctx.tplDoc}); }}>编辑版面</BCAction>;
        case 'tpl-remove':
          return <BCAction key={id} className="mchip mchip--neg" onClick={() => { close(); ctx.removeTemplate(); }}>移除模板</BCAction>;
        default:
          return <BCAction key={id} className="mchip" onClick={() => openPane(paneOf)}>{it.label}</BCAction>;
      }
    }

    /* 贴纸这一类的条子**由素材决定走哪一条**（第 84 轮）：`.svg` 走 `SVG`
       （逐个填充色改），位图与动图走 `stickers`（调整 ＋ 不透明度 / 圆角）。
       判据是纯函数 `B.barKind`，与 `model-toolbar.test.js` 里那条测试同源。 */
    const bk = B.barKind(kind, fl.source || fl.src);
    const groups = B.visible(bk);
    /* **先画再分段**：有几件的出不出是按款算的（`progress-colors` 在彩虹边框上一格
       都不出），一整组落空时那条竖分隔线也得跟着消失——否则条子最左边挂着一条没有
       东西可分的线。 */
    const painted = groups
      .map((g) => g.map(renderItem).filter((node) => node != null))
      .filter((g) => g.length);
    const hasMore = !!B.more(bk);
    /* 框转了之后，条子按**旋转后的外包盒**再往外让 `clear`（§14.2 round20.4）：它挂在
       不跟着转的 `.selwrap` 上，落位若还按未旋转的框算，45° 的框一转条子就压进框里。
       `.mtb` 走 bottom、`.mtb--below` 走 top，两个 margin 只有一个会生效。 */

    const toolbar = (
      <div ref={ref}
        className={cx('mtb', videoBar && 'mtb--video', below && 'mtb--below', raised && 'mtb--rot', yielding && 'mtb--yield')}
        style={Object.assign({},
          clear && !stagePortal ? {marginBottom: clear, marginTop: clear} : null,
          shift ? {transform: `translateX(calc(-50% + ${shift}px))`} : null,
          stagePortal ? {position: 'absolute', bottom: 'auto', transform: 'none', margin: 0,
            ...floating, visibility: floating ? 'visible' : 'hidden', overflowX: 'auto'} : null)}
        onMouseDown={(e) => e.stopPropagation()}
        onClickCapture={(e) => {
          const trigger = e.target.closest('.mb, .mchip');
          if (trigger && !trigger.closest('[data-pop]')) popupTrigger.current = trigger;
        }}
        onClick={(e) => e.stopPropagation()}>
        {painted.map((g, gi) => (
          <React.Fragment key={gi}>
            {gi ? <div className="sep" /> : null}
            {g}
          </React.Fragment>
        ))}
        {hasMore ? (
          <>
            <div className="sep" />
            <BCAction className={cx('mb', pop === 'more' && 'is-on')} title="More" onClick={() => tg('more')}>
              <Ic n="more" className="ic--16" />
            </BCAction>
            {pop === 'more' ? (
              <window.OverflowMenu el={el} kind={bk} pane={paneOf} ctx={ctx} st={st} set={set}
                onClose={close} anchorRef={popupTrigger} />
            ) : null}
          </>
        ) : null}
      </div>
    );
    return stagePortal ? <><span ref={anchor} hidden />{portalRoot ? ReactDOM.createPortal(toolbar, portalRoot) : toolbar}</> : toolbar;
  }

  Object.assign(window, {Toolbar, AnimDD});
})();
