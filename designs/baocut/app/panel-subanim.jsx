/* Subtitle animation selector. Hover/focus previews only the tile; clicking writes
   through the existing scope and history path. Canvas owns all sample pixels. */
(function () {
  const {useEffect, useState} = React;
  const D = window.BC_DATA, S = window.BC_SUB, SA = window.BC_SA;
  function AnimDemo({demo, playing = true, active}) {
    if (!SA.moves(demo)) return <span className="andemo andemo--none"><Ic n="ban" className="ic--20" /></span>;
    return <window.SubtitleCanvas demo={demo} playing={playing} active={active} />;
  }

  function SubAnimView({ctx, onBack}) {
    const app = useApp();
    const [hovered, setHovered] = useState(null);
    const [colourOpen, setColourOpen] = useState(false);
    const st = ctx.subStyle;
    const track = S.source(st) || {};
    /* 这一页也吃**样式作用域**（第 102.1 轮）：属性页切到「仅这一条」之后进来选一格，
       落的就该是这一条自己的动效。首版这里恒写整条轨——那时属性页在这一档下干脆不出
       「逐词动效」那张卡，两处一起是自洽的；卡回来之后再恒写整条轨，就成了「面板说
       仅这一条、点进去改的却是全部」。 */
    const cueId = ctx.subScope === 'cue' && ctx.curCue && track.id ? ctx.curCue.id : null;
    // 读的是**有效样式**：这一条自己设过就读它，没设过读轨上那份
    const src = (track.id ? S.line(st, track.id, cueId) : null) || {};
    const current = D.subtitle.anims.find((a) => a.k === src.wordAnim) || D.subtitle.anims[0];
    const colourLabel = window.BC_SI.colourLabel(src.wordAnim);
    const setColor = (color) => {
      const tag = 'subtitle:' + track.id + ':' + (cueId || 'all') + ':activeColor';
      if (cueId) ctx.setSubCue(cueId, track.id, {activeColor: color}, tag);
      else ctx.setSubTrack(track.id, {activeColor: color}, tag);
    };

    /* 这一页只剩**逐词动效**（第 55 轮）。动效字幕搬去样式画廊了——用户点破的那一句：
       它不只是「怎么动」，它连排版与图层一起换，那就是一份**样式**。留在这里等于让人
       去「改其中某一项」的地方做「换一个样子」的事。

       两者的字段也是分开的（第 54 轮）：`wordAnim` 是叠在涂装上的正交修饰，`caption` 是
       接管整条的配方。所以这一页里选任意一格，都会把配方撤掉——否则画面上仍是配方说了算，
       这一笔等于没点。 */
    const cap = src.caption && D.subtitle.designed.find((g) => g.id === src.caption);
    /* 两轴（2026-10-09）：这一格同时写成当前词 ＋ 动效（`BC_CS.fromAnim`，十九格往返一一对应），
       画布走两轴路，只写 `wordAnim` 的话画面上不会变。 */
    const patch = (k) => {
      const f = window.BC_CS.fromAnim(k, src.activeColor);
      return {wordAnim: k, activeWord: f.activeWord, motion: f.motion, caption: null, textMotion: null, wordBackground: null};
    };
    const set = (k) => {
      ctx.setPeek(null);
      /* 倒鸭子（`kinetic`，2026-09-17）是整条轨的，不在 cue 覆盖表的白名单里：选任意一格
         都在轨上把它清掉，否则画面上仍是它说了算，这一笔等于没点。 */
      if (track.kinetic) ctx.setSubTrack(track.id, {kinetic: null});
      if (cueId) ctx.setSubCue(cueId, track.id, patch(k));
      else ctx.setSubTrack(track.id, patch(k));
      setColourOpen(false);
    };
    useEffect(() => () => ctx.setPeek(null), []);
    useEffect(() => {
      const escape = (event) => { if (event.key === 'Escape') {ctx.setPeek(null); setHovered(null);} };
      window.addEventListener('keydown', escape);
      return () => window.removeEventListener('keydown', escape);
    }, [ctx.setPeek]);

    const selected = ctx.sel && S.byId(st, ctx.sel.trackId);
    if (!track.id || (selected && selected.role !== 'source')) return (
      <>
        <window.PanelHead title="字幕动画" onBack={onBack} backTip="返回字幕属性" />
        <div className="pscroll"><div className="signpost">逐词动效仅适用于原文字幕。请选择原文轨设置动画，译文保持整句显示。</div></div>
      </>
    );

    return (
      <>
        <window.PanelHead title="字幕动画" onBack={onBack} backTip="返回字幕属性" />
        <window.SubScopeBar ctx={ctx} trackId={track.id} />
        <div className="subanim__current">
          <div className="subanim__summary">
            <div className="subanim__sample"><AnimDemo demo={cap ? 'none' : current.demo} playing={hovered === null} active={src.activeColor} /></div>
            <div className="subanim__copy">
              <span className="subprops__label">当前效果</span>
              <strong>{cap ? cap.name : current.name}</strong>
              <p>{cap ? '这份样式自带排版与动画。' : window.BC_SI.description(current.k)}</p>
            </div>
          </div>
          {!cap && colourLabel ? <div className="subanim__colour"><PRow label={colourLabel}>
            <ColorField value={src.activeColor} scope={cueId ? '仅这一条' : '全部原文字幕'}
              open={colourOpen} onToggle={() => setColourOpen(!colourOpen)}
              onPick={(color, live) => {setColor(color); if (!live) setColourOpen(false);}} inline />
          </PRow></div> : null}

        </div>
        <div className="pscroll bc-scroll subanim" onMouseLeave={() => {ctx.setPeek(null); setHovered(null);}}>
          {/* 「悬停能预览」不写在屏幕上：鼠标一扫过就自己显形了，写出来只是每次都占一条。
              留下的这一条讲的是**当下的状态**——不说，用户看不出为什么一格都没选中。 */}
          {cap ? (
            <div className="signpost">
              现在用的是动效字幕<strong>「{cap.name}」</strong>，它连排版一起管。
              在这里选一格会换回普通逐词动效；换别的配方去样式画廊。
            </div>
          ) : null}
          {/* 作用域跟着属性页走，所以这一页也要把它说出来——不说，用户在属性页上选了
              「仅这一条」，进到这一页会以为又回到了全部。 */}
          <p className="subanim__help">{window.subReduced ? '已跟随系统减少动态效果。' : '移到效果上查看动画，点击应用。'}</p>
          <div className="angrid">
            {D.subtitle.anims.map((a) => (
              <BCAction key={a.k} className={cx('ancell', !src.caption && src.wordAnim === a.k && 'is-on')}
                aria-label={a.name + '：' + window.BC_SI.description(a.k)} aria-pressed={!src.caption && src.wordAnim === a.k}
                title={window.BC_SI.description(a.k)}
                onClick={() => set(a.k)}
                onMouseEnter={() => {setHovered(a.k); }}
                onMouseLeave={() => {setHovered(null); ctx.setPeek(null);}}
                onFocus={() => {setHovered(a.k); }}
                onBlur={() => {setHovered(null); ctx.setPeek(null);}}>
                <span className="ancell__f"><AnimDemo demo={a.demo} playing={hovered === a.k || (hovered === null && src.wordAnim === a.k)} /></span>
                {!src.caption && src.wordAnim === a.k ? <span className="subanim__tick"><Ic n="check" className="ic--14" /></span> : null}
                <span className="ancell__n">
                  {app.coreMarks ? <i className={cx('core', !a.core && 'is-off')} /> : null}{a.name}
                </span>
              </BCAction>
            ))}
          </div>
          {app.coreMarks ? (
            <div className="hint">
              动画参数由共享采样器处理；Web 与桌面端使用同一套时间模型。
            </div>
          ) : null}
        </div>
      </>
    );
  }

  Object.assign(window, {SubAnimView, AnimDemo});
})();
