/* 工具 › 素材处理的任务队列（右栏，product-design §2.7「进度与失败」「结果与下一步」）：六个工具共用一条。
   进行中说做到第几帧、还要多久；做完写实际用的引擎、流程的提醒（退回 deshake、插帧重影、慢动作没声音、不可商用、没认出主体）与产物。
   一次可能写出好几个文件（多个输入、分轨的每一轨）：产物一行一个，点开才是完整的产物行，免得窄栏里堆成一长条。 */
(function () {
  const {useState} = React;
  const F = window.BC_FOOTAGE;
  const Q = window.BC_FOOTAGE_QUEUE;
  const SD = window.BC_SAVE_DIR;

  function Outputs({r}) {
    const list = r.entries;
    const [open, setOpen] = useState(list.length === 1 ? list[0].id : null);
    if (list.length === 1) return <window.ToolOutputRow entry={list[0]} fromTool={r.form.id} compact />;
    return <div className="fg__outs">
      <span className="t-detail-xs">{list.length} 个文件 · 保存在 {SD.label(r.saveDir || SD.DEFAULT)}</span>
      {list.map((e) => open === e.id ? <window.ToolOutputRow key={e.id} entry={e} fromTool={r.form.id} compact />
        : <BCAction key={e.id} className="fg__out" onClick={() => setOpen(e.id)}>
          <Ic n={e.kind === 'audio' ? 'wave' : e.kind === 'image' ? 'image' : 'film'} className="ic--16" />
          <span className="t-truncate grow">{e.name}</span>
          <NavChevron />
        </BCAction>)}
    </div>;
  }

  /** 进行中的一行：按帧的说第几帧；分轨一次处理一个文件，中途没有进度，只说做到第几步（同实现）。还要多久按估算的中间值（交互演示几秒跑完，不是实际耗时） */
  function progressLine(r) {
    if (F.opById(r.form.id).op === 'separate') return '分离 · 第 2/3 步';
    const left = (1 - r.pct / 100) * ((r.work.seconds[0] + r.work.seconds[1]) / 2);
    const done = (total) => F.count((total * r.pct) / 100);
    const head = r.work.hasVideo ? `${done(r.work.outFrames)} / ${F.count(r.work.outFrames)} 帧` : `${r.pct}%`;
    return `${r.phase || '处理'} · ${head} · 还要${F.remainText(left)}`;
  }

  function JobCard({r}) {
    const app = useApp();
    const o = F.opById(r.form.id);
    const state = {done: '刚刚', running: '进行中', queued: '排队中', canceled: '已取消', error: '失败'}[r.status];
    return <div className={cx('vrec', r.status === 'running' && 'is-running', r.status === 'error' && 'is-bad', r.status === 'canceled' && 'is-off')}>
      <div className="vrec__hd">
        <Ic n={o.ic} className="ic--16 vrec__ic" />
        <b className="t-title-sm t-truncate grow">{r.title}</b>
        <span className="t-detail-xs">{state}</span>
      </div>
      <span className="t-detail-xs">{o.name} · {F.jobMeta(r)}</span>
      {r.status === 'running' ? <div className="vrec__busy">
        <div className="row gap8"><span className="t-detail-xs grow">{progressLine(r)}</span><Btn variant="quiet" size="s" onClick={() => Q.cancel(app, r)}>取消</Btn></div>
        <Progress value={r.pct} indeterminate={o.op === 'separate'} thin />
      </div> : null}
      {r.status === 'queued' ? <div className="row gap8"><span className="t-detail-xs grow">本机一次跑一条 · 预计{F.etaText(r.work.seconds)}</span><Btn variant="quiet" size="s" onClick={() => Q.cancel(app, r)}>取消</Btn></div> : null}
      {r.status === 'canceled' ? <div className="row gap8"><span className="t-detail-xs grow">没有产出文件</span><Btn variant="quiet" size="s" icon="refresh" onClick={() => Q.requeue(app, r)}>重新排队</Btn></div> : null}
      {r.status === 'done' ? <>
        <div className="vrec__sum"><b className="t-title-sm">{r.executor}</b></div>
        {r.warnings.map((w) => <div key={w} className="hint hint--warn vrec__over">{w}</div>)}
        <Outputs r={r} />
      </> : null}
      {r.status === 'error' ? <div className="vfail">
        <b className="t-title-sm">{r.fail.title}</b>
        <span className="t-detail">{r.fail.line}</span>
        <code className="vfail__ev t-mono">{r.fail.evidence}</code>
        <div className="vrec__acts">
          <Btn variant="accent" size="s" icon="refresh" onClick={() => Q.requeue(app, r)}>再试一次</Btn>
          <Btn variant="quiet" size="s" onClick={() => Q.drop(r.id)}>删除这条记录</Btn>
          <span className="t-detail-xs t-mono">{r.fail.code}</span>
        </div>
      </div> : null}
    </div>;
  }

  function FootageJobList() {
    const s = Q.useStore();
    const busy = s.list.filter((r) => r.status === 'running' || r.status === 'queued').length;
    return <aside className="vw__side">
      <div className="vw__sidehd">
        <span className="t-title-sm grow">任务队列</span>
        {busy ? <Chip tone="accent">{busy} 条进行中</Chip> : <span className="t-detail-xs">{s.list.length} 条</span>}
      </div>
      {s.list.length ? s.list.map((r) => <JobCard key={r.id} r={r} />)
        : <Empty icon="tasks" title="还没有处理过">选好文件、按下按钮，进度会出现在这里。</Empty>}
      <div className="t-detail-xs vw__sidefoot">每个输入写成新文件，也是 Space 里的条目，原文件不动；视频和音频结果要放进视频时用「加到视频」。六个工具共用一条队列，一次跑一条。交互演示几秒跑完，不落真文件。</div>
    </aside>;
  }

  Object.assign(window, {FootageJobList});
})();
