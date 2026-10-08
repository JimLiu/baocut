/* 贴纸的填充色卡 —— §14.4（第 122 轮）。
   ============================================================================
   判据全在纯层 [model-svgfill.js](model-svgfill.js)（有单测）：素材里有几个填充色
   分组就出几张色卡、最多 5 张，含 `<image>` 或超过 15 种色一张都不出。这一份只做
   三件视图侧的事，好让**属性页与画布浮动条读同一份**：

     1. **素材文本的取用**（`useSvg` / `useSvgSync`，第 122 轮从
        [stage-toolbar.jsx](stage-toolbar.jsx) 搬来）。缓存是模块级的资源表，不是组件
        state：条子会跟着选中反复挂载卸载，把结果放进 state 会一边卸载一边重发请求
        （第一版就是这样，一次选中打了十几发）。先写一个 null 占位挡住重复请求，
        落地后广播给所有订阅者重画一次。
     2. **`fillList` 的读写**（`useStickerFills`）。它挂在**逐元素文档**
        `ctx.elDocs[id]` 上，不进按类共享的 `elStyle`——共用袋是「同类元素长一个样」，
        而换色是这一件贴纸自己的事（两张不同素材的第 2 组根本不是同一个色）。写回走
        `ctx.setElDoc`，因此自动进撤销栈。
     3. **默认色不落盘**。首次选中时不把默认色种进文档，而是**读的时候回落**
        （`at(i)` 没有覆盖就给素材原色）：换过素材之后不会留下一张前一张素材的色表，
        撤销栈里也不会多出一步空改动。
   ============================================================================ */
