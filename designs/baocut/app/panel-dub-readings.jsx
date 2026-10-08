/* 「注音」页（2026-09-23，docs/design/speech/bcut-tts-readings-design.md §5.1）——翻译配音里配成中文时的一步，
   在「对比时长」之后、「生成」之前；设置页的「合成前标注多音字」关掉就跳过。骨架与时长对比页相同（panel-dub-fit.jsx）。
   词典先标（词组表命中的词直接定读音、不算候选），剩下的语境多音字交模型按上下文校对（一次送约 20 句）；
   没有能用的模型时页面照出，全是词典默认，副题写「只按词典标了，没有模型校对 · 点字能改」。
   一句一行，候选字在句里画成 chip `行 háng`，点开换读音；改过的标「已改」。`全部采用` 把注记写进配音稿
   （每句的 `text` 就是带注记的文字）接着合成。只有多字表面词（人名、术语、词组）改过才记进项目读音，
   下次配音与生成语音先查它；单字只管这一句（设计稿 §4.3）。 */
(function () {
  const {useState, useEffect, useRef, useMemo} = React;
  const D = window.BC_DATA;
  const RD = window.BC_READINGS;
  const T = window.BC_TIME;

  function ReadingsRowCard({cue, a, base, engine, onPick}) {
    const sp = D.speakers[cue.sp] || {};
    const baseOf = (r) => base.find((x) => x.start === r.start);
    const edited = (r) => { const b = baseOf(r); return !!b && b.reading !== r.reading; };
    const cands = a.readings.filter((r) => r.chip || edited(r));
    const dropped = RD.dropped(a.readings, engine);
    const nEdit = a.readings.filter(edited).length;
    return (
      <div className={cx('fitr', nEdit && 'fitr--done')}>
        <div className="fitr__hd">
          <span className="t-mono t-detail-xs">{T.timecode(cue.start, {decimals: 0})}</span>
          <span className="spkdot" style={{background: `oklch(0.6 0.14 ${sp.hue || 222})`}} />
          <span className="t-detail-xs">{sp.name}</span>
          <span className="spacer" />
          {nEdit ? <Chip tone="positive">已改 {nEdit} 处</Chip> : cands.length ? <Chip>{cands.length} 处候选</Chip> : <Chip>没有候选</Chip>}
        </div>
        <div className="fitr__src">{cue.text}</div>
        <ReadingsLine surface={a.surface} readings={a.readings} edited={edited} dropped={dropped} engine={engine} onPick={onPick} />
      </div>
    );
  }

  function DubReadingsReview({cues, script, engine, engineName, llm, project, onApply, onSkip}) {
    const {fakeRun, Job} = window.BC_AIFLOWS;
    const ready = RD.llmReady(llm);
    const textOf = (c) => (script[c.id] != null ? String(script[c.id]) : (c.trans || c.text || ''));
    const base = useMemo(() => {
      const m = {};
      cues.forEach((c) => { m[c.id] = RD.annotate(textOf(c), {project, llm: ready}); });
      return m;
    }, [cues, script, project, ready]);   // eslint-disable-line react-hooks/exhaustive-deps
    const [cur, setCur] = useState(base);
    const [gen, setGen] = useState('run');       // run | done
    const [pct, setPct] = useState(0);
    const [only, setOnly] = useState(true);
    const timer = useRef(null);
    useEffect(() => {
      fakeRun(timer, setPct, ready ? 6 : 14, 50, () => setGen('done'));
      return () => clearInterval(timer.current);
    }, []);   // eslint-disable-line react-hooks/exhaustive-deps

    const all = cues.map((c) => ({c, a: cur[c.id]}));
    const withCands = all.filter(({a}) => a.readings.some((r) => r.chip));
    const nCand = withCands.reduce((n, {a}) => n + a.readings.filter((r) => r.chip).length, 0);
    const nPhrase = all.reduce((n, {a}) => n + a.readings.filter((r) => r.src === 'phrase').length, 0);
    const nLlm = all.reduce((n, {a}) => n + a.readings.filter((r) => r.src === 'llm').length, 0);
    const nAll = all.reduce((n, {a}) => n + a.readings.length, 0);
    const nDrop = all.reduce((n, {a}) => n + RD.dropped(a.readings, engine).length, 0);
    const edits = all.reduce((acc, {c, a}) => acc.concat(a.readings.filter((r) => {
      const b = base[c.id].readings.find((x) => x.start === r.start);
      return b && b.reading !== r.reading;
    })), []);
    const rows = only ? withCands : all;

    const pick = (id) => (r, reading) => setCur((m) => ({...m, [id]: {...m[id], readings: RD.setReading(m[id].readings, r.start, reading)}}));
    const apply = () => {
      const sc = {...script};
      all.forEach(({c, a}) => { if (a.readings.length) sc[c.id] = RD.render(a.surface, a.readings); });
      onApply(sc, RD.remember(project, edits));
    };

    return (
      <>
        <window.SecHead first aside={RD.reviewSub(ready ? llm.name : false)}>注音</window.SecHead>
        <div className="fitsum">
          <b>{cues.length} 句 · {nCand} 处多音字</b>
          <span>词组表定了 {nPhrase} 处{ready ? ` · 模型改了 ${nLlm} 处` : ''}</span>
          {nDrop ? <span className="fitsum__over">{nDrop} 处 {engineName} 念不了这个读音</span> : null}
        </div>

        {gen === 'run' ? (
          <Job title="标注多音字…" pct={pct} stages={ready ? ['词典判定', '模型校对'] : ['词典判定']} cur={ready && pct >= 30 ? 1 : 0}
            activity={ready && pct >= 30 ? `${llm.name} 看上下文 · 第 ${Math.max(1, Math.ceil(cues.length * (pct - 30) / 70 / 20))}/${Math.max(1, Math.ceil(cues.length / 20))} 批，一批 20 句`
              : `查词组表与语境多音字 · ${cues.length} 句`} />
        ) : (
          <>
            {!ready ? <div className="hint hint--tight rdnote">按词典标的，没有模型校对{llm && llm.note ? `（${llm.name} ${llm.note}）` : ''}。多音字都先按最常见的读音，读错的点开改。</div> : null}
            <div className="fitbar">
              <Segmented size="s" value={only ? 'cand' : 'all'} onChange={(k) => setOnly(k === 'cand')}
                items={[{k: 'cand', label: `有多音字的 ${withCands.length}`}, {k: 'all', label: `全部 ${cues.length}`}]} />
              <span className="spacer" />
              {edits.length ? <span className="t-detail-xs">已改 {edits.length} 处</span> : null}
            </div>
            <div className="fitlist">
              {rows.map(({c, a}) => (
                <ReadingsRowCard key={c.id} cue={c} a={a} base={base[c.id].readings} engine={engine} onPick={pick(c.id)} />
              ))}
              {!rows.length ? <div className="hint">这几句没有要注音的多音字。</div> : null}
            </div>
            <div className="flowcta flowcta--2">
              <Btn variant="secondary" onClick={onSkip}>不注音直接配音</Btn>
              <Btn variant="accent" onClick={apply}>全部采用{nAll ? ` · ${nAll} 处注音` : ''}</Btn>
            </div>
            <div className="hint">点字换读音；橙色的是 {engineName} 念不了的读音，合成时按原字念。改过的人名、术语这类多字词会记进这部视频，下次配音与生成语音先用它；单字只管这一句。</div>
          </>
        )}
      </>
    );
  }

  Object.assign(window, {DubReadingsReview});
})();
