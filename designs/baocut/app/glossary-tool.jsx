/* 术语库在项目里的露面 —— §15.10（2026-09-20，同日二次收口）。库本身在设置里
   （settings-glossary.jsx），项目这一侧的事都在这里：

   ① 设置态一行（`GlossaryOption`）：这一步用不用术语库、用哪几张表。润色用**转录术语表**，
      翻译用**方向对得上的翻译术语表**——选表下拉只列这一步用得上的那一种。翻译那一行还写明
      「本篇命中 N 条」：交给模型的只有程序在文稿里找到的那几条，不是整张表。
   ② 转录设置里的识别提示（`AsrHintBlock`）：按这只语音模型的能力，选转录术语表、写自定义提示词。
      新建向导与「重新转录」共用这一只。
   ③ 结果里的术语改动（`GlossaryFixes`）与候选回流（`GlossaryHarvest`）。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const G = window.BC_GLOSSARY;

  /** 这个项目在这一步启用的表与合并后的术语。`ctx = {kind, from, to}`。 */
  function useGlossary(projectId, ctx) {
    const app = useApp();
    const packs = app.glossary;
    const enabled = G.enabledFor(app.glossaryUse, projectId, packs);
    const merged = G.mergePacks(packs, enabled, ctx);
    /* 翻译要借转录表里记下的误识来判命中：文稿还没润色时，正文里写的可能是错的那个写法 */
    const asr = ctx.kind === 'trans' ? G.mergePacks(packs, enabled, {kind: 'asr', from: ctx.from}).terms : merged.terms;
    return {
      packs, ctx, enabled,
      usable: packs.filter((p) => G.packApplies(p, ctx)),
      on: merged.packs.map((p) => p.id),
      terms: merged.terms,
      conflicts: merged.conflicts,
      line: G.enabledLine(packs, enabled, ctx),
      hit: ctx.kind === 'trans' ? G.hitTerms(D.glossary.reviewParas, merged.terms, asr) : null,
      toggle: (id) => app.setGlossaryUse(projectId, G.toggle(enabled, id)),
      review: () => G.review(D.glossary.reviewParas, merged.terms),
      harvest: () => G.newTerms(D.glossary.candidates, merged.terms),
    };
  }

  /** 选表下拉：只列这一步用得上的表，可勾，末尾去设置管理。 */
  function PackPick({gl, disabled}) {
    const app = useApp();
    const [pop, setPop] = useState(false);
    return (
      <Picker size="s" value={gl.on.length ? `${gl.on.length} 张表` : '不用术语表'} open={pop} popWidth={280}
        disabled={disabled} onClick={() => setPop((v) => !v)} onClose={() => setPop(false)}>
        <Menu>
          {gl.usable.map((p) => (
            <MenuItem key={p.id} label={p.name} sub={`${G.pairLabel(p)} · ${(p.terms || []).length} 条`}
              on={gl.on.includes(p.id)} onClick={() => gl.toggle(p.id)} />
          ))}
          <MenuRule />
          <MenuItem icon="settings" label="管理术语库…" sub="加词 · 改译文 · 导入导出"
            onClick={() => { setPop(false); app.go({r: 'settings', sec: 'glossary'}); }} />
        </Menu>
      </Picker>
    );
  }

  /** 设置态里的术语行。`kind` 决定这一行说什么话：润色是「纠正」，翻译是「按术语表译」。 */
  function GlossaryOption({gl, on, onChange, kind}) {
    const app = useApp();
    const none = !gl.usable.length;
    const off = !gl.on.length;
    const label = kind === 'translate' ? '按翻译术语表译' : '按转录术语表纠正专有名词';
    const pair = kind === 'translate' ? `${G.langLabel(gl.ctx.from)} → ${G.langLabel(gl.ctx.to)}` : '';
    const sub = none
      ? (kind === 'translate' ? `还没有 ${pair} 的翻译术语表` : '还没有转录术语表')
      : off ? '这部视频没有启用术语表'
        : kind === 'translate'
          ? `${gl.line} · 本篇命中 ${gl.hit.hit.length} 条，只把命中的交给模型`
          : `${gl.line} · 按记下的误识逐处改回规范写法`;
    return (
      <div className="tsetup__row tsetup__row--opt gls-opt">
        <Checkbox on={on && !off} onChange={onChange} label={label} />
        <span className="t-detail-xs tsetup__optsub grow">{sub}</span>
        {none
          ? <BCAction className="tsetup__lnk" onClick={() => app.go({r: 'settings', sec: 'glossary'})}>去建一张</BCAction>
          : <PackPick gl={gl} />}
      </div>
    );
  }

  /** 翻译设置态里「命中了哪几条」的展开：让人看得见程序挑出来交给模型的到底是什么。 */
  function GlossaryHits({gl}) {
    const [open, setOpen] = useState(false);
    if (!gl.hit || !gl.hit.hit.length) return null;
    return (
      <div className="gls-hits">
        <BCAction className="gls-more" onClick={() => setOpen((v) => !v)}>
          <Ic n={open ? 'chevdown' : 'chevright'} className="ic--14" />
          看看命中的 {gl.hit.hit.length} 条（共 {gl.hit.total} 条）
        </BCAction>
        {open ? (
          <div className="gls-hits__list">
            {gl.hit.hit.map((t) => (
              <div className="gls-hits__row" key={t.id}>
                <b className="t-body-sm">{t.source}</b>
                <span aria-hidden="true">→</span>
                <span className="t-body-sm grow">{t.target}</span>
                {t.lock === false ? <Chip>可变通</Chip> : null}
                <span className="t-detail-xs">{t.count} 次</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  /* ---------- 结果：术语改动 ---------- */

  /** 把一段里的误识标成红删绿增——与润色 diff 同形，读法不用另学一套。 */
  function FixText({row}) {
    const parts = [];
    let cur = 0;
    row.spots.forEach((sp, i) => {
      if (sp.at > cur) parts.push(row.text.slice(cur, sp.at));
      parts.push(<span key={'d' + i} className="del">{sp.form}</span>);
      parts.push(<span key={'i' + i} className="ins">{sp.source}</span>);
      cur = sp.at + sp.len;
    });
    parts.push(row.text.slice(cur));
    return <>{parts}</>;
  }

  /** 术语改动列表：**一段一张卡**，段里所有术语的改动一起看、一起还原。 */
  function GlossaryFixes({rows, kept, onToggle}) {
    if (!rows.length) return null;
    return (
      <>
        <div className="signpost">
          术语改动单独列出来：它们不是模型的判断，是你在术语库里定下的规范写法。
        </div>
        {rows.map((r) => (
          <div key={r.id} className={cx('difc', kept[r.id] === false && 'is-rev')}>
            <div className="difh">
              <b>{r.label}</b>
              <Chip tone="info">术语</Chip>
              <span className="difsp">{r.packNames.join(' · ')}</span>
              {kept[r.id] === false ? <Chip>已还原</Chip> : null}
              <span className="spacer" />
              <div className="difacts">
                <BCAction className={cx('ccbtn', kept[r.id] !== false && 'ccbtn--revert')}
                  onClick={() => onToggle(r.id)}>
                  {kept[r.id] === false ? '重新应用' : '还原本段'}
                </BCAction>
              </div>
            </div>
            <div className="dift">
              {kept[r.id] === false ? r.text : <FixText row={r} />}
            </div>
            <div className="t-detail-xs gls-fix__n">
              {r.terms.map((t) => `${t.forms.join(' / ')} → ${t.source}`).join('，')}
            </div>
          </div>
        ))}
      </>
    );
  }

  /* ---------- 结果：候选回流 ---------- */

  /** 收一个候选词进某张表。收完立刻在库里可见，不用再去设置里补。 */
  function HarvestRow({cand, gl, onDone}) {
    const app = useApp();
    const [pop, setPop] = useState(false);
    const put = (pack) => {
      app.setGlossary((list) => list.map((p) => (p.id === pack.id
        ? {...p, updated: '刚刚', terms: [...p.terms, {id: 'gt' + Date.now(), source: cand.source, variants: []}]}
        : p)));
      setPop(false);
      onDone();
      app.toast(`已收进「${pack.name}」· 以后转录和润色都认得它`, 'positive');
    };
    return (
      <div className="gls-harv__row">
        <b className="t-ui t-strong">{cand.source}</b>
        <span className="t-detail-xs grow">出现 {cand.count} 次 · 「{cand.sample}」</span>
        <Picker size="s" value="收进…" open={pop} popWidth={240}
          onClick={() => setPop((v) => !v)} onClose={() => setPop(false)}>
          <Menu>
            {gl.packs.filter((p) => G.kindOf(p) === 'asr').map((p) => <MenuItem key={p.id} label={p.name} sub={`${G.pairLabel(p)} · ${(p.terms || []).length} 条`}
              onClick={() => put(p)} />)}
          </Menu>
        </Picker>
        <IconBtn icon="close" size="s" tip="这次不收" onClick={onDone} />
      </div>
    );
  }

  function GlossaryHarvest({gl}) {
    const [gone, setGone] = useState({});
    const list = gl.harvest().filter((c) => !gone[c.source]);
    if (!list.length) return null;
    return (
      <div className="gls-harv">
        <b>库里还没有的疑似专名 {list.length} 个</b>
        <span className="t-detail-xs">
          这一篇反复出现、但库里没记过的词。收一次，以后每部视频的转录和翻译都认得它。
        </span>
        {list.map((c) => (
          <HarvestRow key={c.source} cand={c} gl={gl} onDone={() => setGone((g) => ({...g, [c.source]: true}))} />
        ))}
      </div>
    );
  }

  /* ---------- 转录：识别提示 ---------- */

  /* 选哪几张转录术语表、要不要再写几句提示词——**两样都由这只语音模型的能力说了算**：
     没有提示通道的模型（MOSS 等）整块收成一句话，不给一个点了没用的控件。
     `value = {packs: [id…] | null, prompt: ''}`；`packs` 为 null = 还没动过，取「新视频默认用」的那几张。 */
  function AsrHintBlock({model, lang, value, onChange}) {
    const app = useApp();
    const [pop, setPop] = useState(false);
    const hint = G.asrHint(model.id);
    const ctx = {kind: 'asr', from: lang};
    const usable = app.glossary.filter((p) => G.packApplies(p, ctx));
    const picked = Array.isArray(value.packs) ? value.packs : usable.filter((p) => p.dflt).map((p) => p.id);
    const terms = G.mergePacks(app.glossary, picked, ctx).terms;
    const payload = G.hintCompose(value.prompt, terms, hint.budget);

    if (hint.kind === 'none') {
      return (
        <div className="gls-asr">
          <div className="t-label">识别提示</div>
          <div className="t-detail-xs">
            {model.name} 没有提示通道，术语表和提示词在这一步都用不上——转录完在「润色文稿」里按术语表纠正。
            想在转录时就用上，换 Whisper 或 Qwen3-ASR。
          </div>
        </div>
      );
    }
    return (
      <div className="gls-asr">
        <div className="gls-asr__row">
          <span className="t-label grow">术语表</span>
          {usable.length ? (
            <Picker size="s" value={picked.length ? `${picked.length} 张表 · ${terms.length} 条` : '不用术语表'} open={pop}
              popWidth={280} onClick={() => setPop((v) => !v)} onClose={() => setPop(false)}>
              <Menu>
                {usable.map((p) => (
                  <MenuItem key={p.id} label={p.name} sub={`${G.pairLabel(p)} · ${(p.terms || []).length} 条`}
                    on={picked.includes(p.id)} onClick={() => onChange({...value, packs: G.toggle(picked, p.id)})} />
                ))}
                <MenuRule />
                <MenuItem icon="settings" label="管理术语库…" sub="加词 · 导入导出"
                  onClick={() => { setPop(false); app.go({r: 'settings', sec: 'glossary'}); }} />
              </Menu>
            </Picker>
          ) : <BCAction className="tsetup__lnk" onClick={() => app.go({r: 'settings', sec: 'glossary'})}>去建一张</BCAction>}
        </div>
        <div className="t-label gls-asr__lb">自定义提示词</div>
        <Field area rows={2} value={value.prompt || ''} aria-label="自定义提示词"
          placeholder="可不填。例如：这是一期关于大模型推理优化的中文播客，主持人林澈，嘉宾周远。"
          onChange={(e) => onChange({...value, prompt: e.target.value})} />
        <div className="t-detail-xs gls-asr__how">{hint.how}</div>
        <div className={cx('t-detail-xs gls-asr__sum', (payload.over || payload.dropped) && 'gls-warn')}>
          {payload.over
            ? `提示词比 ${model.name} 吃得下的篇幅长了约 ${payload.over} 字，后面的会被截掉，术语也放不进去了。`
            : `送给 ${model.name}：${payload.custom ? `提示词 ${payload.custom} 字` : '没有提示词'} + ${payload.used} 个写法`
              + ` · 约 ${payload.chars} / ${hint.budget} 字`
              + (payload.dropped ? ` · 还有 ${payload.dropped} 条放不下，排在前面的表先进` : '')}
        </div>
      </div>
    );
  }

  Object.assign(window, {useGlossary, GlossaryOption, GlossaryHits, GlossaryFixes, GlossaryHarvest, AsrHintBlock});
})();