(function () {
  const {useState, useEffect} = React;
  const F = window.BC_SVGFILL;

  const SVG_CACHE = {};
  const SVG_SUBS = new Set();
  function loadSvg(src) {
    if (!src || SVG_CACHE[src] !== undefined) return;
    SVG_CACHE[src] = null;                       // 占位：在飞的请求不再发第二发
    fetch(src).then((r) => r.text()).then((t) => {
      SVG_CACHE[src] = t;
      SVG_SUBS.forEach((f) => f());
    }).catch(() => {});
  }
  function useSvg(src) {
    const [, bump] = useState(0);
    useEffect(() => {
      const f = () => bump((n) => n + 1);
      SVG_SUBS.add(f);
      return () => { SVG_SUBS.delete(f); };
    }, []);
    loadSvg(src);
    return src ? SVG_CACHE[src] : null;
  }
  /* 舞台是渲染路径，拿不到 hook 的异步态——它读同一份缓存，没读到就先画原图。 */
  function useSvgSync(src) {
    loadSvg(src);
    return src ? SVG_CACHE[src] || null : null;
  }
  /* Lottie 走同一份文本缓存，只是多一步解析——解析结果按 src 记住，因为舞台在
     播放中逐帧重入，每帧 `JSON.parse` 一份 14 KB 的 JSON 是白烧 CPU。 */
  const JSON_CACHE = {};
  function useJsonSync(src) {
    const txt = useSvgSync(src);
    if (!txt) return null;
    if (JSON_CACHE[src] === undefined) {
      try { JSON_CACHE[src] = JSON.parse(txt); } catch (e) { JSON_CACHE[src] = null; }
    }
    return JSON_CACHE[src];
  }

  /** 画面上现在那一张贴纸素材（`st.asset` / 目录里点的那张优先于演示装置自带的） */
  function srcOf(ctx, el, st) {
    const style = st || (ctx.elStyleOf ? ctx.elStyleOf(el.id) : ctx.elStyle) || {};
    if (style.builtin) return null;              // 内置矢量没有 URL，见下面 `layers`
    return style.asset || (el && el.asset ? window.BC_SK.DIR + el.asset : null);
  }

  /* 换过色的素材喂给渲染器的形态（base64 data URI）。按 `src|fillList|拉伸` 记一次：
     播放中舞台逐帧重画，不记的话每一帧都要重跑一遍替换与 base64。

     `fit` 为真＝盒子被拉成任意宽高（`pose.h` 生效），此时哪怕一张卡都没改过也要出
     data URI——`object-fit: fill` 压不住素材自己的 `preserveAspectRatio`，得靠
     `F.stretch` 把根标签改掉。位图（`raw` 为空）不需要，`object-fit` 对它就够了。 */
  const PAINTED = {};
  function stickerPaint(src, raw, fillList, fit) {
    const list = fillList || [];
    const recolor = !!(raw && list.length && !F.isDefault(raw, list));
    if (!raw || (!recolor && !fit)) return src;
    const key = src + '|' + list.join(',') + '|' + (fit ? 's' : '');
    if (!PAINTED[key]) {
      const txt = recolor ? F.applyFills(raw, list) : raw;
      PAINTED[key] = F.dataUri(fit ? F.stretch(txt) : txt);
    }
    return PAINTED[key];
  }

  /** 这一件贴纸的色卡表与读写口。位图 / GIF `vector` 为 false，整段不出。

      第 238 轮起 **Lottie 也出色卡**：颜色不在 SVG 源码里而在图层的形状项上，
      判据在 [model-lottiefill.js](model-lottiefill.js)（与素材生成器同一套规则，
      单测拿 81 份真素材与 manifest 对拍）。两条路径出的都是 `{i, hex}`，属性页
      那一行不用知道自己面对的是哪一种。 */
  function useStickerFills(ctx, el, st) {
    const style = (el && (ctx.elStyleOf ? ctx.elStyleOf(el.id) : ctx.elStyle)) || {};
    const cur = st || style;
    const bi = el && cur.builtin
      ? (window.BC_SK.BUILTIN.filter((x) => x.id === cur.builtin)[0] || null) : null;
    const src = el && !bi ? srcOf(ctx, el, cur) : null;
    const kind = src ? window.BC_STSRC.fillMode({src: src, kind: cur.assetKind || null}) : 'none';
    const url = kind === 'none' ? null : src;
    const txt = useSvg(url);                     // hook 恒调一次，条件在参数上
    const lottie = kind === 'lottie' && txt ? useJsonSync(url) : null;
    const svg = bi ? F.builtinSvg(bi.layers) : (kind === 'lottie' ? null : txt);
    const cards = lottie ? window.BC_LOTTIEFILL.fillsOf(lottie) : (svg ? F.fillsOf(svg) : []);
    const list = ((ctx.elDocs || {})[el ? el.id : ''] || {}).fillList || [];
    return {
      src, source: {src: src, kind: cur.assetKind || null}, vector: !!(bi || url),
      ready: !!(svg || lottie),
      cards: cards,
      list: list,
      /** 第 i 张卡此刻的色：没改过就是素材原色（默认色不落盘） */
      at: (i) => list[i] || (cards[i] || {}).hex || null,
      /** 只写第 i 张卡，别的原样；全清回原色就把整张表撤掉 */
      setAt: (i, c) => {
        const next = cards.map((card, j) => (j === i ? (c || null) : (list[j] || null)));
        ctx.setElDoc(el.id, {fillList: next.some(Boolean) ? next : null});
      },
    };
  }

  /** 属性页上那一行色卡：一个 `Color` 段头 ＋ 一排色钮 */
  function StickerFillRow({ctx, el, pop, setPop}) {
    const fl = useStickerFills(ctx, el);
    if (!fl.vector || !fl.cards.length) return null;
    return (
      <>
        <SecHead>颜色</SecHead>
        <div className="sec">
          <PRow>
            {fl.cards.map((c, i) => {
              const k = 'fill' + i;
              const scope = '第 ' + (i + 1) + ' 组';
              return (
                <BCAction key={k} className={cx('mb', pop === k && 'is-on')}
                  onClick={() => setPop(pop === k ? null : k)}>
                  <span className="cdot" style={{'--swatch-c': fl.at(i)}} />
                  <span className="mtip">{scope}</span>
                  {pop === k ? (
                    <Popover open onClose={() => setPop(null)} align="left" dir="down" width={270}>
                      <ColorPanel value={fl.at(i)} scope={scope} clearLabel="原色"
                        onPick={(x, live) => { fl.setAt(i, x); if (!live) setPop(null); }} />
                    </Popover>
                  ) : null}
                </BCAction>
              );
            })}
          </PRow>
        </div>
      </>
    );
  }

  Object.assign(window, {useSvg, useSvgSync, useJsonSync, useStickerFills, stickerPaint, StickerFillRow});
})();
