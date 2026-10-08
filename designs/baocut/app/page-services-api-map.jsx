/* Web 服务 › OpenAI 兼容 API › 模型映射 —— §17.6（2026-09-27 第二版，设计稿 docs/design/cli/bcut-serve-openai-api-design.md §3）。
   请求里的 model 要么是本机模型 id，要么是这张表里的名字；都不是就 404 model_not_found。
   多对多：一个名字可以指向几只模型（每一类按顺序取第一只已下载的），一只模型也可以挂几个名字。
   目标写 `default:<能力>` 时跟着 设置 › 本地模型 里那一类的默认走。纯逻辑在 BC_OPENAI_API（mapRows / mapIssues / mapSummary）。 */
(function () {
  const {useState, useEffect} = React;
  const D = window.BC_DATA;
  const A = window.BC_OPENAI_API;

  function useMapCtx() {
    const app = useApp();
    const api = app.prefs.api || {};
    const rows = A.mapRows(api);
    const ctx = A.ctxOf(D.setModels, app.modelInstalled, app.prefs.localModelDefaults, api);
    const save = (next) => app.setPref('api', {...(app.prefs.api || {}), modelMap: next});
    return {app, api, rows, ctx, save};
  }

  function ApiModelMap() {
    const {app, rows, ctx, save} = useMapCtx();
    const issues = A.mapIssues(rows, ctx);
    const patch = (i, row) => save(rows.map((r, j) => (j === i ? row : r)));
    return (
      <>
        <div className="t-section svc__sec">模型映射</div>
        <p className="t-detail oai-lede">
          请求里的 <code>model</code> 要么是本机模型的 id，要么是下面的名字；都不是就返回 404。一个名字可以指向几只模型，每一类按顺序用第一只已下载的；同一只模型也可以挂好几个名字。
        </p>
        <Card layer className="oai-map">
          {rows.length ? rows.map((r, i) => (
            <MapRow key={i} row={r} issue={issues[i]} ctx={ctx}
              onChange={(row) => patch(i, row)} onDrop={() => save(rows.filter((_, j) => j !== i))} />
          )) : <p className="t-detail oai-map__empty">还没有映射。现在只有本机模型的 id 能用。</p>}
          <div className="row gap8 oai-map__foot">
            <Btn size="s" variant="secondary" icon="plus" onClick={() => save(rows.concat([{name: '', to: []}]))}>添加名字</Btn>
            <Btn size="s" variant="quiet" onClick={() => app.confirm({
              title: '恢复预置的映射？',
              body: '表里会换回 OpenAI 常用模型名指向各类默认模型的那几行，你加的行会被去掉。',
              confirmLabel: '恢复预置',
              run: () => { save(A.MAP_SEED.map((r) => ({name: r.name, to: r.to.slice()}))); app.toast('已恢复预置的映射', 'positive'); },
            })}>恢复预置</Btn>
          </div>
        </Card>
      </>
    );
  }

  /** 一行：名字框 → 目标 chip（有序，可删）+「添加模型」下拉；下面一行写这个名字在每一类实际落到哪只。 */
  function MapRow({row, issue, ctx, onChange, onDrop}) {
    const [draft, setDraft] = useState(row.name);
    useEffect(() => setDraft(row.name), [row.name]); // 删掉上面一行后 key 会挪位，跟着新行的名字走
    const [open, setOpen] = useState(false);
    const summary = issue ? null : A.mapSummary(row, ctx);
    const commit = () => { if (draft.trim() !== row.name) onChange({...row, name: draft.trim()}); };
    const add = (t) => { setOpen(false); if (row.to.indexOf(t) < 0) onChange({...row, to: row.to.concat([t])}); };
    return (
      <div className="oai-map__row">
        <div className="oai-map__line">
          <span className="oai-map__name">
            <Field size="s" value={draft} placeholder="比如 whisper-1" aria-label="请求里的模型名" invalid={!!(issue && issue.field === 'name')}
              onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          </span>
          <Ic n="fwd" className="ic--14 oai-map__arrow" />
          <span className="oai-map__to">
            {row.to.map((t) => {
              const tgt = A.targetInfo(t, ctx);
              return (
                <span key={t} className={cx('oai-tgt', !tgt.ready && 'is-missing')} title={tgt.sub}>
                  <span className="oai-tgt__cap">{tgt.capName}</span>{tgt.label}
                  <BCAction type="button" className="oai-tgt__x" aria-label={`去掉 ${tgt.label}`}
                    onClick={() => onChange({...row, to: row.to.filter((x) => x !== t)})}><Ic n="close" className="ic--14" /></BCAction>
                </span>
              );
            })}
            <Picker size="s" value="添加模型" open={open} popWidth={300} onClick={() => setOpen((x) => !x)} onClose={() => setOpen(false)} aria-label="添加目标模型">
              <Menu>
                {A.CAPS.map((c, ci) => (
                  <React.Fragment key={c.k}>
                    {ci ? <MenuRule /> : null}
                    <MenuHead>{c.name}</MenuHead>
                    {A.targetsOf(c.k, ctx).map((t) => (
                      <MenuItem key={t.id} label={t.label} sub={t.sub} check={row.to.indexOf(t.id) >= 0}
                        disabled={row.to.indexOf(t.id) >= 0} onClick={() => add(t.id)} />
                    ))}
                  </React.Fragment>
                ))}
              </Menu>
            </Picker>
          </span>
          <IconBtn icon="trash" size="s" tip={`删除 ${row.name || '这一行'}`} onClick={onDrop} />
        </div>
        <div className={cx('t-detail-xs oai-map__sum', issue && 'is-bad')}>
          {issue ? issue.text : summary.map((s, i) => (
            <span key={s.cap}>{i ? '；' : ''}{s.capName} → {s.model ? <b>{s.model.name}</b> : <span className="oai-map__miss">{s.why}</span>}</span>
          ))}
        </div>
      </div>
    );
  }

  Object.assign(window, {ApiModelMap});
})();
