/* 第 143 轮：文字局部预览走 useLocalMotionPreview，独立时钟只供目标取帧。
   显式片段播放走 once 窗口，保留声音设置、播完撤回。
   下述第 122 轮的全局悬停语义仅供其它元素/字幕的既有入口使用。
   悬停即预览的**播放**那一半（§14.3；第 122 轮）。

   样式卡的预览是一张静止的画，动画的预览不能是——「弹出」与「弹入」静止时长得
   一模一样。此前原型给每一格挂了一段 CSS keyframes（`.anpk` / `[data-apv]`），
   那是**另一支动画**：同名不同形、时长恒 1.4s、播放头不动、其余元素也不动。

   本轮换了做法：hover 时把这支动画作为临时
   属性派给元素（不进文档、不进历史），**静音**，播放头 seek 到这支动画的窗口起点，
   然后**用真实播放器播过去**——所以时间轴的游标在走，画面上其余元素、字幕、B-roll
   全都同步在动。播到时长不撤回：用户要的是反复看，所以窗口末尾折返
   （折返在 editor.jsx 的 rAF 里，读的就是这里写下的 `preview.current.win`）。

   退出只有一条路：`peek` 被清掉（鼠标移出列表、面板卸载、切走、点选之后）。
   那一刻把进来之前存下的三格原样放回。 */
(function () {
  const {useRef, useEffect, useState} = React;
  const PV = window.BC_PREV;

  /** @param preview  editor.jsx 持有的 ref：`{win, snap}`，rAF 每帧读 `win`
   *  @param o        `{peek, playT, playing, muted, setPlayT, setMuted, setPlaying}`
   *                  —— `setPlaying` 必须是**不清选中**的那一个（`setPlayingRaw`）：
   *                  鼠标扫过一格就把用户的选中扫没了，显然不对。 */
  function usePreviewPlayback(preview, o) {
    /* 进预览那一刻的现场。每次渲染同步一份——快照是在 effect 里取的，那时
       `setPlayT` 还没落地，读到的仍是进来之前的值。 */
    const live = useRef(null);
    live.current = {playT: o.playT, playing: o.playing, muted: o.muted};

    /* 只有带 `win` 的悬停载荷进预览态。样式画廊那一批（`kind:'sub'` / `kind:'el'`）
       不带窗口，仍旧只是静态覆盖——它们不该把播放头拽走。 */
    const win = o.peek && o.peek.win ? o.peek.win : null;
    /* 依赖是窗口本身，不是 peek：在同一支入场的相邻两格之间挪动时窗口没变，
       那就让它接着循环，不要每挪一格重新 seek 一次——那一下就是抖。 */
    const key = win ? win.t0 + '|' + win.t1 + '|' + !!o.peek.once : '';
    useEffect(() => {
      if (win) {
        if (!preview.current.snap) preview.current.snap = PV.snapshot(live.current);
        preview.current.hold = null;
        preview.current.win = win;
        preview.current.justStarted = true;
        o.setPlayT(win.t0);
        preview.current.once = !!o.peek.once;
        if (!o.peek.once) o.setMuted(true);
        o.setPlaying(true);
        return;
      }
      const back = PV.restore(preview.current.snap);
      if (!back) return;   // 没进过预览态就什么都不做（不许把播放头拽回片头）
      /* `hold` 压住播放头：这一拍已经排上队的那一帧 rAF 要到下一次 commit 才取消得掉，
         不压住它就会在放回去的值上再加一帧（约 16ms）——来回几次就漂得看得出来。
         **只在放回去是「暂停」时压**：进预览之前本来就在播的，播放头本来就在走，
         16ms 没有意义，压住它反而会把真播放冻在原地。这一格由 editor.jsx 的 rAF
         effect 下一次真的开播时撤掉。 */
      preview.current = {win: null, snap: null, hold: back.playing ? null : back.playT};
      o.setPlayT(back.playT);
      o.setMuted(back.muted);
      o.setPlaying(back.playing);
    }, [key]);
    useEffect(() => {
      if (preview.current.justStarted) { preview.current.justStarted = false; return; }
      if (o.peek && o.peek.once && win && (o.playT >= win.t1 || !o.playing)) o.setPeek(null);
    }, [o.playT, o.playing, key]);
  }

  function useLocalMotionPreview(peek, playing, setPeek) {
    const [tick, setTick] = useState({peek: null, elapsed: 0});
    useEffect(() => {
      if (!peek || !peek.localWin) return;
      if (playing) { setPeek(null); return; }
      let raf;
      const start = performance.now();
      const step = (now) => {
        setTick({peek, elapsed: (now - start) / 1000});
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    }, [peek, playing]);
    return tick.peek === peek ? tick.elapsed : 0;
  }

  Object.assign(window, {usePreviewPlayback, useLocalMotionPreview});
})();
