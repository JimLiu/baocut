/* Elements 面板 · 浏览（§14；第 122 轮整表重排）。
   结构、chip 表、网格次序与新建都在 `model-elpanel.js`，各分区的网格在
   `panel-elements-sections.jsx`；这一文件只剩目录页 / 子页这两页的骨架与容器。

   ## 目录页自上而下

   贴纸 → 动态贴纸 → 形状 → 可视化，每段一屏四格 ＋ 一个「查看全部 ›」；
   顶层 chip 恰好四格（全部 / 贴纸 / 形状 / 可视化）。另有一段——
   模板——接在这五段后面，**不占顶层 chip**：那一行定死四格，
   模板自己的「查看全部」照样钻得进去。模板的组像贴纸包一样
   用二级 chip 切（2026-09-14；同一天挂在后面的四格取景框 / 覆盖层退场）。

   ## 目录内容的取舍

   1. **贴纸多一个「内置」包**：核心 `sticker/*.json` 那十款矢量贴纸是 App v2 的
      Stickers 组真正摆出来的东西。它不占顶层那四格 chip 的位置，排在「⋯」最前面，
      目录页那一屏留给它第一格。
   2. **动态贴纸只保留 5 个第三方分类＋彩纸**：满屏平台标识、BaoCut 自绘 SVG 与
      没有固定来源的包都不进入目录；Confetti 仍是算法粒子元素。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const E = window.BC_EL;
  const T = window.BC_TIME;
  const SK = window.BC_SK;
  const P = window.BC_ELPANEL;

  /** 目录页分节头底下那一行二级分类：**不进这一段也看得见它分成
      哪几类，点一格直接钻进去**。这一行长在 `.pscroll` 里面，所以「⋯」是一次跳转、
      不是弹层——浮层会被滚动容器裁掉（§20.2 那条教训）。钉在滚动区外面的那一行
      （子页里）才带弹层。 */
  function SubChips({items, more, onPick}) {
    return (
      <div className="chiprow chiprow--sub">
        {items.map((c) => (
          <Chip key={c.k} pill on={c.k === 'all'} onClick={() => onPick(c.k)}>{c.label}</Chip>
        ))}
        {more ? <Chip pill onClick={() => onPick('all')}>⋯</Chip> : null}
      </div>
    );
  }

  /* ---------- 浏览 ---------- */

  /** 模板目录里的一行（内置或品牌库）：真渲染缩略图 ＋ 名字 ＋ chip ＋ 摘要，行尾「套用 / 已套用」。 */
  function TplRow({t, ctx}) {
    const TPL = window.BC_TPL;
    const on = ctx.tplDoc && ctx.tplDoc.from === t.id;
    return (
      <BCAction className={cx('tplrow', on && 'is-on')} onClick={() => ctx.applyTemplate(t)}>
        <span className="tplth tplth--tpl"><window.TemplateThumb tpl={t} ctx={ctx} /></span>
        <span className="tl2">
          <b>{t.name}{TPL.isWatermark(t) && t.brand ? <Chip>水印</Chip> : null}{t.brand ? <Chip>{t.imported === 'watermark' ? '由水印导入' : '品牌库'}</Chip> : null}{TPL.ratioLocked(t) ? <Chip icon="lock">{TPL.ratioLabel(TPL.ratioTarget(t))}</Chip> : null}</b>
          <span>{TPL.summary(t)}{t.canvas === '9:16' ? ' · 竖屏' : ''}{TPL.ratioNote(t) ? ' · ' + TPL.ratioNote(t) : ''}</span>
        </span>
        <span className={cx('t-detail-xs elopen', on ? 't-secondary' : 't-accent')}>
          {on ? '已套用' : '套用'}
        </span>
      </BCAction>
    );
  }

  function Browse({ctx, tab, setTab, viz, setViz, pack, setPack, acat, setACat, tgrp, setTGrp, onAdd}) {
    const app = useApp();
    /* 模板目录（内置 ＋ 品牌库）按组算一次：子页的 chip 行、目录页的二级 chip 与列表都从它取。 */
    const tplGroups = window.BC_TPL.groupTemplates(window.BC_TPL.builtins(app.tplLang).concat(ctx.brandTpls || []), app.tplLang);
    const tplAll = tplGroups.reduce((a, g) => a.concat(g.items), []);
    const [q, setQ] = useState('');
    const [search, setSearch] = useState(false);
    /* 目录页（全部）与子页（钻进某一段）是**两页**，不是一页的两种筛选态：
       子页照元素属性页那条推入式导航来——页头换成「返回 ＋ 这一段的名字」，
       顶层 chip 行整行退场。 */
    const root = tab === 'all';
    const cur = root ? null : P.sectionOf(tab);
    const secs = root ? P.sections('all') : (cur ? [cur] : []);
    /* 返回目录时把二级筛选清回「全部」：不清的话下次进来 chip 停在上次那一格，而
       目录页的样本是各包轮流取的，头顶那行「全部」高亮就成了假话。 */
    const back = () => { setTab('all'); setPack('all'); setACat('all'); setViz('all'); setTGrp('all'); };
    /* 点「查看全部」或一格二级分类 = 带着这一格钻进那一段，不是就地筛。 */
    const open = (sec, k) => {
      if (!sec.tab) return;
      if (sec.k === 'st') setPack(k || 'all');
      else if (sec.k === 'viz') setViz(k || 'all');
      else if (sec.k === 'fr') setTGrp(k || 'all');
      else if (sec.pack) setPack(sec.pack);
      setTab(sec.tab);
    };
    const searchBtn = (
      <IconBtn icon="search" size="s" tip="搜索元素" on={search}
        onClick={() => { setSearch((v) => !v); if (search) setQ(''); }} />
    );

    return (
      <>
        {root ? <PanelHead title="元素">{searchBtn}</PanelHead> : (
          <div className="panelhd">
            <IconBtn icon="back" size="s" tip="返回元素目录" onClick={back} />
            <span className="t-title-sm grow">{cur.title}</span>
            {/* 分节头退场了，那一段的说明跟着搬到页头右边——不搬就只剩一个孤零零的
                标题，「23 格 · 五色循环」这类数量说明会整条丢掉。 */}
            {cur.note ? <span className="t-detail-xs elhd-note">{cur.note}</span> : null}
            {searchBtn}
          </div>
        )}
        {search ? (
          <div className="elsearch">
            <Field icon="search" placeholder="搜索贴纸包、形状、可视化" value={q} autoFocus
              onChange={(e) => setQ(e.target.value)} />
          </div>
        ) : null}
        {root ? (
          <div className="chiprow eltabs">
            {P.TABS.map((c) => (
              <Chip key={c.k} pill onClick={() => (c.k === 'all' ? back() : setTab(c.k))} on={tab === c.k}>
                {c.label}
              </Chip>
            ))}
          </div>
        ) : null}
        {tab === 'st' ? <div className="packbar"><window.StickerPackChips pack={pack} setPack={setPack} /></div> : null}
        {tab === 'gif' ? (
          <div className="packbar">
            <div className="chiprow chiprow--packs">
              <Chip pill on={acat === 'all'} onClick={() => setACat('all')}>全部</Chip>
              {P.animCats(SK.ANIM).map((c) => (
                <Chip key={c.k} pill on={acat === c.k} onClick={() => setACat(c.k)}>{c.label}</Chip>
              ))}
            </div>
          </div>
        ) : null}
        {tab === 'viz' ? (
          <div className="packbar">
            <div className="chiprow chiprow--packs">
              {P.VIZ_CATS.map((c) => (
                <Chip key={c.k} pill on={viz === c.k} onClick={() => setViz(c.k)}>{c.label}</Chip>
              ))}
            </div>
          </div>
        ) : null}
        {/* 模板子页的组 chip（2026-09-14）：全部 ＋ 当前有模板的组，与上面两行同一条做法。 */}
        {tab === 'fr' ? (
          <div className="packbar">
            <div className="chiprow chiprow--packs">
              {P.tplChips(tplGroups).map((c) => (
                <Chip key={c.k} pill on={tgrp === c.k} onClick={() => setTGrp(c.k)}>{c.label}</Chip>
              ))}
            </div>
          </div>
        ) : null}
        <div className="pscroll bc-scroll">
          {secs.map((sec, si) => (
            <React.Fragment key={sec.k}>
              {/* 子页里不再重复这一段的名字：它已经在页头上了。 */}
              {root ? (
                <>
                  <SecHead first={si === 0} aside={sec.note}
                    action={sec.tab
                      ? <BCAction className="viewall" onClick={() => open(sec)}>
                          查看全部<NavChevron />
                        </BCAction>
                      : null}>
                    {/* 动态贴纸那一段的标题前有一枚小徽标（动图角标）
                        ——它是目录页唯一带徽标的一段。 */}
                    {sec.badge ? <span className="secbadge"><Ic n="anim" className="ic--14" /></span> : null}
                    {sec.title}
                  </SecHead>
                  {sec.subs === 'pack' ? (
                    <SubChips items={P.stickerChips(SK.PACKS)} more onPick={(k) => open(sec, k)} />
                  ) : null}
                  {sec.subs === 'viz' ? (
                    <SubChips items={P.VIZ_CATS} onPick={(k) => open(sec, k)} />
                  ) : null}
                  {sec.subs === 'tpl' ? (
                    <SubChips items={P.tplChips(tplGroups)} onPick={(k) => open(sec, k)} />
                  ) : null}
                </>
              ) : null}

              {sec.k === 'st'
                ? (root ? <window.StickerPeek onAdd={onAdd} />
                  : <window.StickerSection ctx={ctx} pack={pack} q={q} onAdd={onAdd} />)
                : null}

              {sec.k === 'gif'
                ? (root ? <window.AnimPackPeek onAdd={onAdd} />
                  : <window.AnimPackSection ctx={ctx} cat={acat} q={q} onAdd={onAdd} onMore={setACat} />)
                : null}

              {sec.k === 'sh' ? (
                <div className="stgrid stgrid--shape">
                  {(root ? E.SHAPES.slice(0, P.TILES) : E.SHAPES).map((s) => (
                    <window.ShapeTile key={'sh' + s.i} tile={s}
                      onAdd={() => onAdd('shape', {shape: s, i: s.i})} />
                  ))}
                </div>
              ) : null}

              {sec.k === 'viz'
                ? (root ? <window.VizPeek onAdd={onAdd} />
                  : <window.VizSection viz={viz} onAdd={onAdd} onMore={setViz} />)
                : null}

              {/* CTA 弹窗是被单独提出来摆一段的贴纸包：没有自己的顶层 chip，「查看全部」
                  钻的是贴纸子页并钉在这个包上。 */}
              {sec.k === 'cta' ? (
                <div className="stgrid">
                  {SK.list(SK.find('cta')).slice(0, P.TILES).map((s) => (
                    <window.StickerTile key={s.id} src={s.src} alt={s.alt}
                      onAdd={() => onAdd('sticker', s)} />
                  ))}
                </div>
              ) : null}

              {sec.k === 'wb' ? <window.WhiteboardGrid onAdd={onAdd} /> : null}

              {sec.k === 'fr' ? (
                <>
                  {/* 模板目录（第 112 轮；2026-09-14 十七款、跟随界面语言、按组切换）：内置 + 品牌库里存的；
                      缩略图是这份文档的真渲染。组由 `BC_TPL.groupTemplates` 定：章节与进度 / 信息条 / 竖屏 /
                      抖音 / 小红书 / YouTube / B 站 / 水印 / 品牌库，空组不出现；组名跟界面语言。
                      目录页只摆前四款（其余走「查看全部」或分节头下的组 chip）；子页「全部」按组分节，
                      选了某一组只列那一组、不再重复组头。水印是模板的一类（`tag: 'watermark'`），旧水印
                      导进来的品牌库模板标「由水印导入」。点一行 = 套用（拷一份进项目）；「自己做一个」
                      从空白进版面编辑器，排在最后。此前挂在这一段后面的四格取景框 / 覆盖层已退场。 */}
                  <div className="col gap8">
                    {root
                      ? tplAll.slice(0, P.TILES).map((t) => <TplRow key={t.id} t={t} ctx={ctx} />)
                      : tgrp === 'all'
                        ? tplGroups.map((g) => (
                          <React.Fragment key={g.key}>
                            <div className="tplgrp" role="heading" aria-level={4}>{g.label}<span className="tplgrp__n">{g.items.length}</span></div>
                            {g.items.map((t) => <TplRow key={t.id} t={t} ctx={ctx} />)}
                          </React.Fragment>
                        ))
                        : (tplGroups.filter((g) => g.key === tgrp)[0] || {items: []}).items.map((t) => <TplRow key={t.id} t={t} ctx={ctx} />)}
                    <BCAction className="tplrow" onClick={() => ctx.openTplStudio({source: 'new-project'})}>
                      <span className="tplth"><Ic n="plus" /></span>
                      <span className="tl2"><b>自己做一个</b><span>从空白开始：章节条、进度条、台标、文字随意搭</span></span>
                    </BCAction>
                  </div>
                </>
              ) : null}
            </React.Fragment>
          ))}
          <div className="hint">
            点一下 = 在播放头处新建一条元素并选中；连着建多件时摆位依次错开，落好后在画布上拖到想要的位置。
          </div>
        </div>
      </>
    );
  }

  /* ---------- 面板容器 ---------- */
  function ElementsPanel({ctx}) {
    const app = useApp();
    const [tab, setTab] = useState('all');
    const [viz, setViz] = useState('all');
    const [pack, setPack] = useState('all');
    const [acat, setACat] = useState('all');
    const [tgrp, setTGrp] = useState('all');
    const view = ctx.sel && ctx.sel.kind === 'element' ? ctx.sel.elKind : null;

    /* 点一格 = **在播放头处真新建一条元素**（第 122 轮）。此前这里只是把
       演示装置那一条重新选中再把样式落上去——时间轴上不会多一行，连点两格得到的
       还是同一条，那是重选不是新建（原登记在分歧台账 #60）。

       样式**只落一处**：这条元素自己的样式文档（`el.style`，由 `newElement` 写进
       `elDocs[id].style`）。第 122 轮 WP-A 时这里还要往画布共用袋里再落一份，因为那时
       只有文字 / 图片 / 视频三族逐元素读样式；WP-E 把每一类都改成读自己那份之后，
       第二份就成了副作用——它会把同类里**已经存在**的元素一起改掉。 */
    const add = (kind, it) => {
      const base = D.elements.filter((e) => e.kind === kind)[0] || null;
      const el = P.newElement(kind, it, {playT: ctx.playT, total: ctx.filmEnd, seq: ctx.nextSeq(), base: base});
      ctx.addElement(el);
      // `addElement` 自己会选中新建的这一条；再选一次是为了把这一格当 seed 传给属性页
      ctx.pick({kind: 'element', id: el.id, elKind: kind, seed: it || null});
      const spec = D.elementSpecs[kind];
      app.toast(`${spec ? spec.title : kind} · ${T.timecode(el.start)} → ${T.timecode(el.end)}`,
        'positive', {label: '撤销', undo: true, run: () => ctx.removeElement(el.id)});
    };
    /* 第 115 轮接真删除：此前这里只是取消选中，撤销也只是重新选一次。 */
    const del = () => {
      const s = ctx.sel;
      if (!s || s.kind !== 'element') return;
      ctx.removeElement(s.id);
      app.toast(`已删除${(D.elementSpecs[view] || {}).title || '元素'}`, 'positive',
        {label: '撤销', undo: true, run: () => ctx.history.undo()});
    };

    return (
      <div className="pview">
        {/* `key` 挂选中的 id（第 122 轮 WP-E）：属性页里那些**只在挂载时取一次初值**
            的项（起止、形状序号、目录那一格）要跟着换元素重来一遍，否则从一条形状
            切到另一条，页上还写着上一条的起止。 */}
        {view && D.elementSpecs[view]
          ? <window.ElementEdit key={ctx.sel.id} kind={view} seed={ctx.sel.seed} ctx={ctx}
              onBack={() => ctx.pick(null)} onDelete={del} />
          : <Browse ctx={ctx} tab={tab} setTab={setTab} viz={viz} setViz={setViz} pack={pack} setPack={setPack} tgrp={tgrp} setTGrp={setTGrp}
              acat={acat} setACat={setACat} onAdd={add} />}
      </div>
    );
  }


  /* ---------- 多选批量摘要（第 115 轮，规格 §1） ----------
     多选时右栏不再停在上一格属性页上——那一页只认 primary 那一条，改任何一项都只落在
     它身上，用户会以为改的是全部。这一页只做三件对全体成立的事：对齐、复制、删除。
     对齐按 pose 的中心点算（pose.x/y 就是中心百分比）：左对齐＝全体取最小中心 x。
     元素各自的实际宽度取决于类型与内容，原型里没有量它的口子，中心对齐是这一层能给的
     最诚实的近似，所以按钮文案写「中心」。 */
  function MultiSelectPanel({ctx}) {
    const app = useApp();
    const sels = ctx.sels || [];
    const els = sels.filter((s) => s.kind === 'element');
    const ids = els.map((s) => s.id);
    const first = els.length ? {id: els[0].id,
      kind: els[0].elKind || ((ctx.elements || []).find((e) => e.id === els[0].id) || {}).kind} : null;
    const align = (axis, mode) => {
      if (ids.length < 2) return;
      const vals = ids.map((id) => window.BC_POSE.poseOf(ctx.elDocs[id])[axis]);
      const to = mode === 'min' ? Math.min.apply(null, vals)
        : mode === 'max' ? Math.max.apply(null, vals)
        : vals.reduce((a, b) => a + b, 0) / vals.length;
      ctx.history.begin();
      ids.forEach((id) => ctx.setElPose(id, {[axis]: window.BC_POSE.round1(to)}));
      ctx.history.commit();
      app.toast(`已对齐 ${ids.length} 个元素`, 'positive',
        {label: '撤销', undo: true, run: () => ctx.history.undo()});
    };
    return (
      <div className="pview">
        <div className="panelhd">
          <IconBtn icon="back" size="s" tip="取消选中" onClick={() => ctx.clearSel()} />
          <span className="t-title-sm grow">已选 {sels.length} 个</span>
        </div>
        <div className="pscroll bc-scroll">
          {/* 几何段只读，显示第一件（几何面板设计稿 §10：多选不做批量数值编辑）；
              要改数就单选那一件，要整体挪就拖或用下面的对齐 */}
          {first && first.kind !== 'overlay' ? (
            <window.ElementGeometry ctx={ctx} id={first.id} kind={first.kind} disabled
              pose={Object.assign({x: 50, y: 50, w: 30, scale: 1}, (ctx.elDocs[first.id] || {}).pose)} />
          ) : null}
          <div className="col gap6">
            <span className="t-label">水平对齐中心</span>
            <div className="row gap6">
              <Btn size="s" className="grow" disabled={ids.length < 2} onClick={() => align('x', 'min')}>靠左</Btn>
              <Btn size="s" className="grow" disabled={ids.length < 2} onClick={() => align('x', 'mid')}>居中</Btn>
              <Btn size="s" className="grow" disabled={ids.length < 2} onClick={() => align('x', 'max')}>靠右</Btn>
            </div>
            <span className="t-label">垂直对齐中心</span>
            <div className="row gap6">
              <Btn size="s" className="grow" disabled={ids.length < 2} onClick={() => align('y', 'min')}>靠上</Btn>
              <Btn size="s" className="grow" disabled={ids.length < 2} onClick={() => align('y', 'mid')}>居中</Btn>
              <Btn size="s" className="grow" disabled={ids.length < 2} onClick={() => align('y', 'max')}>靠下</Btn>
            </div>
            <div className="row gap6">
              <Btn size="s" className="grow" onClick={() => ctx.clipboard.duplicate()}>复制一份</Btn>
              <Btn size="s" className="grow" onClick={() => ctx.clipboard.copy()}>拷贝</Btn>
            </div>
            <BCAction className="danger" onClick={() => ctx.clipboard.remove()}>
              <Ic n="trash" className="ic--16" />删除这 {sels.length} 个
            </BCAction>
            <p className="hint">多选只在元素与片段上成立；对齐、删除、复制都记一条撤销。</p>
          </div>
        </div>
      </div>
    );
  }

  Object.assign(window, {ElementsPanel, MultiSelectPanel});
})();
