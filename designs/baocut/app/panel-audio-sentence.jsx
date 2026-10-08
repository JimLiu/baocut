/* 音频 Tab · 「编辑配音句」属性页与「归档」组（2026-09-23，docs/design/speech/bcut-tts-sentence-takes-design.md §3.3–§3.4）。
   时间轴上每一条 TTS 轨（翻译配音、旁白）都是一个组，每一句合成过的每一版一个文件；这里给一句看它这一版的
   模型 / 声音 / 种子 / 语速，改了参数重新生成成新的一版，旧版进归档、随时换回。
   页头与「编辑视频」同形（第 83 轮标准）：返回图标钮 ＋ 左对齐标题 ＋ 右侧灰字；删除只在页脚。
   AI 入口（重新生成、改译文并重配）包在 `BC_SURFACE.ai` 里；看属性、试听、换回旧版 Web 也能做（§22）。
   「读音」一行（2026-09-23，docs/design/speech/bcut-tts-readings-design.md §5.3）：这一版用的注记按 chip 列出，改读音算进
   「用这些参数重新生成」；这只引擎没按注音念的标橙。Web 上只读（改读音会发起合成）。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const D = window.BC_DATA;
  const T = window.BC_TIME;
  const TTS = window.BC_TTS;
  const DUB = window.BC_DUB;
  const RD = window.BC_READINGS;
  const TL = window.BC_TL;
  const AUTO_RETRY = {indextts2: true, indextts25: true};   // 与 CLI 1.175.0 `--pace-retry` 缺省一致：IndexTTS2 / 2.5 开

  /** 可选的模型：所有引擎登记过的模型，去重，按引擎次序 */
  function modelOptions() {
    const out = [];
    TTS.ENGINES.forEach((e) => Object.keys(e.models || {}).forEach((k) => {
      const id = e.models[k];
      if (!out.some((m) => m.id === id)) out.push({id, engine: e.id, label: (TTS.MODELS[id] || {}).name || id, family: e.family || e.name});
    }));
    return out;
  }
  const modelName = (id) => (TTS.MODELS[id] || {}).name || id;
  const speakerOf = (d, b) => (b.sp && D.speakers[b.sp] ? D.speakers[b.sp].name : DUB.isNarration(d) ? '旁白' : '说话人');

  /** 演示用的确定性波形：按句 id 与版号变形，不随机 */
  function TakeWave({seedKey}) {
    const bars = [];
    let h = 0;
    for (const ch of String(seedKey)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    for (let i = 0; i < 40; i++) {
      const a = Math.abs(Math.sin((i + h % 7) / 2.3) * 0.55 + Math.sin((i + h % 11) / 6.1) * 0.45);
      bars.push(<rect key={i} x={i * 3} y={14 - a * 12} width="1.8" height={Math.max(1.5, a * 24)} rx="0.9" fill="var(--blue-800)" />);
    }
    return <svg width="120" height="28" viewBox="0 0 120 28">{bars}</svg>;
  }

  /** 预览：波形本身是试听钮（与音频卡同一枚 `.fthumb--btn`），一次只放一个 */
  function SentencePreview({d, b}) {
    const [t, setT] = useState(null);
    const timer = useRef(null);
    const dur = Math.max(0.1, b.end - b.start);
    useEffect(() => () => clearInterval(timer.current), []);
    useEffect(() => { clearInterval(timer.current); setT(null); }, [b.id, b.take]);
    const toggle = () => {
      if (t != null) { clearInterval(timer.current); setT(null); return; }
      setT(0);
      timer.current = setInterval(() => setT((v) => (v != null && v + 0.2 < dur ? v + 0.2 : (clearInterval(timer.current), null))), 200);
    };
    const c = window.stops(b.hue);
    const playing = t != null;
    return (
      <div className="dsprev">
        <BCAction className={cx('fthumb', 'fthumb--btn', 'dsprev__wave', playing && 'is-playing')} style={{background: 'var(--gray-75)'}}
          title={playing ? '暂停试听' : '试听这一句'} onClick={toggle}>
          <TakeWave seedKey={b.id + ':' + (b.take || 1)} />
          <span className="fthumb__play"><Ic n={playing ? 'pause' : 'play'} className="ic--14" /></span>
          {playing ? <span className="fthumb__prog"><i style={{width: Math.min(100, (t / dur) * 100) + '%'}} /></span> : null}
        </BCAction>
        <div className="dsprev__meta">
          <b>{T.timecode(b.start, {decimals: 1})} – {T.timecode(b.end, {decimals: 1})} · {dur.toFixed(1)} s{b.rate && b.rate !== 1 ? ` · ${b.rate.toFixed(2)}×` : ''}</b>
          <span><i className="dsprev__dot" style={{background: c.border}} />{speakerOf(d, b)} · <span className="tlang">{DUB.groupBadge(d, TL.languageBadge)}</span> {DUB.groupTitle(d)}</span>
        </div>
      </div>
    );
  }

  /** 一版一行：`第 k 版` ＋ 种子 · 模型 · 时长 · 偏差；当前版标「当前」，其余行尾「听」/「用这一版」 */
  function TakeRow({t, cur, pace, onListen, onUse}) {
    const line = DUB.versionLine(t, {ref: pace}).replace(/^第 \d+ 版 · /, '');
    return (
      <div className={cx('takerow', cur && 'is-cur')}>
        <b>第 {t.k} 版</b>
        <span className="takerow__ln">{line}</span>
        {cur ? <Chip>当前</Chip> : (
          <span className="takerow__act">
            <BCAction className="ccbtn" onClick={onListen}>听</BCAction>
            <BCAction className="ccbtn" onClick={onUse}>用这一版</BCAction>
          </span>
        )}
      </div>
    );
  }

  function DubSentenceProps({ctx, d, b, onBack}) {
    const app = useApp();
    const takes = DUB.takesOf(b, d);
    const cur = DUB.activeTake(b, d);
    const ref = DUB.paceReference(d.blocks, d);
    const idx = DUB.sentenceIndex(d.blocks, b.id);
    const queued = b.status === 'queued';
    const failed = b.status === 'failed';
    const [pop, setPop] = useState(false);
    const [draft, setDraft] = useState(null);           // 表单是草稿，只有「重新生成」把它变成一版
    const [spin, setSpin] = useState(0);                // 「换一颗」按了几次：种子确定地派生，不随机
    useEffect(() => { setDraft(null); setSpin(0); }, [b.id, cur ? cur.k : 0]);
    const baseModel = cur ? cur.model : DUB.groupModel(d);
    const form = draft || {model: baseModel, seed: cur ? cur.seed : DUB.demoSeed(b.id, 1), auto: !!AUTO_RETRY[DUB.engineOfModel(baseModel, d.engine)]};
    const setForm = (p) => setDraft({...form, ...p});
    const pace = DUB.paceText(cur, ref, DUB.groupLang(d));
    const mismatch = form.model !== DUB.groupModel(d);
    const options = modelOptions();
    const engine = DUB.engineOfModel(form.model, d.engine);
    /* 读音：这一版存的注记；草稿里改过的读音覆盖它，并按表单上的引擎重算哪几处念不了 */
    const rdBase = (cur && cur.readings) || b.readings || [];
    const rdList = (draft && draft.readings) || rdBase;
    const rdEdited = (r) => { const x = rdBase.find((y) => y.start === r.start); return !!x && x.reading !== r.reading; };
    const rdChanged = rdList.some(rdEdited);
    const showReadings = rdList.length > 0 || RD.needsReadings(DUB.groupLang(d));
    const changed = !!draft && (form.model !== baseModel || !!draft.seedSet || rdChanged);
    const regen = () => {
      // 读音改过：先把带注记的文字写进这一句的配音稿，重新生成读它
      if (rdChanged) ctx.updateDub(d.lang, (g) => ({script: {...(g.script || {}), [b.id]: RD.render(b.text, rdList)}}));
      // 缺省换一颗新种子（同一颗种子再合成一次没有意义）；用户在种子格里写过 / 按过「换一颗」才用指定的
      const take = {model: form.model, engine, seed: draft && draft.seedSet ? form.seed : undefined, auto: form.auto};
      ctx.regenDubBlocks(d.lang, [b.id], take);
      app.toast(`第 ${idx.i} 句重新生成中 · 完成后成为第 ${takes.length + 1} 版，这一版进归档`);
    };
    const use = (t) => {
      const was = cur ? cur.k : null;
      ctx.restoreDubTake(d.lang, b.id, t.k);
      app.toast(`第 ${idx.i} 句换回第 ${t.k} 版`, 'positive', was ? {label: '撤销', undo: true, run: () => ctx.restoreDubTake(d.lang, b.id, was)} : undefined);
    };
    const remove = () => {
      ctx.deleteDubBlocks(d.lang, [b.id]);
      app.toast(`已删除第 ${idx.i} 句配音 · 可撤销`, 'notice');
      onBack();
    };
    const when = cur && cur.at ? '刚才' : '这次配音';
    return (
      <>
        <div className="panelhd">
          <IconBtn icon="back" size="s" tip="返回音频" onClick={onBack} />
          <span className="t-title-sm grow">编辑配音句</span>
          <span className="t-detail-xs">第 {idx.i} / {idx.n} 句</span>
        </div>
        <div className="pscroll bc-scroll">
          {failed ? (
            <div className="hint hint--warn" style={{marginTop: 10}}>这一句没合成出来。下面改改参数再生成，或者就用整条的设置再试一次。</div>
          ) : <SentencePreview d={d} b={b} />}

          <window.SecHead aside={DUB.isNarration(d) ? '旁白稿' : '配音稿'}>{DUB.isNarration(d) ? '文字' : '译文'}</window.SecHead>
          <div className="dstext">{b.text}</div>
          {window.BC_SURFACE.ai && !DUB.isNarration(d) ? (
            <div className="txrow" style={{marginTop: 6}}>
              <BCAction className="tbtn" onClick={() => ctx.requestAi('dub', {lang: d.lang, ids: [b.id]})}><Ic n="edit" className="ic--16" />改译文并重配…</BCAction>
            </div>
          ) : null}
          {showReadings ? (
            <window.PRow label="读音">
              <window.ReadingsRow readings={rdList} all edited={rdEdited} dropped={RD.dropped(rdList, engine)} engine={engine}
                readOnly={!window.BC_SURFACE.ai} onPick={(r, v) => setForm({readings: RD.setReading(rdList, r.start, v)})} empty="没有注音" />
            </window.PRow>
          ) : null}

          <window.SecHead aside={cur ? `第 ${cur.k} 版 · ${when}` : '还没有版'}>这一版</window.SecHead>
          <window.PRow label="模型">
            {window.BC_SURFACE.ai ? (
              <Picker size="s" value={modelName(form.model)} open={pop} popWidth={240} onClick={() => setPop((v) => !v)} onClose={() => setPop(false)}>
                <Menu>
                  {options.map((m) => <MenuItem key={m.id} label={m.label} sub={m.family} on={m.id === form.model}
                    onClick={() => { setForm({model: m.id, auto: !!AUTO_RETRY[m.engine]}); setPop(false); }} />)}
                </Menu>
              </Picker>
            ) : <span className="t-detail dsro">{modelName(cur ? cur.model : form.model)}</span>}
          </window.PRow>
          {DUB.roleText(d) ? <window.PRow label="角色"><span className="t-detail dsro">{DUB.roleText(d)}</span></window.PRow> : null}
          <window.PRow label="声音"><span className="t-detail dsro">{DUB.isNarration(d) ? TTS.genSub(d.tts || {engine: d.engine, text: ''}) : `${d.engineName || d.engine} · ${DUB.voiceSummary(d, Object.keys(D.speakers || {}).length)}`}</span></window.PRow>
          <window.PRow label="种子">
            {window.BC_SURFACE.ai ? (
              <>
                <NumField value={form.seed} onChange={(v) => setForm({seed: Math.max(0, Math.round(v || 0)), seedSet: true})} step={1} min={0} max={999999} digits={0} tip="同一颗种子同一段文字念出来一样" />
                <BCAction className="ccbtn" onClick={() => { const n = spin + 1; setSpin(n); setForm({seed: DUB.demoSeed(b.id, takes.length + 1 + n), seedSet: true}); }}>换一颗</BCAction>
              </>
            ) : <span className="t-detail dsro">{cur ? cur.seed : '—'}</span>}
          </window.PRow>
          {cur ? (
            <window.PRow label="语速">
              <span className="t-detail dsro">{pace.text}</span>
              {pace.outlier ? <span className="agfile__st agfile__st--fast">离群</span> : null}
            </window.PRow>
          ) : null}
          {mismatch ? <div className="hint hint--warn">与整条用的 {modelName(DUB.groupModel(d))} 不同 · 音色可能不一致，语速也不比整条基准</div> : null}

          {window.BC_SURFACE.ai ? (
            <>
              <div className="flowcta" style={{marginTop: 12}}>
                <Btn variant="accent" style={{width: '100%'}} disabled={queued} onClick={regen}>{queued ? '生成中…' : failed ? '生成这一句' : changed ? '用这些参数重新生成' : '重新生成这一句'}</Btn>
              </div>
              <div className="dsauto">
                <Switch on={form.auto} onChange={(v) => setForm({auto: v})} ariaLabel="语速离群时自动多抽" />
                <span>{draft && draft.seedSet ? '用上面这颗种子' : '换一颗新种子'} · 语速离群时自动多抽 2 次留最接近的 · 旧版本进归档</span>
              </div>
            </>
          ) : <div className="hint">重新生成在 App 里做；这里能试听、换回旧版。</div>}

          <window.SecHead aside={takes.length ? `${takes.length} 版` : ''}>版</window.SecHead>
          {takes.length ? takes.slice().sort((x, y) => y.k - x.k).map((t) => (
            <TakeRow key={t.k} t={t} cur={cur && t.k === cur.k} pace={ref}
              onListen={() => app.toast(`试听第 ${idx.i} 句 · 第 ${t.k} 版`)} onUse={() => use(t)} />
          )) : <div className="hint hint--tight">合成出来之后这里一版一行。</div>}

          <window.SecHead>时间</window.SecHead>
          <window.PRow label="开始"><span className="t-detail dsro">{T.timecode(b.start, {decimals: 2})}</span></window.PRow>
          <window.PRow label="结束"><span className="t-detail dsro">{T.timecode(b.end, {decimals: 2})}</span></window.PRow>
          <window.PRow label="速率"><span className="t-detail dsro">{(b.rate || 1).toFixed(2)}×{b.manual ? ' · 手动拉过' : ''}</span></window.PRow>
          <div className="hint hint--tight">{DUB.isNarration(d) ? '旁白句跟着自己的合成时长走，后面的句顺延；' : '开始 = 原句开口；'}拖时间轴上块的右缘改时长。</div>

          <div className="dsfoot">
            <div className="dsauto"><Switch on={!!b.muted} onChange={(v) => ctx.muteDubBlocks(d.lang, [b.id], v)} ariaLabel="静音这一句" /><span>静音这一句</span></div>
            <Btn variant="negative" size="s" icon="trash" onClick={remove}>删除这一句</Btn>
          </div>
        </div>
      </>
    );
  }

  /* 归档组：所有语言组之后、散装文件之前；没有归档版时调用方不画。按语言分小段，每行一版，从新到旧。 */
  function DubArchiveGroup({ctx, shape, open, onToggle}) {
    const app = useApp();
    const [pop, setPop] = useState(false);
    const [ask, setAsk] = useState(null);
    const restore = (r) => {
      const d = (ctx.dubs || []).find((x) => x.lang === r.lang);
      const was = d ? DUB.activeK(d.blocks.find((b) => b.id === r.id), d) : null;
      ctx.restoreDubTake(r.lang, r.id, r.k);
      app.toast(`s-${r.seq} 换回第 ${r.k} 版 · 原来那版进归档`, 'positive', was ? {label: '撤销', undo: true, run: () => ctx.restoreDubTake(r.lang, r.id, was)} : undefined);
    };
    return (
      <section className="agroup agroup--archive" aria-label="归档">
        <div className="agroup__hd" role="button" tabIndex={0} onClick={onToggle} aria-expanded={open}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
          <Ic n={open ? 'chevdown' : 'chevright'} className="ic--12" />
          <Ic n="clock" className="ic--14" />
          <span className="agroup__nm">
            <b>归档</b>
            <span>{shape.line}</span>
          </span>
          <BCAction className="agroup__act" onClick={(e) => e.stopPropagation()}>
            <div style={{position: 'relative'}}>
              <IconBtn icon="more" size="s" tip="归档" onClick={() => setPop((v) => !v)} />
              <Popover open={pop} onClose={() => setPop(false)} align="right" dir="down" width={236}>
                <Menu>
                  <MenuItem icon="refresh" label={`只保留每句最近 ${shape.keep} 版`} sub="当前版永远保留" onClick={() => { setPop(false); ctx.pruneDubArchive(shape.keep); app.toast(`归档只留每句最近 ${shape.keep} 版`, 'positive'); }} />
                  <MenuRule />
                  <MenuItem icon="trash" label="清空归档" tone="negative" sub="删文件 · 不可撤销" onClick={() => { setPop(false); setAsk({title: '清空归档？', tone: 'negative', confirmLabel: '清空', body: `${shape.total} 个旧版本的文件会从磁盘删掉，每句只留当前版。这一步不能撤销。`}); }} />
                </Menu>
              </Popover>
            </div>
          </BCAction>
        </div>
        {open ? (
          <div className="agroup__body bc-scroll">
            {shape.groups.map((g) => (
              <div key={g.lang}>
                <div className="agarch__lang"><span className="tlang">{DUB.groupBadge((ctx.dubs || []).find((x) => x.lang === g.lang) || {lang: g.lang}, TL.languageBadge)}</span>{DUB.groupTitle((ctx.dubs || []).find((x) => x.lang === g.lang) || {lang: g.lang, langName: g.langName})}</div>
                {g.rows.map((r) => (
                  <div key={r.id + ':' + r.k} className="agfile agfile--take" title={r.text}>
                    <Ic n="wave" className="ic--12" />
                    <span className="agfile__nm">s-{r.seq} · 第 {r.k} 版</span>
                    <span className="agfile__tx">{r.text}</span>
                    <span className="agfile__ver">{r.line.replace(/^第 \d+ 版 · /, '')}</span>
                    <span className="agfile__act">
                      <BCAction className="ccbtn" onClick={() => app.toast(`试听 ${r.file}`)}>听</BCAction>
                      <BCAction className="ccbtn" onClick={() => restore(r)}>换回</BCAction>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : null}
        <ConfirmDialog ask={ask} onCancel={() => setAsk(null)} onConfirm={() => { setAsk(null); ctx.clearDubArchive(); app.toast('归档已清空', 'positive'); }} />
      </section>
    );
  }

  Object.assign(window, {DubSentenceProps, DubArchiveGroup});
})();
