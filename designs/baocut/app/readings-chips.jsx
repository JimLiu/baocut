/* 读音 chip（2026-09-23，docs/design/speech/bcut-tts-readings-design.md §5）——注音审阅页、生成语音的 chip 行、
   句属性页的「读音」行共用一套：chip 写 `行 háng`，点开弹候选读音（带调拼音 + 一个例词）。
   改过的标「已改」（绿），项目级读音命中的标「已记住」，这只引擎没按注音念的标橙（tip 写原因）。
   `readOnly`（Web 的句属性页：改读音会发起合成，是 AI 入口，§22）时只画不点。
   算的都在 model-readings.js（BC_READINGS），这里只画。 */
(function () {
  const {useState} = React;
  const RD = window.BC_READINGS;
  const SRC = {phrase: '词组表定的', dict: '词典默认', llm: '模型按上下文校对', user: '手动改的'};

  /** 一颗读音 chip。`plain` = 词组表命中的词：不算候选，画成句里的虚线下划线，点开同样能改 */
  function ReadingChip({r, edited, dropped, dropTip, readOnly, onPick, plain}) {
    const [open, setOpen] = useState(false);
    const py = RD.toneMark(r.reading);
    const tip = [`${r.surface} ${py}`, SRC[r.src] || '', r.remembered ? '视频里记住的读音' : '', dropped ? dropTip : ''].filter(Boolean).join(' · ');
    const tone = dropped ? 'notice' : edited ? 'positive' : null;
    const body = plain ? r.surface : (
      <>
        <b className="rdchip__s">{r.surface}</b>
        <span className="rdchip__py">{py}</span>
        {edited ? <span className="rdchip__mk">已改</span> : r.remembered ? <span className="rdchip__mk">已记住</span> : null}
      </>
    );
    const cls = cx('rdchip', plain && 'rdchip--plain', dropped && plain && 'rdchip--plaindrop');
    if (readOnly || !onPick) return <Chip tone={plain ? null : tone} className={cls} title={tip}>{body}</Chip>;
    return (
      <span className="rdpop">
        <Chip tone={plain ? null : tone} className={cls} on={open} title={tip} aria-haspopup="menu" aria-expanded={open}
          onClick={() => setOpen((v) => !v)}>{body}</Chip>
        <Popover open={open} onClose={() => setOpen(false)} width={200}>
          <Menu>
            <MenuHead>「{r.surface}」念</MenuHead>
            {RD.optionsOf(r).map((o) => (
              <MenuItem key={o.reading} label={RD.toneMark(o.reading)} sub={o.ex ? `如「${o.ex}」` : o.reading} on={o.reading === r.reading}
                onClick={() => { setOpen(false); if (o.reading !== r.reading) onPick(o.reading); }} />
            ))}
          </Menu>
        </Popover>
      </span>
    );
  }

  /** 句里就地画：普通字照写，候选字画成 chip，词组表命中的词画成虚线下划线（审阅页用） */
  function ReadingsLine({surface, readings, edited, dropped, engine, readOnly, onPick}) {
    const chars = Array.from(String(surface || ''));
    const list = (readings || []).slice().sort((a, b) => a.start - b.start);
    const out = [];
    let at = 0;
    list.forEach((r) => {
      if (r.start < at) return;
      if (r.start > at) out.push(<span key={'t' + at}>{chars.slice(at, r.start).join('')}</span>);
      out.push(<ReadingChip key={'r' + r.start} r={r} plain={!r.chip && !(edited && edited(r))} edited={!!(edited && edited(r))}
        dropped={RD.isDropped(r, dropped)} dropTip={RD.dropReason(engine)} readOnly={readOnly}
        onPick={onPick ? (v) => onPick(r, v) : null} />);
      at = r.end;
    });
    if (at < chars.length) out.push(<span key={'t' + at}>{chars.slice(at).join('')}</span>);
    return <div className="rdline">{out}</div>;
  }

  /** 一行 chip（生成语音的文字框下、句属性页的「读音」行）；`all` = 连词组表定的一起列 */
  function ReadingsRow({readings, all, edited, dropped, engine, readOnly, onPick, empty}) {
    const list = (readings || []).filter((r) => all || r.chip || (edited && edited(r)));
    if (!list.length) return <span className="t-detail dsro">{empty || '没有注音'}</span>;
    return (
      <div className="chiprow rdrow">
        {list.map((r) => (
          <ReadingChip key={r.start} r={r} edited={!!(edited && edited(r))} dropped={RD.isDropped(r, dropped)} dropTip={RD.dropReason(engine)}
            readOnly={readOnly} onPick={onPick ? (v) => onPick(r, v) : null} />
        ))}
      </div>
    );
  }

  /** 生成语音的「标注多音字」钮与 chip 行（§5.2）：只在文字含中文时出现；按下就地标出多音字（不翻页），
   *  再按一次重扫；文字改过之后 chip 行作废，生成时不用它。`f.readings` / `f.readingsBase` / `f.readingsFor`
   *  存在表单里，生成记录与「重新生成」都带着。
   *  2026-09-24：说清楚两步——词典先找，云端模型按上下文校对；第二行点名校对模型，没连 key 就写明「现在只按词典标」
   *  并给去连接的链接，用户不再猜为什么标出来的读音没经过校对。AI 入口：Web 不画（§22）。 */
  function TextReadings({f, set, engine, project}) {
    const app = useApp();
    if (!window.BC_SURFACE.ai || !RD.hasHan(RD.stripReadings(f.text))) return null;
    const llm = (window.BC_DATA.transModels || []).find((m) => m.dflt) || null;
    const ready = RD.llmReady(llm);
    const stale = RD.formStale(f);
    const scan = () => {
      const a = RD.annotate(f.text, {project, llm: ready});
      set({readings: a.readings, readingsBase: a.readings, readingsFor: f.text});
    };
    const base = f.readingsBase || [];
    const edited = (r) => { const b = base.find((x) => x.start === r.start); return !!b && b.reading !== r.reading; };
    const on = f.readings && !stale;
    const n = on ? f.readings.filter((r) => r.chip || edited(r)).length : 0;
    const toCloud = () => app.go({r: 'settings', sec: 'cloud'});
    return (
      <div className="rdbar">
        <div className="rdbar__hd">
          <Btn variant="secondary" size="s" icon="text" onClick={scan}>{f.readings ? '重新标注' : '标注多音字'}</Btn>
          <span className={cx('t-detail-xs grow', stale && 'rdbar__stale')}>
            {!f.readings ? '先按词典找出多音字，再由云端模型按上下文校对读音，你还能点字改'
              : stale ? '文字改过了 · 再按一次重扫，这次生成不带注音'
              : `${n} 处多音字 · ${RD.reviewSub(ready ? llm.name : false)}`}
          </span>
          {f.readings ? <BCAction className="viewall" onClick={() => set({readings: null, readingsBase: null, readingsFor: null})}>清掉</BCAction> : null}
        </div>
        <div className="rdbar__llm t-detail-xs">
          {ready
            ? <>模型校对：{llm.name} · {llm.provider} <BCAction className="viewall" onClick={toCloud}>换…</BCAction></>
            : <>模型校对要连一个云端模型的 API key · 现在只按词典标 <BCAction className="viewall" onClick={toCloud}>去连接 key</BCAction></>}
        </div>
        {on ? (
          <ReadingsRow readings={f.readings} edited={edited} dropped={RD.dropped(f.readings, engine)} engine={engine}
            onPick={(r, v) => set({readings: RD.setReading(f.readings, r.start, v)})} empty="没有要注音的多音字" />
        ) : null}
      </div>
    );
  }

  Object.assign(window, {ReadingChip, ReadingsLine, ReadingsRow, TextReadings});
})();
