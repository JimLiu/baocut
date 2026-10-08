/* 「时长对比」页（§15.6，2026-09-11 建、2026-09-13 改版）——翻译配音里可选的一步。
   每句两条对比条：原声这句多长（灰）、译文按语速库预计念多长（绿；长过槽位换橙），顶上一行汇总
   「译文预计 3 分 12 秒 · 比原声长 14% · 6 句装不下」。
   先用语速库（BC_TTS.paceFor：这只模型念这门语言一分钟多少字 / 词）算每句「装不装得下」：
   ok ≤ 1.0× · tight ≤ 1.35×（不用改）· over > 1.35×（要缩写）· retranslate > 1.8×（建议重译）。
   装不下的句交 LLM（提示词见配音设计稿 §11：不改原意、按预算字数缩写；差得太多就整句重译），
   结果逐句摆出来：原文 / 现译文（橙语速角标）/ 建议文（绿角标），采用、保留或自己改一遍；
   改过的字进「配音稿」（稀疏覆盖：只有改过的句），默认**不写回字幕译文**——字幕仍是完整译文，
   配音念的是短版；勾「也写回字幕译文」才两边一起改。 */
(function () {
  const {useState, useEffect, useRef, useMemo} = React;
  const D = window.BC_DATA;
  const TTS = window.BC_TTS;
  const DUB = window.BC_DUB;
  const T = window.BC_TIME;

  const LEVEL = {
    ok: {label: '装得下', tone: null},
    tight: {label: '略压', tone: null},
    over: {label: '要缩写', tone: 'notice'},
    retranslate: {label: '建议重译', tone: 'negative'},
  };

  function RateChip({rate, level}) {
    const cls = level === 'over' || level === 'retranslate' ? 'fitr__rate fitr__rate--over' : rate > 1 ? 'fitr__rate fitr__rate--tight' : 'fitr__rate fitr__rate--ok';
    return <span className={cls}>{rate.toFixed(2)}×</span>;
  }

  /** 两条对比条：原声这句的时长 vs 译文预计念多长；改过稿就按新稿重算 */
  function CompareBars({row, shown}) {
    const pred = shown !== row ? +((shown.units / Math.max(1, row.units || 1)) * row.predDur).toFixed(2) : row.predDur;
    const w = DUB.barWidths({srcDur: row.srcDur, predDur: pred});
    const over = pred > row.limit;
    return (
      <div className="cmpbar">
        <div className="cmpbar__row">
          <span className="cmpbar__k">原声</span>
          <span className="cmpbar__tr"><span className="cmpbar__b cmpbar__b--src" style={{width: w.src + '%'}} /></span>
          <span className="t-mono t-detail-xs">{row.srcDur.toFixed(1)} s</span>
        </div>
        <div className="cmpbar__row">
          <span className="cmpbar__k">译文</span>
          <span className="cmpbar__tr"><span className={cx('cmpbar__b', over ? 'cmpbar__b--over' : 'cmpbar__b--pred')} style={{width: w.pred + '%'}} /></span>
          <span className="t-mono t-detail-xs">{pred.toFixed(1)} s</span>
        </div>
      </div>
    );
  }

  /** 一句：原文 / 两条对比条 / 现译文 / 建议文；`sugg` 为空就没有建议行 */
  function FitRow({row, sugg, state, pace, lang, onAccept, onKeep, onEdit}) {
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState('');
    const sp = D.speakers[row.sp] || {};
    const lv = LEVEL[row.level] || LEVEL.ok;
    // 采用建议 / 自己改过 → 这一行念的是新稿；否则还是现译文
    const eff = state && state.text != null ? state.text : state && state.accepted && sugg ? sugg.text : null;
    const shown = eff != null ? TTS.replanRow(row, eff, pace, lang) : row;
    const startEdit = () => { setText(shown.text); setEditing(true); };
    const commit = () => { setEditing(false); if (text.trim() && text.trim() !== shown.text) onEdit(text.trim()); };
    return (
      <div className={cx('fitr', (row.level === 'over' || row.level === 'retranslate') && 'fitr--over', state && state.accepted && 'fitr--done')}>
        <div className="fitr__hd">
          <span className="t-mono t-detail-xs">{T.timecode(row.start, {decimals: 0})}</span>
          <span className="spkdot" style={{background: `oklch(0.6 0.14 ${sp.hue || 222})`}} />
          <span className="t-detail-xs">{sp.name}</span>
          <span className="t-detail-xs">· 槽位 {row.limit.toFixed(1)} s · 预算 {row.budget} {TTS.unitName(TTS.paceUnit(lang))}</span>
          <span className="spacer" />
          {state && state.accepted ? <Chip tone="positive">已采用</Chip> : state && state.text != null ? <Chip tone="positive">已改</Chip> : <Chip tone={lv.tone}>{lv.label}</Chip>}
        </div>
        <div className="fitr__src">{row.source}</div>
        <CompareBars row={row} shown={shown} />
        <div className="fitr__line">
          <span className="fitr__k">{eff != null ? '配音稿' : '现译文'}</span>
          {editing ? (
            <Field area size="s" className="grow" value={text} onChange={(e) => setText(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); } if (e.key === 'Escape') setEditing(false); }}
              onBlur={commit} />
          ) : <span className="grow fitr__t" onDoubleClick={startEdit}>{shown.text}</span>}
          <RateChip rate={shown.rate} level={shown.level} />
          <span className="t-detail-xs">{shown.units} {TTS.unitName(TTS.paceUnit(lang))}</span>
          {!editing ? <IconBtn icon="edit" size="xs" tip="自己改一遍 · 双击文字也行" onClick={startEdit} /> : null}
        </div>
        {eff != null && !editing ? (
          <div className="fitr__was">原译 · {row.text}<BCAction type="button" className="fitr__undo" onClick={onKeep}>改回原译</BCAction></div>
        ) : null}
        {sugg && !(state && (state.accepted || state.text != null)) ? (
          <div className="fitr__line fitr__line--sugg">
            <span className="fitr__k">{sugg.kind === 'retranslate' ? '重译' : '缩写'}</span>
            <span className="grow fitr__t">{sugg.text}</span>
            <RateChip rate={sugg.rate} level={sugg.rate > TTS.MAX_RATE ? 'over' : 'ok'} />
            <span className="t-detail-xs">{sugg.units} {TTS.unitName(TTS.paceUnit(lang))}</span>
            <Btn variant="accent" size="s" onClick={onAccept}>采用</Btn>
            <Btn variant="secondary" size="s" onClick={onKeep}>保留原译</Btn>
          </div>
        ) : null}
      </div>
    );
  }

  function DubFitReview({ctx, cues, lang, langName, pace, model, script, onApply, onSkip}) {
    const app = useApp();
    const {fakeRun, Job} = window.BC_AIFLOWS;
    const plan = useMemo(() => DUB.compareRows(cues, {pace, lang, script}), [cues, pace, lang, script]);
    const sum = DUB.compareSummary(plan);
    const need = plan.rows.filter((r) => r.level === 'over' || r.level === 'retranslate');
    const [gen, setGen] = useState(need.length ? 'run' : 'done');   // run | done
    const [pct, setPct] = useState(0);
    const [sugg, setSugg] = useState({});             // id → {text, kind, units, rate}
    const [st, setSt] = useState({});                 // id → {accepted, text}
    const [onlyOver, setOnlyOver] = useState(need.length > 0);
    const [writeBack, setWriteBack] = useState(false);
    const timer = useRef(null);
    useEffect(() => {
      if (gen !== 'run') return undefined;
      fakeRun(timer, setPct, 4, 60, () => {
        const m = {};
        need.forEach((r) => { const s = TTS.demoRewrite(r, lang, pace); if (s) m[r.id] = s; });
        setSugg(m); setGen('done');
      });
      return () => clearInterval(timer.current);
    }, [gen]);

    const rows = onlyOver ? need : plan.rows;
    const pending = need.filter((r) => !(st[r.id] && (st[r.id].accepted || st[r.id].kept || st[r.id].text != null)));
    const scriptOut = () => {
      const out = {...script};
      Object.keys(st).forEach((id) => {
        if (st[id].text != null) out[id] = st[id].text;
        else if (st[id].accepted && sugg[id]) out[id] = sugg[id].text;
      });
      return out;
    };
    const acceptAll = () => {
      const n = {...st};
      need.forEach((r) => { if (sugg[r.id] && !(n[r.id] && n[r.id].text != null)) n[r.id] = {...(n[r.id] || {}), accepted: true, kept: false}; });
      setSt(n);
    };
    const apply = () => {
      const sc = scriptOut();
      const n = Object.keys(sc).length;
      if (writeBack && n) app.toast(`${n} 句译文已同步写回「${langName}」字幕轨`, 'positive');
      onApply(sc);
    };

    return (
      <>
        <window.SecHead first aside={TTS.paceLine(pace, lang)}>时长对比</window.SecHead>
        <div className="fitsum">
          <b>原声 {DUB.mmss(sum.srcTotal)}</b>
          <span>{DUB.compareLine(sum)}</span>
        </div>
        <div className="fitsum">
          <span>{plan.total} 句 · {plan.ok} 句装得下</span>
          {plan.over ? <span className="fitsum__over">{plan.over} 句要缩写</span> : null}
          {plan.retranslate ? <span className="fitsum__over">{plan.retranslate} 句建议重译</span> : null}
          {!need.length ? <span>每句按中位语速都装得下，直接配就行。</span> : null}
        </div>

        {gen === 'run' ? (
          <Job title="对比时长并整理译文…" pct={pct} stages={['逐句估时长', 'AI 缩写 / 重译']} cur={pct < 25 ? 0 : 1}
            activity={pct < 25 ? `按「${langName}」语速估 ${plan.total} 句` : `整理第 ${Math.max(1, Math.min(need.length, Math.round(need.length * (pct - 25) / 75)))}/${need.length} 句 · 不改原意`} />
        ) : (
          <>
            <div className="fitbar">
              <Segmented size="s" value={onlyOver ? 'over' : 'all'} onChange={(k) => setOnlyOver(k === 'over')}
                items={[{k: 'over', label: `只看差得远的 ${need.length}`}, {k: 'all', label: `全部 ${plan.total}`}]} />
              <span className="spacer" />
              {need.length ? <Btn variant="secondary" size="s" disabled={!pending.length} onClick={acceptAll}>全部采用 AI 稿</Btn> : null}
            </div>
            <div className="fitlist">
              {rows.map((r) => (
                <FitRow key={r.id} row={r} sugg={sugg[r.id]} state={st[r.id]} pace={pace} lang={lang}
                  onAccept={() => setSt((s) => ({...s, [r.id]: {accepted: true}}))}
                  onKeep={() => setSt((s) => ({...s, [r.id]: {kept: true}}))}
                  onEdit={(text) => setSt((s) => ({...s, [r.id]: {text}}))} />
              ))}
              {!rows.length ? <div className="hint">没有差得远的句。</div> : null}
            </div>
            <div className="tsetup__rows">
              <div className="tsetup__row">
                <Checkbox on={writeBack} onChange={setWriteBack} label="也写回字幕译文" />
                <span className="t-detail-xs">默认只改配音念的稿，字幕仍是完整译文</span>
              </div>
            </div>
            <div className="flowcta flowcta--2">
              <Btn variant="secondary" onClick={onSkip}>不改译文直接配音</Btn>
              <Btn variant="accent" onClick={apply}>
                {pending.length ? `按现状配音 · ${need.length - pending.length}/${need.length} 句已处理` : `采用并开始配音`}
              </Btn>
            </div>
            <div className="hint">每句都能双击自己改，改完两条对比条立刻重算；采用的句子只进配音稿，「重新生成」时这份稿还在。语速库会在这次合成后按实测更新一次（{TTS.PACE_PATH}）。</div>
          </>
        )}
      </>
    );
  }

  Object.assign(window, {DubFitReview});
})();
