/* Lottie 贴纸的播放盒（第 238 轮）。

   第 237 轮之前动态贴纸是 56 张带 SMIL 的 SVG，`<img>` 一放就动，暂停要看播放头
   的那份走 [intrinsic-sticker.jsx](intrinsic-sticker.jsx)。本轮五个内置分类换成
   Google Noto Animated Emoji 的 **Lottie JSON**（CC BY 4.0，81 份），品牌库也开始
   收用户自己的 Lottie，于是多出这一份共用播放盒：目录磁贴与画布用同一个组件，
   免得两处各接一次 lottie-web、各漏一次 `destroy()`。

   三件必须由这一层保证的事：

   1. **卸载即销毁**。lottie-web 的每个实例都挂着 rAF 循环与一棵 SVG 子树；元素
      目录是长列表，翻几趟包就是几百个实例。`useEffect` 的清理函数里 `destroy()`，
      不留一个。
   2. **磁贴不自己跑**。81 份同时播是几十条 rAF 循环，翻目录会明显掉帧；所以磁贴
      停在**静止帧**（Noto 在 `markers[]` 里留了一个叫 `rest` 的姿势，没有就是第 0
      帧），悬停才播——和第 234 轮彩纸磁贴「悬停即播」是同一套手势。
   3. **画布跟播放头**。`time` 传进来就是「播放头减这条元素的起点」，按 `fr` 折成
      帧号 `goToAndStop`：拖播放头、暂停、逐帧看到的都是同一帧，与 SMIL 那条路径
      和核心导出的确定性口径一致，不另开一只自由跑的钟。

   换色走 `BC_LOTTIEFILL.applyFills`（纯层，有单测）：改过色就把重建出来的
   `animationData` 交给 lottie-web，没改过就用 `path` 让它自己去取——后者能吃到
   浏览器的 HTTP 缓存，翻目录不会每次都重新解析一遍 JSON。 */
(function () {
  const S = window.BC_STSRC;

  /** 建实例 / 销毁实例。`data` 给了就用它（换过色的那份），否则给 `path`。 */
  function useLottie(host, src, data, loop) {
    const anim = React.useRef(null);
    const [ready, setReady] = React.useState(0);
    React.useEffect(() => {
      const box = host.current;
      if (!box || !window.lottie || (!src && !data)) return undefined;
      const a = window.lottie.loadAnimation(Object.assign({
        container: box,
        renderer: 'svg',
        loop: loop !== false,
        autoplay: false,
        rendererSettings: {preserveAspectRatio: 'xMidYMid meet', progressiveLoad: true},
      }, data ? {animationData: data} : {path: src}));
      anim.current = a;
      const onReady = () => setReady((n) => n + 1);
      a.addEventListener('DOMLoaded', onReady);
      return () => {
        a.removeEventListener('DOMLoaded', onReady);
        a.destroy();                       // 长列表里漏一个就是一条常驻 rAF
        anim.current = null;
      };
    }, [src, data, loop]);
    return [anim, ready];
  }

  /** 一份 Lottie 的帧号换算：`time`（秒）→ 落在 [ip, op) 里的循环帧。 */
  function frameAt(doc, time) {
    const fr = Number(doc.fr) || 60;
    const ip = Number(doc.ip) || 0;
    const span = Math.max(1, (Number(doc.op) || 0) - ip);
    const off = ((Number(time) || 0) * fr % span + span) % span;
    return ip + off;
  }

  /** 共用播放盒。
      - `time` 给了：跟播放头，那一帧停住（画布）。
      - 没给：`play` 为真就循环播，为假停在静止帧（目录磁贴）。 */
  function LottieSticker({src, data, loop, play, time, className, style}) {
    const host = React.useRef(null);
    const [anim, ready] = useLottie(host, data ? null : src, data || null, loop);
    React.useEffect(() => {
      const a = anim.current;
      if (!a || !ready) return;
      const doc = a.animationData || {};
      if (time != null) { a.goToAndStop(frameAt(doc, time), true); return; }
      if (play) a.play();
      else a.goToAndStop(S.posterFrame(doc), true);
    }, [ready, play, time]);
    return <span ref={host} className={cx('lotbox', className)} style={style} aria-hidden="true" />;
  }

  /* 换过色的那份 `animationData` 按 `src|色表` 记一次。舞台播放中逐帧重入，不记的话
     每一帧都会深拷贝一份 14 KB 的 JSON——而且新对象会让上面的 `useEffect` 判成
     「源变了」，于是每帧销毁重建一个 lottie 实例。返回 null 表示「没改过色，用
     `path` 就行」。 */
  const PAINTED = {};
  function paintLottie(src, doc, fills) {
    const list = fills || [];
    const LF = window.BC_LOTTIEFILL;
    if (!doc || !list.length || LF.isDefault(doc, list)) return null;
    const key = src + '|' + list.join(',');
    if (!PAINTED[key]) PAINTED[key] = LF.applyFills(doc, list);
    return PAINTED[key];
  }

  Object.assign(window, {LottieSticker, paintLottie, lottieFrameAt: frameAt});
})();
