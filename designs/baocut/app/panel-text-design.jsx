/* Text styles and motion workbench. Shared Spectrum controls, one stage paint path. */
(function () {
  const {useState, useEffect} = React;
  const TC = window.BC_TEXT_CONTROLS;
  const TP = window.BC_TP;
  const D = window.BC_DATA;
  const phases = [{k: 'in', label: '入场'}, {k: 'out', label: '出场'}, {k: 'loop', label: '循环'}];

  function TextPanelHeader({title, onBack}) {
    return <window.PanelHead title={title} onBack={onBack} backTip="返回编辑文本" />;
  }

  function TextStylesView({ctx, id, st, set, onBack}) {
    const [pop, setPop] = useState(null);
    const preset = TC.presetOf(st, D.textStylePresets);
    const off = () => ctx.setPeek(null);
    useEffect(() => off, [id]);
    const color = (key, value, change, scope) => <ColorField value={value} scope={scope}
      open={pop === key} onToggle={() => setPop(pop === key ? null : key)}
      onPick={(c, live) => { off(); change(c); if (!live) setPop(null); }} inline />;
    const defaults = {bg: D.textStylePresets[4].style.bg, ol: D.textStylePresets[1].style.ol,
      sh: D.textStylePresets[6].style.sh};
    const effect = (key) => Object.assign({}, defaults[key], st[key]);
    const change = (key, patch) => { off(); set({[key]: Object.assign({}, effect(key), patch)}); };
    const hover = (p) => ({
      onMouseEnter: () => ctx.setPeek({kind: 'el', label: p.name, apply: (s) => Object.assign({}, s, TC.effectPatch(p))}),
      onMouseLeave: off,
    });
    const sample = (s, size) => TP.textCss(TP.fromStyle(Object.assign({}, s, {size: 48})), size / 48);
    return <>
      <TextPanelHeader title="样式" onBack={onBack} />
      <div className="pscroll bc-scroll text-inspector" onScroll={off}>
        <div className="text-section-title"><b>外观预设</b><span>{preset ? preset.name : '自定义'}</span></div>
        <p className="text-help">悬停看舞台效果，点击应用。保留字体与排版。</p>
        <div className="text-style-grid" onMouseLeave={off}>
          {D.textStylePresets.map((p) => <BCAction key={p.id} aria-label={p.name}
            aria-pressed={!!preset && preset.id === p.id}
            className={cx('text-style-tile', preset && preset.id === p.id && 'is-on')}
            {...hover(p)} onClick={() => { off(); set(TC.effectPatch(p)); }}>
            <span className="abc"><span style={sample(Object.assign({}, st, TC.effectPatch(p)), 22)}>Abc</span></span>
            <span className="text-tile-label">{p.name}{preset && preset.id === p.id ? <Ic n="check" className="ic--12" /> : null}</span>
          </BCAction>)}
        </div>
        <div className="text-section-title"><b>自定义外观</b></div>
        <div className="text-control-row"><span>文字颜色</span>{color('fill', st.color, (c) => set({color: c}), '文字')}</div>
        {['bg', 'ol', 'sh'].map((key) => {
          const labels = {bg: '背景', ol: '描边', sh: '阴影'};
          const on = TC.enabled(st[key]);
          const v = effect(key);
          return <section className="stcard stcard--open text-effect" key={key} aria-label={labels[key]}>
            <div className="hd"><span className="grow">{labels[key]}</span>
              <Switch ariaLabel={labels[key]} on={on}
                onChange={next => { setPop(null); set({[key]: TC.toggleEffect(st[key], defaults[key], next)}); }} />
            </div>
            {on ? <div className="bd">
              <div className="text-control-row"><span>颜色</span>{color(key, v.color, (c) => change(key, {color: c}), labels[key])}</div>
              {key === 'bg' ? <>
                <div className="text-control-row"><span>范围</span><Segmented size="m" value={v.mode || 'wrap'}
                  items={[{k: 'wrap', label: '逐行'}, {k: 'block', label: '整块'}]} onChange={(mode) => change(key, {mode})} /></div>
                <ValueRow label="内边距" value={v.pad} min={0} max={40} unit="px" onChange={(pad) => change(key, {pad})} />
                <ValueRow label="圆角" value={v.r} min={0} max={40} unit="px" onChange={(r) => change(key, {r})} />
              </> : key === 'ol' ? <ValueRow label="粗细" value={v.w} min={0} max={12} step={0.5} unit="px" onChange={(w) => change(key, {w})} /> : <>
                <ValueRow label="距离" value={Math.round(v.dist * st.size)} min={0} max={80} unit="px" onChange={(n) => change(key, {dist: n / st.size})} />
                <ValueRow label="模糊" value={Math.round(v.blur * st.size)} min={0} max={80} unit="px" onChange={(n) => change(key, {blur: n / st.size})} />
                <ValueRow label="角度" value={v.rot} min={0} max={360} unit="°" onChange={(rot) => change(key, {rot})} />
                <ValueRow label="不透明度" value={Math.round((v.a == null ? 1 : v.a) * 100)} min={0} max={100} unit="%" onChange={(n) => change(key, {a: n / 100})} />
              </>}
            </div> : null}
          </section>;
        })}
        <p className="text-help">关闭效果会保留参数，随时可以重新开启。</p>
      </div>
    </>;
  }

  function TextAnimsView({ctx, id, peekId, anim, setAnim, onBack}) {
    const [slot, setSlot] = useState('in');
    const [autoPreview, setAutoPreview] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const replaying = !!(ctx.peek && ctx.peek.kind === 'anim' && ctx.peek.id === peekId && ctx.peek.manual);
    const segmentPlaying = !!(ctx.peek && ctx.peek.kind === 'segment' && ctx.peek.id === peekId);
    const cur = anim[slot] || {k: 'none'};
    const item = TP.find(slot, cur.k);
    const dur = TC.duration(slot, cur);
    const off = () => ctx.setPeek(null);
    useEffect(() => () => ctx.setPeek(null), [id]);
    const preview = (it, next, manual) => window.animPeekProps(ctx, peekId, {
      slot, k: it.k, dir: next.dir, dur: next.dur, targetId: id, label: it.name, manual, local: true,
    });
    const write = (next) => { off(); setAnim(Object.assign({}, anim, {[slot]: next})); };
    const span = window.animSpanOf(ctx, id);
    const occupied = (anim.in && anim.in.k !== 'none' ? TC.duration('in', anim.in) : 0)
      + (anim.out && anim.out.k !== 'none' ? TC.duration('out', anim.out) : 0);
    return <>
      <TextPanelHeader title="动画" onBack={onBack} />
      <div className="text-motion-fixed">
        <Segmented value={slot} onChange={key => { off(); setSlot(key); }}
          items={phases.map(p => ({k: p.k, label: `${p.label} · ${TP.find(p.k, (anim[p.k] || {}).k).name}`}))} />
        <div className="text-motion-settings" aria-label="当前动画设置">
          <div className="text-control-row"><b>{item.k === 'none' ? '选择一个' + phases.find((p) => p.k === slot).label + '效果' : item.name}</b>
            {item.k !== 'none' ? <Btn variant="secondary" size="s" icon={replaying ? 'pause' : 'play'}
              disabled={ctx.playing}
              onClick={() => {
                if (replaying) { off(); return; }
                preview(item, cur, true).onMouseEnter();
              }}>{replaying ? '停止预览' : '预览效果'}</Btn> : null}
          </div>
          {item.k !== 'none' ? <>
            <ValueRow label={slot === 'loop' ? '周期' : '时长'} value={dur} min={0.1} max={slot === 'loop' ? 6 : 3}
              step={0.1} unit="s" onChange={(v) => write({...cur, dur: Math.round(v * 10) / 10})} />
            {item.dirs ? <div className="text-control-row"><span>方向</span><Segmented value={cur.dir || item.dirs[0].k}
              size="s" items={item.dirs} onChange={(dir) => write({...cur, dir})} /></div>
              : <div className="text-duration-stops" aria-label="常用时长">
                {(slot === 'loop' ? [1, 2, 4] : [0.3, 0.6, 1]).map((v) => <BCAction key={v}
                  className={cx('chip', dur === v && 'is-on')} aria-pressed={dur === v}
                  onClick={() => write({...cur, dur: v})}>{v}s</BCAction>)}
                <span>{slot === 'loop' ? '越短越快' : '越短越利落'}</span>
              </div>}
          </> : <p className="text-help">先在下方挑选，再调整{slot === 'loop' ? '循环周期' : '时长和方向'}。</p>}
        </div>
        {occupied > span.end - span.start ? <p className="text-motion-warning">入场与出场发生重叠，出场优先。缩短时长可完整呈现两个效果。</p> : null}
        <div className="text-preview-option"><Checkbox on={autoPreview} label="悬停预览当前文字" onChange={next => { off(); setAutoPreview(next); }} /><span>Esc 退出</span></div>
        <p className="text-preview-help">{ctx.playing ? '播放中不触发悬停预览。' : '只播放当前效果，时间轴与其他画面保持不动。'}</p>
        <Btn variant="secondary" icon={segmentPlaying ? 'pause' : 'play'} style={{width: '100%'}}
          onClick={() => {
            if (segmentPlaying) { off(); return; }
            ctx.setPeek({kind: 'segment', id: peekId, manual: true, once: true,
              label: '播放此片段', win: {t0: span.start, t1: span.end}});
          }}>{segmentPlaying ? '停止片段播放' : '播放此片段'}</Btn>
        <p className="text-preview-help">检查与视频、字幕和声音的配合，结束后返回编辑位置。</p>
      </div>
      <div className="pscroll bc-scroll text-inspector text-motion-list" onScroll={() => { if (!segmentPlaying) off(); }}>
        <div className="agrid">
          {TP.ANIMS[slot].map((it) => {
            const next = TC.chooseAnimation(slot, it, cur);
            const pv = preview(it, next);
            return <BCAction key={it.k} className={cx('atile', cur.k === it.k && 'is-on')}
              aria-label={it.name} aria-pressed={cur.k === it.k}
              onMouseEnter={() => { if (autoPreview && !ctx.playing) pv.onMouseEnter(); }}
              onMouseLeave={() => { if (autoPreview && !ctx.playing) off(); }}
              onClick={() => write(next)}>
              <span className="atile__g"><AnimGlyph k={it.k} slot={slot} fam="text" />
                {cur.k === it.k ? <span className="text-tile-check"><Ic n="check" className="ic--12" /></span> : null}</span>
              <em>{it.name}</em>
            </BCAction>;
          })}
        </div>
        <p className="text-help">点击应用到当前文本。入场、出场和循环可分别设置。</p>
      </div>
    </>;
  }
  Object.assign(window, {TextStylesView, TextAnimsView});
})();
