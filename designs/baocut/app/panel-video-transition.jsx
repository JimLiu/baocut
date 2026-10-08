/* 视频转场独立属性页：与 Styles 一样占用右侧 tab panel。 */
(function () {
  function VideoTransitionsView({ctx, el, onBack}) {
    const T = window.BC_VIDEO_TRANSITION;
    const [slot, setSlot] = React.useState('in');
    const [preview, setPreview] = React.useState(0);
    const [elapsed, setElapsed] = React.useState(null);
    const doc = ctx.elDocs[el.id] || {};
    const rec = ctx.elements.find(e => e.id === el.id) || el;
    const length = Math.max(0, (doc.end ?? rec.end ?? 0) - (doc.start ?? rec.start ?? 0));
    const value = T.normalize(doc.transitions?.[slot], length);
    const label = T.PRESETS.find(p => p.k === value.k).label;
    const set = patch => {
      const next = T.normalize({...value, ...patch}, length);
      if (next.k !== value.k || next.dur !== value.dur) {
        ctx.setElDoc(el.id, {transitions: {...doc.transitions, [slot]: next}});
      }
      setPreview(n => n + 1);
    };
    React.useEffect(() => {
      if (!preview) return;
      let raf, start;
      const tick = now => {
        if (start == null) start = now;
        const t = Math.min((now - start) / 1000, value.dur + 0.4);
        setElapsed(t);
        if (t < value.dur + 0.4) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [preview, slot, value.k, value.dur]);
    const progress = elapsed == null ? 1 : Math.min(1, Math.max(0, (elapsed - 0.2) / (value.dur || 1)));
    const frame = T.style(value.k, slot === 'in' ? progress : 1 - progress);
    const holdDrag = () => {
      ctx.history?.begin();
      window.addEventListener('mouseup', () => {
        ctx.history?.commit(); window.keepSelectionAfterDrag();
      }, {once: true});
    };
    return <>
      <window.PanelHead title="转场" onBack={onBack} backTip="返回编辑视频" />
      <div className="pscroll bc-scroll">
      <div className="vtransition">
      <div className="vtransition__head"><strong>当前视频</strong></div>
      <p className="vtransition__asset" title={doc.asset || rec.asset || rec.name}>{doc.asset || rec.asset || rec.name}</p>
      <Segmented size="s" value={slot} onChange={v => {setSlot(v); setElapsed(null);}}
        items={[{k: 'in', label: '进入'}, {k: 'out', label: '离开'}]} />
      <div className="vtransition__preview" aria-label={`${slot === 'in' ? '进入' : '离开'} · ${label}预览`}>
        <span className="vtransition__scene vtransition__scene--base">底层画面</span>
        <span className="vtransition__scene" style={frame}><Ic n="video" className="ic--22" />当前视频</span>
        <BCAction className="vtransition__replay" onClick={() => setPreview(n => n + 1)} aria-label="重播转场预览">
          <Ic n="play" className="ic--14" />预览</BCAction>
      </div>
      <div className="vtransition__grid" role="group" aria-label="转场效果">
        {T.PRESETS.map(p => <BCAction key={p.k} className={cx('vtransition__preset', value.k === p.k && 'is-on')}
          aria-pressed={value.k === p.k} onClick={() => set({k: p.k})}>
          <span className="vtransition__sample"><span style={T.style(p.k, 0.55)}>{p.k === 'none' ? <Ic n="ban" className="ic--16" /> : 'B'}</span></span>
          <span>{p.label}</span>{value.k === p.k ? <Ic n="check" className="ic--12" /> : null}
        </BCAction>)}
      </div>
      {value.k !== 'none' ? <div className="mval" onMouseDownCapture={holdDrag}>时长
        <Slider value={value.dur} min={Math.min(0.1, length / 2)} max={Math.min(2, length / 2)} step={0.1}
          onChange={dur => set({dur})} /><span className="v">{value.dur.toFixed(1)}s</span>
      </div> : null}
      <p className="vtransition__hint">{slot === 'in' ? '从底层画面过渡到当前视频。' : '从当前视频过渡到底层画面。'}选择即应用，可撤销。</p>
      </div>
      </div>
    </>;
  }
  window.VideoTransitionsView = VideoTransitionsView;
})();
