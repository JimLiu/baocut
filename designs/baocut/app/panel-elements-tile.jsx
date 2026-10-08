/* 元素目录的磁贴与缩略图（§14.1；第 60 轮从 panel-elements.jsx 拆出来）。

   拆的理由是它有三个读者：浏览面板、属性页的样式抽屉、画布浮动工具条的样式菜单。
   缩略图各画各的话，同一款声波在这三处会长得不一样——而用户是靠缩略图认样式的。

   **三族可视化的缩略图都是目录示意图**：声波 10 枚在 `model-waveicons.js`
   （第 86 轮立、第 232 轮换成自有配方的示意图），进度 14 枚在 `model-progicons.js`（第 87 轮），计时 2 枚在
   `model-counticons.js`（第 88 轮，与进度那 14 枚同类）。此前两族都是手画的
   近似——声波归了 14 种"族"画法，进度按 aspect ＋ 着色模式归了五种，
   于是 `circle` 与 `donut` 都画成环（circle 其实是实心扇形）、四款 snake
   长得一模一样。近似画法一并退场。 */
(function () {
  const E = window.BC_EL;

  /* ---------- 形状 ---------- */

  /** 形状格：真路径 ＋ 该格的循环配色（画的是画布内容，不是 S2 表面） */
  function ShapeTile({tile, on, onAdd}) {
    return (
      <BCAction className={cx('stile', 'stile--shape', on && 'is-on')} onClick={onAdd}
        title={tile.name} aria-label={tile.name}>
        <svg viewBox="-6 -6 112 112" width="100%" height="100%" aria-hidden="true">
          {tile.k === 'rect'
            /* @ds-allow: 形状磁贴画的是画布上的形状本身，配色是元素调色板常量（BC_EL.PALETTE） */
            ? <rect x="0" y="0" width="100" height="100" rx={tile.r} fill={tile.fill}
                stroke={tile.outline} strokeWidth="6" />
            /* @ds-allow: 同上 */
            : <path d={tile.path} fill={tile.fill} stroke={tile.outline} strokeWidth="6"
                strokeLinejoin="round" />}
        </svg>
      </BCAction>
    );
  }

  /* ---------- 贴纸 ---------- */

  /** 贴纸格：素材原图，无标题（贴纸网格就是纯图）。

      第 238 轮起一格里可能是四种源之一（`BC_STSRC.kindOf`）：Lottie 走
      lottie-web 的播放盒，GIF / SVG 动画 / 静态图仍是 `<img>`（SMIL 在 `<img>`
      里自己会跑，这条没变）。Lottie 那一格**停在静止帧、悬停才播**——81 份同时
      播是几十条 rAF 循环，翻目录会明显掉帧；这与彩纸磁贴的手势也一致。 */
  function StickerTile({src, alt, kind, pet, onAdd}) {
    const [hover, setHover] = React.useState(false);
    // `kind` 只有品牌库那格会给：`blob:` 的源没有扩展名，判类型得靠收件时的结论
    /* Codex Pet（第 242 轮）：雪碧图与位图同是 `.webp`，只能靠收件时定下的 kind 认；
       播放盒在 [pet-sticker.jsx](pet-sticker.jsx)，磁贴停在待机第 0 格，悬停才播。 */
    if (kind === 'pet') {
      return (
        <BCAction className="stile stile--pet" onClick={onAdd} title={alt} aria-label={alt}
          onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
          onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
          <window.PetSprite src={src} version={(pet || {}).version} play={hover} />
        </BCAction>
      );
    }
    if (window.BC_STSRC.isLottie({src: src, kind: kind || null})) {
      return (
        <BCAction className="stile" onClick={onAdd} title={alt} aria-label={alt}
          onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
          onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
          <window.LottieSticker src={src} play={hover} />
        </BCAction>
      );
    }
    return (
      <BCAction className="stile" onClick={onAdd} title={alt} aria-label={alt}>
        <img src={src} alt="" draggable="false" loading="lazy" />
      </BCAction>
    );
  }

  /** 内置矢量贴纸格：核心 `sticker/*.json` 的 layers 直接画，不走图片 */
  function BuiltinTile({it, onAdd}) {
    return (
      <BCAction className="stile" onClick={onAdd} title={it.name} aria-label={it.name}>
        <svg viewBox="0 0 1 1" width="100%" height="100%" aria-hidden="true">
          {it.layers.map((l, i) => (
            /* @ds-allow: 内置贴纸画的是画布上的贴纸本身，配色来自核心 preset */
            <path key={i} d={l.d} fill={l.fill || 'none'} stroke={l.stroke || 'none'}
              strokeWidth={l.w || 0} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </svg>
      </BCAction>
    );
  }

  /* ---------- 彩纸（第 231 轮） ---------- */

  /** 彩纸画布：按 `t` 现算一帧（`BC_CONFETTI.sample`）画到 2D canvas 上。
      没有内部时钟——舞台把 `playT − start` 传进来，目录格把悬停计时传进来，
      同一枚种子同一个 t 恒得同一帧（设计稿 §2.4），暂停时看到的就是导出那一帧。
      尺寸取自 CSS 盒（`clientWidth/Height` × dpr），像素量随短边缩放归算法层。 */
  function ConfettiCanvas({props, t, dur, className}) {
    const ref = React.useRef(null);
    React.useEffect(() => {
      const c = ref.current;
      if (!c || !props) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) return;
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
      const g = c.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, pw, ph);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      window.BC_CONFETTI.paint(g, window.BC_CONFETTI.sample(props, t, {w, h}, dur), 1);
    });
    return <canvas ref={ref} className={cx('cfcanvas', className)} aria-hidden="true" />;
  }

  /** 彩纸格：深底上一帧静止画面（t = 4.5s，粒子已经铺开），悬停即播 4 秒循环。
      三个读者（目录、属性页当前款、款式抽屉）同一颗——用户靠这一格认款。

      **1.2 → 4.5（第 234 轮）**：1.2 s 上连续款才发了一两拍，`hearts-petals`
      只有 19 颗还全挤在顶边，磁贴看上去是几粒尘。4.5 s 是十款里「最弱的一款
      也最强」的时刻——四种爆发间隔（1.6 / 1.8 / 2.0 / 2.4 s）在这里都已经炸过
      且散开，连续款已进稳态。与 App 的 `CONFETTI_THUMB_TIME`、核心 golden 的
      `TILE_FRAME` 是同一个数。 */
  const TILE_T = 4.5;
  function ConfettiTile({style, on, onAdd}) {
    const [t, setT] = React.useState(TILE_T);
    const raf = React.useRef(0);
    // 72px 的格子按短边 / 540 缩放后粒子只剩一两个像素，缩略图把「大小」倍率推到上限
    // （4×）好认款——只是画格子这一笔，落到画布上的元素仍是配方原样。
    const props = React.useMemo(() => {
      const d = window.BC_CONFETTI.defaults(style.k, 11);
      return Object.assign(d, {size: window.BC_CONFETTI.RANGES.size[1]});
    }, [style.k]);
    const stop = () => { cancelAnimationFrame(raf.current); raf.current = 0; setT(TILE_T); };
    const play = () => {
      const t0 = performance.now();
      const step = (now) => { setT(TILE_T + ((now - t0) / 1000) % 4); raf.current = requestAnimationFrame(step); };
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(step);
    };
    React.useEffect(() => () => cancelAnimationFrame(raf.current), []);
    return (
      <BCAction className={cx('stile', 'stile--cft', on && 'is-on')} onClick={onAdd}
        onMouseEnter={play} onMouseLeave={stop} title={style.name} aria-label={style.name}>
        <ConfettiCanvas props={props} t={t} dur={8} />
      </BCAction>
    );
  }

  /* ---------- 白板手绘（设计稿 docs/design/video/bcut-whiteboard-animation-design.md §6.1） ---------- */

  /** 白板画布：与 `ConfettiCanvas` 同一形状——按 `t` 现算一帧（`BC_WHITEBOARD.sample`）画到
      2D canvas 上，没有内部时钟；舞台传 `playT − start`，目录格传悬停计时。 */
  function WhiteboardCanvas({props, t, dur, className}) {
    const ref = React.useRef(null);
    React.useEffect(() => {
      const c = ref.current;
      if (!c || !props) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) return;
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
      const g = c.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, pw, ph);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      window.BC_WHITEBOARD.paint(g, window.BC_WHITEBOARD.sample(props, t, {w, h}, dur));
    });
    return <canvas ref={ref} className={cx('cfcanvas', className)} aria-hidden="true" />;
  }

  /** 白板格：静止时是画完的那一帧（示范整张），悬停从头画一遍（画时 3 s 循环 4 s）。
      三个读者（目录、属性页当前示范、示范抽屉）同一颗。格子沿用 `stile--cft` 的几何。 */
  const WB_TILE_DUR = 4;
  function WhiteboardTile({demo, on, onAdd}) {
    const [t, setT] = React.useState(WB_TILE_DUR);
    const raf = React.useRef(0);
    const props = React.useMemo(() => Object.assign(window.BC_WHITEBOARD.defaults(demo.k), {draw: 3}), [demo.k]);
    const stop = () => { cancelAnimationFrame(raf.current); raf.current = 0; setT(WB_TILE_DUR); };
    const play = () => {
      const t0 = performance.now();
      const step = (now) => { setT(((now - t0) / 1000) % WB_TILE_DUR); raf.current = requestAnimationFrame(step); };
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(step);
    };
    React.useEffect(() => () => cancelAnimationFrame(raf.current), []);
    return (
      <BCAction className={cx('stile', 'stile--cft', on && 'is-on')} onClick={onAdd}
        onMouseEnter={play} onMouseLeave={stop} title={demo.name} aria-label={demo.name}>
        <WhiteboardCanvas props={props} t={t} dur={WB_TILE_DUR} />
      </BCAction>
    );
  }

  /* ---------- 可视化缩略图 ---------- */

  function ArtNode({n}) {
    const kids = (n.c || []).map((c, i) => <ArtNode key={i} n={c} />);
    return React.createElement(n.t, n.a, kids.length ? kids : undefined);
  }
  /** 示意图 → SVG。`fill="none"` 是根节点上的：只写了 stroke 的那几款
      （声波的 oscilloscope / ring_wave / ring_bars / ribbons，进度的
      rainbow_border / strobe_border）少了它就会被 path 的默认黑填充盖死。 */
  function ArtGlyph({art, main, second}) {
    /* @ds-allow: 缩略图画的是画布上的元素本身，取核心配方的默认主副色 */
    const vars = {'--color-main': main,
      '--color-secondary': second === E.TRANSPARENT ? 'transparent' : second};
    return (
      <svg viewBox={art.vb} width="100%" height="100%" fill="none" style={vars} aria-hidden="true"
        preserveAspectRatio="xMidYMid meet">
        {art.c.map((n, i) => <ArtNode key={i} n={n} />)}
      </svg>
    );
  }
  /** 声波缩略图：**10 枚示意图 SVG**（`model-waveicons.js`，第 232 轮起是自有配方）。

      着色走 CSS 变量：网格与属性页的 Style 下拉都把 `--color-main` /
      `--color-secondary` 设成**该款的默认主副色**（不是元素当前的颜色），所以同一款
      在三个读者那里永远是同一张图。10 款全部吃变量，双色四款（spectrum_area / dots /
      pulse_rings / ribbons）再吃副色。 */
  function WaveGlyph({it}) {
    const art = window.BC_WAVEICON.ICONS[it.k];
    return art ? <ArtGlyph art={art} main={it.main} second={it.second} /> : null;
  }

  /** 进度缩略图：**那 14 枚内联 SVG**（`model-progicons.js`）。

      与声波同一条口径（第 87 轮跟上第 86 轮）：着色走 CSS 变量，喂的是**该款的默认
      主副色**（喂的是同一张表里的默认色，不是元素
      当前的颜色），所以浏览页、样式抽屉、画布浮动条三处永远是同一张图。

      两条彩虹边框与两条游走彩虹的渐变写死在图里、不吃变量——这正是进度目录
      在那四款上把色板收走（0 张 / 只剩一张）的原因。 */
  function ProgGlyph({it}) {
    const art = window.BC_PROGICON.ICONS[it.k];
    return art ? <ArtGlyph art={art} main={it.main} second={it.second} /> : null;
  }

  /** 计时缩略图：**那两枚内联 SVG**（`model-counticons.js`，第 88 轮）。
      与声波 / 进度同一条管线，只有一处不同：这两枚**不吃颜色变量**——
      读数与方向箭头那两个色写死在图里（值与理由登记在 `_ds_conformance.json` 的
      `app/model-counticons.js` 条目下），因为计时不是进度条，没有默认主副色可喂。 */
  function CountGlyph({it}) {
    const art = window.BC_CNTICON.ICONS[it.k];
    return art ? <ArtGlyph art={art} main={it.main} second={it.second} /> : null;
  }

  /** 三族共用的一格：缩略图 ＋ 名字。分派看模型里的 `fam`——三族现在都有
      `labels` 或名字，靠"有没有某个字段"分不开了。 */
  function VizGlyph({it}) {
    if (it.fam === 'count') return <CountGlyph it={it} />;
    return it.fam === 'prog' ? <ProgGlyph it={it} /> : <WaveGlyph it={it} />;
  }
  function VizTile({it, onAdd}) {
    /* 三族都是浅底格子，只是版式不同：声波两列 2:1 宽格，进度三列等高格且 `bar`
       那两款横跨两列（`square` 为假），
       计时跟进度同一种格子（缩略图也是 80×80 的方件），只是不会有横跨两列的那一档。 */
    const prog = it.fam === 'prog';
    const count = it.fam === 'count';
    return (
      <BCAction className={cx('tilewrap', prog && !it.square && 'tilewrap--wide')}
        onClick={onAdd} title={it.en}>
        <span className={cx('tile', count ? 'tile--count' : prog ? 'tile--prog' : 'tile--wave')}>
          <VizGlyph it={it} />
        </span>
        <em>{it.name}</em>
      </BCAction>
    );
  }

  Object.assign(window, {ShapeTile, StickerTile, BuiltinTile, ConfettiCanvas, ConfettiTile,
    WhiteboardCanvas, WhiteboardTile, ArtGlyph, WaveGlyph, ProgGlyph, CountGlyph, VizGlyph, VizTile});
})();
