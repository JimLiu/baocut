/* Elements 面板 · 属性页（§14.2；第 39 轮）。

   **第 83 轮起整页改成一条滚动**（用户裁决：替换此前的 tabs 模式），段序是
   `动画钮 → 颜色 → 旋转/翻转 → 时长 → 删除`（第 122 轮 WP-E 把颜色挪到旋转之前；
   其余各段排在这四段之后）。

   这一页现在分三个文件：本文件是**页容器 ＋ 旋转 ＋ 时长 ＋ 样式目录钻入**，
   颜色与其余样式段在 [panel-element-style.jsx](panel-element-style.jsx)，
   动画子页在 [panel-element-anim.jsx](panel-element-anim.jsx)。

   在这之前这里是三个子 Tab（属性 / 样式 / 动画），立论是「三段改动频率不同」；
   改成一条滚动之后这条论据有了另一种答案——**改动频率低的那两段自己变短了**：层级 /
   替换来源两段退场（`···` 的层级飞出、条子上的 `replace-*` 各自都还在），动画从一个
   Tab 变成一张**子页**。位置 / 尺寸第 83 轮也一并退场过，现已**反转**：几何段
   （钉点 + 距边 + 宽高，`panel-geometry.jsx`，设计稿 bcut-element-geometry-panel-design.md）
   回到这一页，旋转 / 翻转那一行搬进它的末行——面板是投影，画布把手仍是同一份 pose。
   `apps/baocut` 仍是三 Tab（台账 #21 / #90），本轮只动原型。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const E = window.BC_EL;
  const T = window.BC_TIME;
  const B = window.BC_BAR;

  /* ---------- 样式目录钻入（声波 10 / 进度 14） ---------- */
  /** `peekPatch(it)` 由上层给：它必须走**与落笔同一段折算**（`E.toStage`），
   *  否则预览与松手之后不是一个东西——那一跳正好发生在用户判断「是不是我要的」时。 */
  function CatalogView({ctx, kind, value, peekPatch, onPick, onBack}) {
    const list = kind === 'wave' ? E.WAVES : E.PROGRESS;
    /* 退场即撤预览（第 122 轮验收补；与 `panel-subanim` / `panel-substyle` /
       `panel-element-anim` 同一笔）：「返回」那颗按钮就在这块滚动区**里面**，从一格
       上直接点它不经过 `onMouseLeave`——不撤，画面会一直停在最后停过的那一格上，
       属性页上写的却还是原来那一款；`stage-elements` 的 `styleOf` 又是按「当前选中
       的那条」套 peek 的，于是再选别的元素，那条也跟着变。
       2026-09-24 页头规则（§13）起返回钮挪进滚动区外面的 `.panelhd`，这一笔照留：
       键盘、画布上改选中等别的退场路径同样不经过 `onMouseLeave`。 */
    React.useEffect(() => () => ctx.setPeek(null), []);
    return (
      <>
        <window.PanelHead title={kind === 'wave' ? '声波样式' : '进度样式'} onBack={onBack} />
        <div className="pscroll bc-scroll" onMouseLeave={() => ctx.setPeek(null)}>
          {/* 抽屉里的格子与浏览页同一份（第 86 轮起声波是浅底宽格）：
              两处画得不一样，用户就得在「浏览页那一格」和「抽屉里那一格」之间自己做映射。 */}
          <div className={cx('tgrid', kind === 'wave' ? 'tgrid--wave' : 'tgrid--prog')}>
            {list.map((it) => (
              <BCAction key={it.k} className={cx('tilewrap', kind !== 'wave' && !it.square && 'tilewrap--wide')}
                onClick={() => { ctx.setPeek(null); onPick(it); onBack(); }}
                {...window.peekProps(ctx, 'el', (d) => Object.assign({}, d, peekPatch(it)))}>
                <span className={cx('tile', kind === 'wave' ? 'tile--wave' : 'tile--prog',
                  value === it.k && 'is-on')}>
                  <window.VizGlyph it={it} />
                </span>
                <em>{it.name}</em>
              </BCAction>
            ))}
          </div>
          <div className="hint">
            {kind === 'wave'
              ? '控件跟着样式走：示波器与环形波没有 dB 控件，频谱面积 / 点阵 / 脉冲环 / 丝带是双色。'
              : '控件跟着样式走：两款彩虹边框没有颜色控件，两款游走彩虹只有一个「背景」色。'}
          </div>
        </div>
      </>
    );
  }

  /* ---------- 属性页的那三件（第 83 轮） ----------
     这一页此前切成「属性 / 样式 / 动画」三个子 Tab；第 83 轮按用户裁决整页改成
     **一条滚动**，段序是——
       动画钮 → 旋转/翻转 → 颜色（逐色一张卡）→ 时长 → 删除，
     动画从「一个 Tab」变成**一张子页**（页内路由 `'anim'`）。
     层级 / 替换来源退场；位置 / 尺寸当时同样退场，几何面板一轮反转回来
     （台账见 docs/changelog/prototype-ledger，变更记录同日），旋转行现在是几何段的末行。 */

  /** 旋转 ＋ 两枚翻转（一张卡装旋转，两枚方钮各装一个翻转）。
      角度是**可输入的**：敲的时候不夹，失焦或回车才解析并归一到 −180..180
      （与 `ValueRow` / `TimeField` 同一条）。 */
  function RotateRow({v, set}) {
    const [draft, setDraft] = useState(null);
    const commit = () => {
      if (draft === null) return;
      const n = parseFloat(String(draft).replace('°', ''));
      setDraft(null);
      if (!isFinite(n)) return;
      set({rot: Math.min(180, Math.max(-180, Math.round(n)))});
    };
    return (
      <div className="vrow">
        <div className="vbox grow">
          <Ic n="rotate" className="ic--16" style={{color: 'var(--gray-600)'}} />
          <span className="grow">旋转</span>
          <div style={{width: 64, flex: 'none'}}>
            <Field size="s" className="t-mono" value={draft === null ? v.rot + '°' : draft}
              onChange={(e) => setDraft(e.target.value)} onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { commit(); e.target.blur(); }
                if (e.key === 'Escape') { setDraft(null); e.target.blur(); }
              }} />
          </div>
        </div>
        <span className="vbox vbox--sq">
          <IconBtn icon="fliph" size="s" tip="水平翻转" on={v.flipX}
            onClick={() => set({flipX: !v.flipX})} />
        </span>
        <span className="vbox vbox--sq">
          <IconBtn icon="flipv" size="s" tip="垂直翻转" on={v.flipY}
            onClick={() => set({flipY: !v.flipY})} />
        </span>
      </div>
    );
  }

  /** 时长：分节头右侧是**这个元素的时长**，不是整条视频的总长
      ——总长在这里没有决策价值，要看的是这一块出现多久。起止收成一行方框，
      与 Text 面板的时间段同一件。 */
  function TimeSection({v, set, ctx, counter}) {
    return (
      <>
        <SecHead aside={T.timecode(Math.max(0, v.tEnd - v.tStart))}>时长</SecHead>
        <div className="txtime">
          <Ic n="clock" className="ic--16" style={{color: 'var(--gray-600)'}} />
          <span className="txtime__l">开始</span>
          <TimeField value={v.tStart} playT={ctx.playT} onChange={(x) => set({tStart: x})} />
          <i className="txtime__sep" />
          <span className="txtime__l">结束</span>
          <TimeField value={v.tEnd} playT={ctx.playT} onChange={(x) => set({tEnd: x})} />
        </div>
        <div className="hint">
          这两个值与时间轴上那条是同一份：这里改，时间轴上那条跟着走，反过来也一样。
          {counter ? ' 计时没有单独的「总长」控件——这一段的时长就是它数多久。' : ''}
        </div>
      </>
    );
  }

  /* ---------- 属性页容器 ---------- */
  function ElementEdit({kind, seed, ctx, onBack, onDelete}) {
    const spec = D.elementSpecs[kind];
    /* 这一页认的是**选中的那一件**（第 122 轮 WP-E）。此前这里按类型取
       `D.elements` 里那条演示装置——于是新建出来的第二个形状一打开属性页，起止、
       动画、删除全落在第一条演示元素身上（原登记在分歧台账 #60 那一族）。
       投影 `ctx.elements` 里那条才是合并过 elDocs 的真身；选中还没落下来（刚点目录
       那一帧）时回落到同类的演示装置，页面不至于空一帧。 */
    const selId = ctx.sel && ctx.sel.kind === 'element' ? ctx.sel.id : null;
    const el = (selId && (ctx.elements || []).filter((e) => e.id === selId)[0])
      || D.elements.filter((e) => e.kind === kind)[0] || D.elements[0];
    const [pop, setPop] = useState(null);
    /* 页内路由（第 83 轮）：`null` = 属性页那条滚动，`'anim'` = 动画子页，
       `'catalog'` = 声波 / 进度的样式目录。
       此前动画是三个子 Tab 之一，样式目录是一个布尔。 */
    const [own, setOwn] = useState(null);
    /* 条子上的「动画 / 调整」开的是 `ctx.paneView`（它得跨面板传话），这一页自己的
       两层用 local state。第 84 轮把两者合成一个读法——此前从条子点「在面板里编辑」
       只把这一栏翻出来，停在属性页上，动画那一层根本没开。 */
    const view = ctx.paneView === 'anims' ? 'anim'
      : ctx.paneView === 'adjust' ? 'adjust' : own;
    const setView = (v) => { if (ctx.paneView) ctx.setPaneView(null); setOwn(v); };
    /* 动画与样式那几项与画布浮动工具条是**同一份**（键名对照 BC_EL.SHARED）：在画布上
       把入场改成滑入，这一页就该显示滑入，反过来也一样。第 122 轮 WP-E 起那一份是
       **这一件自己的** `elDocs[id].style`（`elStyleOf` 把类缺省 `elStyle` 垫在下面），
       不再是整类共用的袋子——两个形状因此能各是各的填充色。 */
    const anim = (ctx.elDocs[el.id] || {}).anim || {in: {k: 'none'}, out: {k: 'none'}, loop: {k: 'none'}};
    const setAnim = (a) => ctx.setElDoc(el.id, {anim: a});
    const [v, setV] = useState(() => {
      const base = {rot: 0, flipX: false, flipY: false,
                    // 计时：目录里点的是哪一格就落哪一种模式；钟面与字符样式的初值
                    // 只是兜底，每次渲染都会被 `E.fromStage` 从这一件自己的样式里盖掉
                    mode: (seed && seed.k) || E.COUNTERS[0].k, format: E.COUNT_FORMATS[0].k,
                    font: 'Inter', bold: true, italic: false, color: '#FFFFFF', size: 96,
                    variant: 0, endBehavior: 0, start: 0, end: 100,
                    tStart: el.start, tEnd: el.end == null ? D.DUR : el.end, endAnchor: el.end == null,
                    shapeI: seed && seed.i != null ? seed.i : 0,
                    style: spec.catalog === 'wave' ? E.WAVES[0].k : spec.catalog === 'progress' ? E.PROGRESS[0].k : null,
                    main: E.PALETTE.blue.fill, second: E.PALETTE.white.fill};
      (spec.sliders || []).forEach((s) => { base[s.k] = s.v; });
      (spec.colors || []).forEach((c) => { base[c.k] = c.v; base[c.k + 'A'] = 100; });
      if (spec.shape && seed && seed.shape) {
        base.fill = seed.shape.fill; base.outline = seed.shape.outline;
        base.corner = seed.shape.r ? 10 : 0;
      }
      if (spec.catalog) {
        /* 目录里点的是**哪一格**就落哪一格（第 60 轮）：此前一律落回表里的第一款，
           于是点「涟漪」开出来的是「三重波」——那不是编辑，是重选。
           默认主副色来自核心配方（`defaultMainColor` / `defaultSecondaryColor`），
           第 60 轮起是 hex 面值本身，不再经调色板查一次名。 */
        const list = spec.catalog === 'wave' ? E.WAVES : E.PROGRESS;
        const cur = (seed && list.filter((x) => x.k === seed.k)[0]) || list[0];
        base.style = cur.k;
        base.main = cur.main;
        base.second = cur.second;
        // dB 窗同样按款取（`sliders[].v` 那两个 −80 / 40 只是查不到款时的兜底）
        if (cur.minDb != null) { base.mindb = cur.minDb; base.maxdb = cur.maxDb; }
      }
      return base;
    });
    // 样式那几项**每次渲染都从 `elStyleOf(id)` 现取**，不缓存进 v——
    // 缓存了就只有挂载那一刻同步，画布上改完这一页还停在旧值
    // 起止也是共用的：时间轴上那条与这一页是同一份（`ctx.elDocs`）
    const span = ctx.elDocs[el.id] || {start: v.tStart, end: v.tEnd};
    /* 旋转同理，而且更硬：第 40 轮起画布上的旋转钮直接改 `ctx.elDocs[el.id].pose`，
       这一页要是还留着自己那份 local state，就是把元素转过 30°、这里还写着 0°。
       位置与宽高第 83 轮起曾不在这一页上；几何段回来之后它们与画布把手写**同一份 pose**
       （`ElementGeometry` 直接走 `ctx.setElPose`，不经这里的 `set`）。 */
    const pose = Object.assign({rot: 0, flipX: false, flipY: false}, span.pose);
    const st = ctx.elStyleOf ? ctx.elStyleOf(el.id) : ctx.elStyle;
    const vv = {...v, ...E.fromStage(kind, st), anim, tStart: span.start, tEnd: span.end,
      rot: pose.rot, flipX: !!pose.flipX, flipY: !!pose.flipY};
    /* 一个写口子，三条去处：样式落**这一件自己**的样式文档（第 122 轮 WP-E，此前落
       整类共用袋）、起止落 `elDocs`、旋转与翻转落 `pose`。翻转此前只写 local `v`，
       画面上纹丝不动——`stage-elements.jsx` 读的是 `pose.flipX/flipY`（与条子上
       `···` 菜单的那两项、图片 / 视频属性页同一份）。 */
    const set = (patch) => {
      const shared = E.toStage(kind, patch);
      if (Object.keys(shared).length) ctx.setElStyle(shared, el.id);
      if (patch.tStart != null) ctx.setElDoc(el.id, {start: patch.tStart});
      if (patch.tEnd != null) ctx.setElDoc(el.id, {end: patch.tEnd});
      const pp = {};
      ['rot', 'flipX', 'flipY'].forEach((k) => { if (patch[k] != null) pp[k] = patch[k]; });
      if (Object.keys(pp).length) ctx.setElPose(el.id, pp);
      setV((prev) => ({...prev, ...patch}));
    };

    /* 位图 / 动图贴纸（第 84 轮）：**没有颜色控件**——
       「着色」是把矢量压成单色剪影再上色，一张动图上无从谈起——换成与视频同一段
       「画面」（不透明度 / 圆角 / 调整）。判据与画布条子同源。 */
    const media = kind === 'sticker' && window.isMediaSticker(ctx, el);
    /* 几何段：overlay 没有摆位；彩纸 / 白板不能转，末行不放旋转 */
    const caps = window.BC_POSE.caps(kind);
    const geomPose = Object.assign({x: 50, y: 50, w: 30, scale: 1}, span.pose);
    const geometry = kind === 'overlay' ? null : (
      <window.ElementGeometry ctx={ctx} id={el.id} kind={kind} pose={geomPose}
        disabled={window.geometryReadOnly(ctx)}>
        {caps.rot ? <RotateRow v={vv} set={set} /> : null}
      </window.ElementGeometry>
    );
    const spec2 = media ? Object.assign({}, spec, {colors: null, fills: false,
      hint: '导入的位图与 GIF 没有可换的填充色；SVG 与 Lottie 支持分色编辑。'}) : spec;

    if (spec.template) return <window.TemplateEdit ctx={ctx} onBack={onBack} onDelete={onDelete} />;
    if (view === 'adjust') {
      return <window.StickerAdjust v={vv} set={set} src={window.stickerSrc(ctx, el)}
        backLabel={spec.title} onBack={() => setView(null)} />;
    }
    if (view === 'catalog') {
      return (
        <CatalogView ctx={ctx} kind={spec.catalog} value={v.style} onBack={() => setView(null)}
          peekPatch={(it) => E.toStage(kind, {style: it.k, main: it.main, second: it.second})}
          onPick={(it) => set(Object.assign({style: it.k, main: it.main, second: it.second},
            /* dB 窗与主副色同理：**跟着款走**（核心 `defaultMinDb` / `defaultMaxDb`）。
               10 款里示波器 / 环形波这 2 款是 −120 / −10 那扇窄而热的窗，
               换款不带上它，Control 那两格就停在上一款的窗上。 */
            it.minDb == null ? {} : {mindb: it.minDb, maxdb: it.maxDb}))} />
      );
    }
    /* 动画子页（`‹ 动画` 一整页，不是属性页上的一个 Tab）。
       返回**回到这张属性页**，不是回元素目录——它是页内的一层。 */
    if (view === 'anim') {
      return (
        <>
          <div className="panelhd">
            <IconBtn icon="back" size="s" tip="返回" onClick={() => setView(null)} />
            <span className="t-title-sm grow">动画</span>
          </div>
          <div className="pscroll bc-scroll">
            <AnimSection pick={anim} setPick={setAnim} ctx={ctx} peekId={el.id} />
          </div>
        </>
      );
    }

    /* 彩纸（第 231 轮）：整页是它自己的六段（款式 / 颜色 / 形状 / 粒子运动 / 发射 /
       随机），动画钮、时长、删除三件与本页同一颗——`panel-element-confetti.jsx`。 */
    if (spec.confetti) {
      return <window.ConfettiEdit ctx={ctx} el={el} v={vv} set={set} anim={anim} spec={spec}
        onOpenAnim={() => setView('anim')} onBack={onBack} onDelete={onDelete}
        geometry={geometry} time={<TimeSection v={vv} set={set} ctx={ctx} />} />;
    }
    /* 白板手绘：示范 / 手 / 纸 / 画时 / 节拍五段——`panel-element-whiteboard.jsx`。 */
    if (spec.whiteboard) {
      return <window.WhiteboardEdit ctx={ctx} el={el} v={vv} set={set} anim={anim} spec={spec}
        onOpenAnim={() => setView('anim')} onBack={onBack} onDelete={onDelete}
        geometry={geometry} time={<TimeSection v={vv} set={set} ctx={ctx} />} />;
    }

    return (
      <>
        {/* 页头：一枚返回箭头 ＋ 左对齐标题，**没有那枚垃圾桶**
            ——删除是页脚那颗整宽红钮，一个动作一个入口。 */}
        <div className="panelhd">
          <IconBtn icon="back" size="s" tip="返回元素目录" onClick={onBack} />
          <span className="t-title-sm grow">{spec.title}</span>
        </div>
        {/* 段序（第 122 轮 WP-E 定下）：
              动画 → 颜色 → 几何（末行旋转）→ 时长 → 删除。
            其余各段（计时 / 文字 / 形状 / 样式目录 / 滑杆 / 区间 /
            说话人 / 占位留言，以及动图贴纸的「画面」）排在这四段**之后**、
            红色删除钮之前——删除恒是页脚最后一件，一个动作一个入口。 */}
        <div className="pscroll bc-scroll">
          <AnimButton anim={anim} onOpen={() => setView('anim')} />
          <window.ColorSection v={vv} set={set} spec={spec2} el={el} pop={pop} setPop={setPop} ctx={ctx} />
          {geometry}
          <TimeSection v={vv} set={set} ctx={ctx} counter={!!spec.counter} />
          <window.StyleSection v={vv} set={set} spec={spec2} pop={pop} setPop={setPop}
            onCatalog={() => setView('catalog')} ctx={ctx} />
          {media ? <window.MediaSection v={vv} set={set} onAdjust={() => setView('adjust')} /> : null}
          <BCAction className="danger" onClick={onDelete}><Ic n="trash" className="ic--16" />{spec.del}</BCAction>
        </div>
      </>
    );
  }

  Object.assign(window, {ElementEdit, CatalogView, RotateRow});
})();
