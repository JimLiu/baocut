/* Elements 面板 · 各分区的网格与二级 chip（第 122 轮从 panel-elements.jsx 拆出来）。

   拆的理由是行数：目录页重排之后，浏览页多了 CTA 弹窗一段、可视化
   子页多了「全部」下的两小段，一个文件装不下（局部协议的 ~600 行上限）。这一文件里
   只有**画**：分节次序、chip 表、网格次序与新建都在 `model-elpanel.js`。 */
(function () {
  const {useState, useMemo} = React;
  const E = window.BC_EL;
  const SK = window.BC_SK;
  const P = window.BC_ELPANEL;

  /* ---------- 贴纸 ---------- */

  /** 子页里钉在滚动区外面的那一行包名 chip。**渲染在 .pscroll 外面**
      ——浮层在滚动容器里会被裁掉（§20.2 的教训），而且钉住之后翻网格时包名一直在
      眼前。摆出来的是前四格，其余 28 个包（＋「内置」）进「⋯」。 */
  function StickerPackChips({pack, setPack}) {
    const [more, setMore] = useState(false);
    const chips = P.stickerChips(SK.PACKS);
    const rest = P.stickerRest(SK.PACKS);
    const restOn = rest.some((p) => p.k === pack);
    const restLabel = restOn ? (rest.filter((p) => p.k === pack)[0] || {}).label : '⋯';
    return (
      <div className="chiprow chiprow--packs">
        {chips.map((c) => (
          <Chip key={c.k} pill on={pack === c.k} onClick={() => setPack(c.k)}>{c.label}</Chip>
        ))}
        <div className="chipmore">
          <Chip pill on={more || restOn} onClick={() => setMore((v) => !v)}>{restLabel}</Chip>
          <Popover open={more} onClose={() => setMore(false)} width={220} align="right" className="pop--tall">
            <Menu>
              <MenuHead>目录共 {SK.PACKS.length} 个包</MenuHead>
              {rest.map((p) => (
                <MenuItem key={p.k} on={pack === p.k} label={p.label}
                  onClick={() => { setMore(false); setPack(p.k); }}
                  suffix={p.files.length ? String(p.files.length) : '—'} />
              ))}
            </Menu>
          </Popover>
        </div>
      </div>
    );
  }

  /** 一个包的网格 ＋ 包头（已收张数与目录总数分开写）。
      一张不收的包（品牌标识）给空态说明，不留一段只有标题的空白。 */
  function PackGrid({pack, onAdd, head}) {
    const list = useMemo(() => SK.list(pack), [pack]);
    return (
      <>
        {head === false ? null : (
          <div className="packhead">
            <b>{pack.label}</b>
            <span className="t-detail-xs">
              {pack.files.length + ' 个素材'}
            </span>
          </div>
        )}
        {list.length ? (
          <div className="stgrid">
            {list.map((s) => (
              <window.StickerTile key={s.id} src={s.src} alt={s.alt}
                onAdd={() => onAdd('sticker', s)} />
            ))}
          </div>
        ) : (
          <Empty icon="image" title="使用自己的品牌素材">{pack.note || '从素材面板导入你的品牌图形'}</Empty>
        )}
      </>
    );
  }

  /** 「我的贴纸」（第 238 轮）：品牌库上传的那一份，贴纸与动态贴纸两个子页共用。
      空态是**路牌**不是空白：这一格永远在（`P.BRAND_CAT` 恒排在最前），点进来
      什么都没有时得告诉用户东西从哪来，而不是让人以为目录坏了。

      第 239 轮两处改动：这一节从两个子页的**末尾**提到**开头**（用户自己的东西
      先于随包目录），格子按**最近用过**倒序摆（`BC_BRAND_STICKERS.mru`）——随包
      目录有定好的分类序可依，用户这几件没有，最近用过就是最好的次序。 */
  function BrandStickerGrid({ctx, anim, onAdd}) {
    // 两个子页**互补**（第 240 轮）：Lottie 与 GIF 只进动态贴纸，SVG 与图片只进
    // 贴纸。原先静态那一页是「全摆」，同一份 Lottie 因此两页各出现一次——静态页
    // 里它还只画一帧静止姿势，用户根本认不出是同一件。判据是
    // `BC_STSRC.isDynamicPage`（只看 kind，不读源码），三表面同一张表。
    const B = window.BC_BRAND_STICKERS;
    const list = B.mru((ctx.brandStickers || []).filter((m) => window.BC_STSRC.isDynamicPage(m) === anim));
    const goBrand = () => { ctx.setTab('brand'); ctx.setPaneHidden(false); };
    // 落到时间轴的同时记一次「用过」，下次进来它就在第一格
    const add = (m) => {
      if (ctx.touchBrandSticker) ctx.touchBrandSticker(m.id);
      // `pet` 元数据袋（版本 / 状态 / 署名）跟着 Codex Pet 一起上画布
      onAdd('sticker', {id: m.id, src: m.src, kind: m.kind, alt: m.name, pet: m.pet});
    };
    return (
      <>
        <div className="packhead">
          <b>{P.BRAND_CAT.label}</b>
          <span className="t-detail-xs">{list.length ? list.length + ' 份' : '来自品牌库'}</span>
          <BCAction className="viewall" onClick={goBrand}>去品牌库上传<NavChevron /></BCAction>
        </div>
        {list.length ? (
          <div className={cx('stgrid', anim && 'stgrid--anim')}>
            {list.map((m) => (
              <window.StickerTile key={m.id} src={m.src} kind={m.kind} alt={m.name} pet={m.pet}
                onAdd={() => add(m)} />
            ))}
          </div>
        ) : (
          <Empty icon="image" title={anim ? '还没有你自己的动态贴纸' : '还没有你自己的贴纸'}>
            {anim ? '品牌库收 Lottie（.json）、GIF 与 Codex Pet（.zip）；SVG 与图片归「贴纸」那一页。'
              : '品牌库收 SVG 与图片；Lottie（.json）与 GIF 归「动态贴纸」那一页。'}
          </Empty>
        )}
        <div className="signpost">贴纸存在品牌库里，跨视频可用；Lottie 与 SVG 一样能分色改。</div>
      </>
    );
  }

  /** 目录页那一屏只摆四张第三方素材。 */
  function StickerPeek({onAdd}) {
    const rest = SK.head(P.TILES, 1);
    return (
      <div className="stgrid">
        {rest.map((s) => (
          <window.StickerTile key={s.id} src={s.src} alt={s.alt} onAdd={() => onAdd('sticker', s)} />
        ))}
      </div>
    );
  }

  /** 贴纸子页：按 chip 落在哪一格摆全部或某一个第三方包 */
  function StickerSection({ctx, pack, q, onAdd}) {
    const packs = useMemo(() => SK.search(q), [q]);
    if (pack === 'brand') return <BrandStickerGrid ctx={ctx} onAdd={onAdd} />;
    if (pack !== 'all') {
      return <PackGrid pack={SK.find(pack)} onAdd={onAdd} />;
    }
    if (!packs.length) {
      return <Empty icon="search" title="没有匹配的贴纸">换个词，或者清空搜索看全部包</Empty>;
    }
    return (
      <>
        <BrandStickerGrid ctx={ctx} onAdd={onAdd} />
        {packs.map((p) => <PackGrid key={p.k} pack={p} onAdd={onAdd} />)}
      </>
    );
  }

  /* ---------- 动态贴纸 ---------- */

  /** 彩纸十格（第 231 轮）：不是动图包，是 `kind: "confetti"` 的算法元素——点一格建
      一条铺满画布的彩纸，款式落 `style.confetti`，种子在 `newElement` 里随机写入。 */
  function ConfettiGrid({onAdd}) {
    const C = window.BC_CONFETTI;
    return (
      <div className="stgrid stgrid--anim">
        {C.STYLES.map((s) => (
          <window.ConfettiTile key={s.k} style={s} onAdd={() => onAdd('confetti', {k: s.k, name: s.name})} />
        ))}
      </div>
    );
  }

  /* ---------- 白板手绘 ---------- */

  /** 三份内置示范一排（目录页与子页同一屏——就三格，没有「查看全部」可钻）。核心里
      这一格对应「选一张图」；原型没有位图分析，示范笔画代替那张图。 */
  function WhiteboardGrid({onAdd}) {
    const W = window.BC_WHITEBOARD;
    return (
      <>
        <div className="stgrid stgrid--anim">
          {W.DEMOS.map((d) => (
            <window.WhiteboardTile key={d.k} demo={d} onAdd={() => onAdd('whiteboard', {k: d.k, name: d.name})} />
          ))}
        </div>
        <div className="hint hint--tight">铺满画布的一张纸，按笔顺逐段揭示、手跟着笔尖走；在 App 里这一格是选一张图。</div>
      </>
    );
  }

  /** 目录页那一屏（四格，各分类轮流取一张；第 231 轮起第一格是彩纸） */
  function AnimPackPeek({onAdd}) {
    const list = useMemo(() => P.animOrder(SK.ANIM), []);
    const C = window.BC_CONFETTI;
    return (
      <div className="stgrid">
        <window.ConfettiTile style={C.STYLES[0]} onAdd={() => onAdd('confetti', {k: C.STYLES[0].k, name: C.STYLES[0].name})} />
        {SK.head(P.TILES - 1, 1, list).map((s) => (
          <window.StickerTile key={s.id} src={s.src} alt={s.alt} onAdd={() => onAdd('sticker', s)} />
        ))}
      </div>
    );
  }

  /** 动态贴纸子页：12 个动图分类 ＋ 彩纸（第 231 轮，算法元素，
      插在 collage 与 emoji 之间），动图磁贴就是那张动图本身（带透明通道，
      落画布也是它）。第 242 轮加 Codex Pet：chip 紧跟「我的贴纸」，子页在
      [pet-sticker.jsx](pet-sticker.jsx)；「全部」里只露官方前六只。`onMore` 切 chip。 */
  function AnimPackSection({ctx, cat, q, onAdd, onMore}) {
    const list = useMemo(() => P.animOrder(SK.searchAnim(q)), [q]);
    if (cat === 'brand') return <BrandStickerGrid ctx={ctx} anim onAdd={onAdd} />;
    if (cat === 'pet') return <window.PetSection ctx={ctx} q={q} onAdd={onAdd} />;
    const cf = (cat === 'all' || cat === 'confetti') && P.confettiMatch(q);
    const shown = cat === 'all' ? list : list.filter((c) => c.k === cat);
    if (!shown.length && !cf) return <Empty icon="search" title="没有匹配的动态贴纸">换个词，或者清空搜索看全部分类</Empty>;
    // 用 `P.confettiAt` 而不是在 `animCats` 里找：`animCats` 从第 239 轮起会在最前
    // 顶一格「我的贴纸」，那一格不参与这里的下标（它在下面单独摆）。
    const cfAt = cf ? P.confettiAt(shown) : -1;
    const confetti = cf ? (
      <React.Fragment key="confetti">
        <div className="packhead">
          <b>彩纸</b>
          <span className="t-detail-xs">10 款算法粒子 · 时长任意</span>
        </div>
        <ConfettiGrid onAdd={onAdd} />
      </React.Fragment>
    ) : null;
    return (
      <>
        {cat === 'all' ? <BrandStickerGrid ctx={ctx} anim onAdd={onAdd} /> : null}
        {cat === 'all' && !q ? <window.PetPeek ctx={ctx} onAdd={onAdd} onMore={onMore} /> : null}
        {shown.map((c, i) => (
          <React.Fragment key={c.k}>
            {cfAt === i ? confetti : null}
            <div className="packhead">
              <b>{c.label}</b>
              <span className="t-detail-xs">已收 {c.files.length} / 目录共 {c.total}</span>
            </div>
            <div className="stgrid stgrid--anim">
              {SK.list(c).map((s) => (
                <window.StickerTile key={s.id} src={s.src} alt={s.alt} onAdd={() => onAdd('sticker', s)} />
              ))}
            </div>
          </React.Fragment>
        ))}
        {cfAt >= shown.length ? confetti : null}
        <div className="hint">
          五个内置分类是 Google Noto Animated Emoji 的 Lottie（CC BY 4.0），矢量循环、
          带透明通道，落到画布上跟着播放头走，也能像静态贴纸一样分色改。磁贴停在静止帧，
          鼠标移上去才播。彩纸不是动图：十款配方逐帧算出来，时长随时间轴那条走。
          Codex Pet 是 8 列雪碧图（官方 9 只随包，社区 239 只按类浏览），逐格步进也跟播放头。
        </div>
      </>
    );
  }

  /* ---------- 可视化 ---------- */

  /** 三族共用：这一格点下去建的是哪一类元素 */
  const vizKind = (it) => (it.fam === 'prog' ? 'progress' : it.fam === 'wave' ? 'wave' : 'counter');
  const VizGrid = ({list, cls, onAdd}) => (
    <div className={cls}>
      {list.map((it) => (
        <window.VizTile key={it.fam + it.k} it={it} onAdd={() => onAdd(vizKind(it), it)} />
      ))}
    </div>
  );

  /** 目录页那一屏：手挑的四格（两款进度 ＋ 一款声波 ＋ 一款计时），
      摆在与其它段同一张四列网格里——所以进度那两款在这里不横跨两列。 */
  function VizPeek({onAdd}) {
    const four = useMemo(() => P.vizPicks(E.PROG_TILES, E.WAVES, E.COUNTERS), []);
    return <VizGrid list={four} cls="tgrid tgrid--four" onAdd={onAdd} />;
  }

  /** 可视化子页。

      「全部」下是**两小段**（进度条 / 声波），各摆前四格、各带自己的「查看全部」把
      chip 切过去——不是一张混起来的大网格。切到「进度」摆整表 16 格
      （计时那两格夹在 `snake` 与 `snake_spin` 之间），切到「声波」摆 10 款。

      计时落成的是一条文字元素（读数随播放头逐秒派生，ADR-CT01），它排进进度网格
      是为了让找它的人在进度旁边找到——位次跟着进度，语义仍是文字。 */
  function VizSection({viz, onAdd, onMore}) {
    const prog = useMemo(() => P.progOrder(E.PROG_TILES, E.COUNTERS), []);
    if (viz === 'pr') return <VizGrid list={prog} cls="tgrid tgrid--prog" onAdd={onAdd} />;
    if (viz === 'sw') return <VizGrid list={E.WAVES} cls="tgrid tgrid--wave" onAdd={onAdd} />;
    const viewAll = (k) => (
      <BCAction className="viewall" onClick={() => onMore(k)}>查看全部<NavChevron /></BCAction>
    );
    return (
      <>
        <div className="packhead"><b>进度条</b>{viewAll('pr')}</div>
        <VizGrid list={prog.slice(0, P.TILES)} cls="tgrid tgrid--prog" onAdd={onAdd} />
        <div className="packhead"><b>声波</b>{viewAll('sw')}</div>
        <VizGrid list={E.WAVES.slice(0, P.TILES)} cls="tgrid tgrid--wave" onAdd={onAdd} />
      </>
    );
  }

  Object.assign(window, {StickerPackChips, PackGrid, StickerPeek, StickerSection, BrandStickerGrid,
    AnimPackPeek, AnimPackSection, ConfettiGrid, WhiteboardGrid, VizPeek, VizSection, vizKind});
})();
