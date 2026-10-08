/* 设置 › 模型 › 用量（product-design §7.6）：时段、花费（按标价估算 / 提供方报告 / 未知分开，币种分开不换算）、统计格、
   按天的柱状图（按能力分色堆叠）、按 API 提供方 / 能力 / 模型 / 账号拆分；能查余额的 API 提供方（P1，演示数据）在顶部显示余额。
   只统计 API 提供方与智能体的调用，本机模型不计费、不进用量。路由 settings/<providerId>?sec=usage 只看这一家。 */
(function () {
  const {useState} = React;
  const V = () => window.BC_VENDORS;
  const U = () => window.BC_USAGE;
  let demo = null;
  /** 演示账本：这次打开里只生成一次，API 提供方详情的用量卡与这一页共用 */
  const usageDemo = () => (demo = demo || U().seedRecords(Date.now()));
  const CAP_CLASS = {text: 'is-text', transcribe: 'is-asr', tts: 'is-tts', image: 'is-image'};
  const SPLITS = [{k: 'byProvider', label: '按提供方'}, {k: 'byCapability', label: '按能力'}, {k: 'byModel', label: '按模型'}, {k: 'byAccount', label: '按账号'}];

  function Tile({label, value, sub}) {
    return <div className="use-tile"><span className="t-detail-xs">{label}</span><b>{value}</b>{sub ? <span className="t-detail-xs">{sub}</span> : null}</div>;
  }

  function Bars({days, total}) {
    const max = Math.max(1, ...days.map((d) => d.calls));
    const wide = days.length > 14;
    return <div className="use-chart" role="img" aria-label={`按天的调用次数，共 ${total} 次`}>
      <div className={cx('use-bars', wide && 'is-dense')}>
        {days.map((d) => <div className="use-bar" key={d.day} title={`${d.day} · ${d.calls} 次`}>
          <div className="use-bar__stack" style={{height: `${(d.calls / max) * 100}%`}}>
            {U().CAPS.filter((c) => d.byCapability[c]).map((c) => <span key={c} className={cx('use-seg', CAP_CLASS[c])} style={{flexGrow: d.byCapability[c]}} />)}
          </div>
        </div>)}
      </div>
      <div className="use-axis t-detail-xs"><span>{days[0] ? days[0].day.slice(5) : ''}</span><span>{days.length > 1 ? days[days.length - 1].day.slice(5) : ''}</span></div>
      <div className="use-legend t-detail-xs">{U().CAPS.map((c) => <span key={c}><i className={cx('use-seg', CAP_CLASS[c])} />{V().CAP_LABEL[c]}</span>)}</div>
    </div>;
  }

  /* 一行的花费：报告 / 估算 / 都有 / 未知分开写 */
  function costText(r) {
    if (r.costKind === 'none') return '—';
    if (r.costKind === 'unknown') return '费用未知';
    const est = U().fmtMoneyMap(Object.keys(r.est).length ? r.est : null);
    const rep = U().fmtMoneyMap(Object.keys(r.rep).length ? r.rep : null);
    return [rep ? `${rep} 报告` : '', est ? `≈ ${est}` : '', r.unknownCalls ? `另 ${r.unknownCalls} 次未知` : ''].filter(Boolean).join(' · ');
  }

  function UsageSection({id}) {
    const app = useApp();
    const [period, setPeriod] = useState('30d');
    const [split, setSplit] = useState('byProvider');
    const settings = app.providerSettings;
    const nameOf = (pid) => (pid === 'agent:codex' ? 'Codex（智能体）' : (V().resolve(pid, settings) || V().byId(pid) || {name: pid}).name);
    const accName = (pid, aid) => {
      if (!aid) return `${nameOf(pid)}`;
      const a = (app.providerAccounts[pid] || []).find((x) => x.accountId === aid);
      return `${nameOf(pid)} · ${a ? V().accountName(a) : '已移除的账号'}`;
    };
    const filter = id && (V().resolve(id, settings) || V().byId(id)) ? id : null;
    const rep = U().report(usageDemo(), period, {now: Date.now(), providerId: filter, names: nameOf, accountName: accName});
    const t = rep.totals;
    const est = U().fmtMoneyMap(t.cost.estimated);
    const reported = U().fmtMoneyMap(t.cost.reported);
    const balances = Object.keys(V().BALANCE_DEMO).filter((pid) => settings[pid] && V().connected(pid, settings, app.providerAccounts) && (!filter || filter === pid));
    const rows = rep[split];
    const top = Math.max(1, ...rows.map((r) => r.calls));
    const label = (r) => (split === 'byCapability' ? V().CAP_LABEL[r.key] : split === 'byModel' ? r.label : r.label);
    return <div className="use-page" data-screen-label="用量">
      <header className="use-head">
        <span className="use-head__t"><h1>用量</h1>
          <p>API 提供方与智能体的调用次数、用量与花费。本机模型不计费，不在这里。</p></span>
        <span className="use-head__cost">
          {est ? <Tip label={`按各家标价估算，标价可能过时。${t.cost.unknownCalls ? `另有 ${t.cost.unknownCalls} 次调用费用未知（智能体调用或没有标价的模型）。` : ''}`}>
            <span className="use-pill" tabIndex={0}>≈ {est} · 按标价估算{t.cost.unknownCalls ? ` · ${t.cost.unknownCalls} 次未知` : ''}</span>
          </Tip> : null}
          {reported ? <span className="use-pill">{reported} · 提供方报告</span> : null}
        </span>
      </header>
      <div className="use-bar-row">
        <Segmented size="s" value={period} onChange={setPeriod} items={U().PERIODS.map((p) => ({k: p.k, label: p.label}))} />
        {filter ? <Chip onClick={() => app.replace({r: 'settings', sec: 'usage'})} icon="close">只看 {nameOf(filter)}</Chip> : null}
      </div>
      {balances.length ? <div className="use-bal">
        {balances.map((pid) => { const b = V().BALANCE_DEMO[pid]; return <div className="use-bal__card" key={pid}>
          <span className="t-detail-xs">{nameOf(pid)} · 余额</span><b>{U().fmtMoney(b.amount, b.currency)}</b><span className="t-detail-xs">演示数据 · 刚刚查询</span></div>; })}
      </div> : null}
      {!t.calls ? <div className="use-empty"><b className="t-title-sm">还没有调用</b>
        <p className="t-detail">{filter ? `这段时间没有调用过 ${nameOf(filter)}。` : '这段时间没有调用过 API 提供方或智能体。用到它们的模型之后，次数与花费会出现在这里。'}</p></div> : <>
        <div className="use-tiles">
          <Tile label="调用" value={`${t.calls} 次`} sub={t.failed ? `${t.failed} 次失败` : '没有失败'} />
          <Tile label="文本 token" value={U().fmtCount((t.units.inputTokens || 0) + (t.units.outputTokens || 0))} sub={`${U().fmtCount(t.units.inputTokens)} 入 · ${U().fmtCount(t.units.outputTokens)} 出`} />
          <Tile label="音频" value={U().fmtMinutes(t.units.audioSeconds)} sub="语音识别" />
          <Tile label="字符" value={U().fmtCount(t.units.chars)} sub="语音合成" />
          <Tile label="图片" value={`${t.units.images || 0} 张`} sub="图像生成" />
        </div>
        <section className="setpage__group" aria-label="按天">
          <h2>按天</h2>
          <div className="setpage__card use-card"><Bars days={rep.byDay} total={t.calls} /></div>
        </section>
        <section className="setpage__group" aria-label="拆分">
          <div className="use-split-head"><h2>拆分</h2>
            <Segmented size="s" value={split} onChange={setSplit} items={SPLITS} /></div>
          <div className="setpage__card use-card" role="table" aria-label={SPLITS.find((x) => x.k === split).label}>
            <div className="use-row use-row--head t-detail-xs" role="row">
              <span role="columnheader">名称</span><span role="columnheader">调用</span><span role="columnheader">份额</span><span role="columnheader">用量</span><span role="columnheader">花费</span>
            </div>
            {rows.map((r) => <div className="use-row" role="row" key={r.key}>
              <span role="cell" className="use-row__nm">
                {split === 'byCapability' ? <i className={cx('use-seg', CAP_CLASS[r.key])} /> : null}
                {split === 'byProvider' && r.providerId !== 'agent:codex'
                  ? <window.BCAction className="use-row__link" onClick={() => app.replace({r: 'settings', sec: 'usage', id: r.providerId})}>{label(r)}</window.BCAction>
                  : <b>{label(r)}</b>}
                {split === 'byModel' ? <span className="t-detail-xs">{nameOf(r.providerId)}</span> : null}
              </span>
              <span role="cell" className="t-detail">{r.calls}{r.failed ? ` · ${r.failed} 失败` : ''}</span>
              <span role="cell" className="use-share" aria-label={`${Math.round((r.calls / t.calls) * 100)}%`}><span style={{width: `${(r.calls / top) * 100}%`}} /></span>
              <span role="cell" className="t-detail">{U().fmtUnits(r.units) || '—'}</span>
              <span role="cell" className={cx('t-detail', r.costKind === 'unknown' && 'use-row__unk')}>{costText(r)}</span>
            </div>)}
          </div>
          <p className="t-detail-xs use-note">≈ 是按各家标价估算的金额，标价可能过时；「报告」是提供方在响应里给出的金额；不同币种分别列出，不换算。</p>
        </section>
      </>}
    </div>;
  }

  Object.assign(window, {UsageSection, usageDemo});
})();
