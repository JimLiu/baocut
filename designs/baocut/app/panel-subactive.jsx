/* 字幕属性页「当前词」一段（2026-10-09，caption-style-model-design §4 / §9）。

   此前这一格是「字幕动画」一行：十九格目录里挑一格，颜色、念过的词、没念到的词、
   入场动作全捆在那一格里。现在拆成两段——这一段只管**正在念的那个词长什么样**，
   以及念过 / 没念到的词怎么处理；「怎么动」在下面的「动效」（panel-submotion.jsx）。

   每一格模式画的是**同一个 `WordLine`**（app/sub-wordline.jsx），涂装取这一条轨现在的那份：
   格子里看见的就是套上去画面上的样子。落笔走 `BC_CS.patchWord`——只回写词级那几件
   （`activeWord` ＋ 派生的 `wordAnim` / `activeColor` / `textMotion` / `wordBackground`），
   涂装一个键都不动。只在源语言轨上出现：词级时间戳只有它有。 */
(function () {
  const CS = window.BC_CS;
  const RSP = () => window.RSP;

  /** 换到某个模式时补齐那个模式必需的参数（颜色取这条轨现有的当前词色，退回文字色）。 */
  function modeDefaults(k, a, ln) {
    const color = a.color || (a.box && a.box.color) || ln.activeColor || ln.color;
    if (k === 'box') {
      const box = a.box || {color, radius: 0.2, padding: [0.2, 0.08]};
      return {mode: k, box, color: CS.inkOn(box.color)};
    }
    if (k === 'lift') return {mode: k, color, lift: a.lift || 0.22};
    if (k === 'scale') return {mode: k, color, scale: a.scale && a.scale > 1 ? a.scale : 1.15};
    if (k === 'sweep') return {mode: k, color, sweep: a.sweep || {unit: 'grapheme', guide: false, nextLine: false}};
    if (k === 'none') return {mode: k};
    return {mode: k, color};
  }

  /** 只留真的变了的键：`patchWord` 回的是词级那一整套，原样写进「仅这一条」的覆盖表会把
   *  没动过的几项也记成自定义（段头的「清除自定义」会出现在没改过的段上）。 */
  function changed(patch, ln) {
    const out = {};
    Object.keys(patch).forEach((k) => { if (JSON.stringify(patch[k]) !== JSON.stringify(ln[k] === undefined ? null : ln[k])) out[k] = patch[k]; });
    return out;
  }

  /** 单选一行：S2 RadioGroup 横排。 */
  function Choice({label, value, items, onChange, disabled}) {
    const R = RSP();
    return (
      <div className="subact__row">
        <span className="subprops__label">{label}</span>
        <R.RadioGroup aria-label={label} value={value} onChange={onChange} orientation="horizontal" size="S">
          {items.map((it) => <R.Radio key={it.k} value={it.k} isDisabled={disabled && disabled(it.k)}>{it.name}</R.Radio>)}
        </R.RadioGroup>
      </div>
    );
  }

  /** 一格模式：小样 ＋ 名字。小样跟共用节拍器走，与画廊同相位。 */
  function ModeCell({k, name, on, aw, ln, text, cur, cycle, onPick}) {
    const fz = 12;
    return (
      <BCAction className={cx('ancell', on && 'is-on')} aria-pressed={on} aria-label={name} onClick={onPick}>
        <span className={cx('ancell__f', ln.mono && 't-mono')}>
          <span className="subact__sample" style={window.paintCss(ln, fz)}>
            <window.WordLine text={text} aw={aw} cur={cur} cycle={cycle} still={window.subReduced}
              plate={window.plateCss(ln, fz)} />
          </span>
        </span>
        <span className="ancell__n">{name}</span>
      </BCAction>
    );
  }

  function SubActiveSection({ln, track, set, first, aside, action, pop, tg, setPop}) {
    const a = CS.normActive(ln.activeWord || CS.fromTrack(ln).activeWord);
    const text = window.sampleOf(track.lang, 'thumb');
    const n = window.BC_WA.split(text).length;
    const {cur, cycle} = window.useSubCycle(n, true);
    const put = (change, continuous) => set(changed(CS.patchWord(ln, {activeWord: change}), ln), continuous);
    const pick = (k) => put(Object.assign({}, a, modeDefaults(k, a, ln)));
    const isBox = a.mode === 'box';
    const colorOf = isBox ? a.box && a.box.color : a.color;
    const setColor = (c, live) => {
      if (isBox) put({box: Object.assign({}, a.box, {color: c}), color: CS.inkOn(c)}, live);
      else put(a.mode === 'none' ? {spokenColor: c} : {color: c}, live);
      if (!live) setPop(null);
    };
    const sweep = a.mode === 'sweep';
    const needsColor = a.mode !== 'none' || a.spoken === 'tint';
    return (
      <React.Fragment key="activeWord">
        <SecHead first={first} aside={aside} action={action}>当前词</SecHead>
        <div className="sec subact">
          <div className="angrid subact__grid" role="group" aria-label="当前词的样子">
            {CS.ACTIVE_MODES.map((m) => (
              <ModeCell key={m.k} k={m.k} name={m.name} on={a.mode === m.k} ln={ln} text={text} cur={cur} cycle={cycle}
                aw={Object.assign({}, a, modeDefaults(m.k, a, ln))} onPick={() => pick(m.k)} />
            ))}
          </div>
          {needsColor ? (
            <PRow label={isBox ? '底块颜色' : a.mode === 'none' ? '染色颜色' : '颜色'}>
              <ColorField value={colorOf || a.spokenColor || ln.color} scope="当前词" open={pop === 'active'}
                onToggle={() => tg('active')} onPick={setColor} inline />
            </PRow>
          ) : null}
          {a.mode !== 'none' && a.mode !== 'sweep' ? (
            <ValueRow label="放大" value={+(a.scale || 1).toFixed(2)} min={1} max={1.3} step={0.01} unit="倍"
              onChange={(v) => put({scale: v}, true)} />
          ) : null}
          {a.mode !== 'none' ? (
            <ValueRow label="过渡" value={+(a.durationSeconds || 0).toFixed(2)} min={0} max={0.6} step={0.02} unit="秒"
              onChange={(v) => put({durationSeconds: v}, true)} />
          ) : null}
          <Choice label="念过的词" value={a.spoken} items={CS.SPOKEN} onChange={(v) => put({spoken: v})}
            disabled={(k) => sweep && k === 'tint'} />
          <Choice label="没念到的词" value={a.unspoken} items={CS.UNSPOKEN} onChange={(v) => put({unspoken: v})} />
          {sweep ? (
            <>
              <Choice label="扫色" value={a.sweep.unit} items={[{k: 'grapheme', name: '按字'}, {k: 'word', name: '按词'}]}
                onChange={(v) => put({sweep: Object.assign({}, a.sweep, {unit: v})})} />
              <PRow label="引导点"><Switch ariaLabel="引导点" on={!!a.sweep.guide}
                onChange={(v) => put({sweep: Object.assign({}, a.sweep, {guide: v})})} /><span>在扫到的位置上方画一个点</span></PRow>
              <PRow label="预告下一句"><Switch ariaLabel="预告下一句" on={!!a.sweep.nextLine}
                onChange={(v) => put({sweep: Object.assign({}, a.sweep, {nextLine: v})})} /><span>在下面小一号显示下一句</span></PRow>
            </>
          ) : null}
        </div>
      </React.Fragment>
    );
  }

  Object.assign(window, {SubActiveSection, subPatchChanged: changed});
})();
