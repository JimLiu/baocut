/* 字幕属性页「动效」一段（2026-10-09，caption-style-model-design §5 / §9）。

   三个阶段各挑一条：**入场**（出现时或念到时）、**退场**、**循环**。每一格画的是同一个
   `WordLine`，只挂这一格的那一段动效，涂装取这一条轨现在的那份——与画廊、画布同一段代码。
   选中一格之后下面四件可调：单位（整条 / 逐行 / 逐词 / 逐字）、触发（仅入场；译文轨没有
   「念到时」——词级时间戳只有源语言轨有）、时长、强弱。

   这一格就是十九格目录里「念到时入场」那几格的去处（落入 / 浮入 / 翻页 / 冲击…），
   格子的外观沿用那张网格（`.angrid` / `.ancell`）。落笔走 `BC_CS.patchWord`。 */
(function () {
  const {useState} = React;
  const CS = window.BC_CS;

  function MotionCell({stage, preset, name, on, ln, text, cycle, cur, isSrc, onPick}) {
    const fz = 12;
    const motion = preset ? {[stage]: CS.effect(stage, preset, isSrc ? null : {trigger: 'enter'})} : null;
    return (
      <BCAction className={cx('ancell', on && 'is-on')} aria-pressed={on} aria-label={name} onClick={onPick}>
        <span className={cx('ancell__f', ln.mono && 't-mono')}>
          <span className="subact__sample" style={window.paintCss(ln, fz)}>
            <window.WordLine text={text} aw={{mode: 'none'}} motion={motion} cur={cur} cycle={cycle}
              still={window.subReduced} plate={window.plateCss(ln, fz)} />
          </span>
        </span>
        <span className="ancell__n">{name}</span>
      </BCAction>
    );
  }

  function Choice({label, value, items, onChange, disabled}) {
    const R = window.RSP;
    return (
      <div className="subact__row">
        <span className="subprops__label">{label}</span>
        <R.RadioGroup aria-label={label} value={value} onChange={onChange} orientation="horizontal" size="S">
          {items.map((it) => <R.Radio key={it.k} value={it.k} isDisabled={disabled && disabled(it.k)}>{it.name}</R.Radio>)}
        </R.RadioGroup>
      </div>
    );
  }

  function SubMotionSection({ln, track, set, first, aside, action}) {
    const [stage, setStage] = useState('in');
    const isSrc = track.role === 'source' || !track.role;
    const motion = ln.motion !== undefined ? ln.motion : CS.fromTrack(ln).motion;
    const m = motion || {};
    const e = m[stage] || null;
    const text = window.sampleOf(track.lang, 'thumb');
    const n = window.BC_WA.split(text).length;
    const {cur, cycle} = window.useSubCycle(n, true);
    const write = (next, continuous) => {
      const clean = {};
      CS.STAGES.forEach(({k}) => { if (next[k]) clean[k] = next[k]; });
      set(window.subPatchChanged(CS.patchWord(ln, {motion: CS.hasMotion(clean) ? clean : null}), ln), continuous);
    };
    const pick = (k) => write(Object.assign({}, m, {[stage]: k ? CS.effect(stage, k, isSrc ? null : {trigger: 'enter'}) : null}));
    const tune = (patch, continuous) => write(Object.assign({}, m, {[stage]: Object.assign({}, e, patch)}), continuous);
    const stageName = (k) => CS.STAGES.find((s) => s.k === k).name;
    return (
      <React.Fragment key="motion">
        <SecHead first={first} aside={aside} action={action}>动效</SecHead>
        <div className="sec subact">
          <Segmented size="s" value={stage} onChange={setStage}
            items={CS.STAGES.map((s) => ({k: s.k, label: s.name + (m[s.k] && CS.motionPreset(s.k, m[s.k].preset) ? ' · ' + CS.motionPreset(s.k, m[s.k].preset).name : '')}))} />
          <div className="angrid subact__grid" role="group" aria-label={stageName(stage) + '动效'}>
            <MotionCell stage={stage} preset={null} name="无" on={!e} ln={ln} text={text} cur={cur} cycle={cycle}
              isSrc={isSrc} onPick={() => pick(null)} />
            {CS.MOTION_PRESETS[stage].map((p) => (
              <MotionCell key={p.k} stage={stage} preset={p.k} name={p.name} on={!!e && e.preset === p.k} ln={ln}
                text={text} cur={cur} cycle={cycle} isSrc={isSrc} onPick={() => pick(p.k)} />
            ))}
          </div>
          {e ? (
            <>
              <Choice label="单位" value={e.unit} items={CS.UNITS} onChange={(v) => tune({unit: v})} />
              {stage === 'in' ? (
                <Choice label="触发" value={isSrc ? e.trigger : 'enter'} items={CS.TRIGGERS}
                  onChange={(v) => tune({trigger: v})} disabled={(k) => !isSrc && k === 'spoken'} />
              ) : null}
              <ValueRow label="时长" value={+(e.durationSeconds || 0).toFixed(2)} min={0.02} max={stage === 'loop' ? 3 : 1.2}
                step={0.02} unit="秒" onChange={(v) => tune({durationSeconds: v}, true)} />
              <ValueRow label="强弱" value={Math.round((e.intensity == null ? 1 : e.intensity) * 100)} min={0} max={150}
                step={5} unit="%" onChange={(v) => tune({intensity: v / 100}, true)} />
            </>
          ) : <p className="hint">{stage === 'out' ? '这一句结束时直接消失。' : stage === 'loop' ? '字幕在画面上时保持静止。' : '整句直接出现。'}</p>}
        </div>
      </React.Fragment>
    );
  }

  Object.assign(window, {SubMotionSection});
})();
