/* 工具 › 视频文件工具的任务卡与队列（product-design §2.7「视频文件」「结果与下一步」；从 tool-video.jsx 拆出）。
   一条任务卡：进度、排队、取消；完成后是收据与产物行（在 Space 中查看、在文件夹中显示、交给 Agent、接着用工具）；
   失败时归因 + 一键修法（ffmpeg stderr 分类在 model-video.js），提取音频没有音轨时单独一张卡（TRANSCODE_NO_AUDIO）。 */
(function () {
  const {useState} = React;
  const V = window.BC_VIDEO;
  const Q = window.BC_VIDEO_QUEUE;
  const env = () => Q.env();
  const store = Q.store;
  const drop = (id) => Q.drop(id);
  const cancel = (app, r) => Q.cancel(app, r);
  const requeue = (app, r, extra) => Q.requeue(app, r, extra);

  /* ---------- 一条任务卡 ---------- */
  function JobCard({r, list, onReuse, onFix}) {
    const app = useApp();
    const [pop, setPop] = useState(null);
    const close = () => setPop(null);
    const flip = (k) => setPop(pop === k ? null : k);
    const state = {done: r.ago, running: '进行中', queued: '排队中', canceled: '已取消', error: '失败'}[r.status];
    const extract = r.kind === 'extract';
    const cmd = V.commandLine(env().path || 'ffmpeg', r.plan.args || []);
    const over = r.status === 'done' ? V.overTarget(r) : null;
    const copyReport = () => {
      copyToClipboard(V.report(cmd, `ffmpeg version ${env().version || '?'}`, r.diagnosis || {cause: 'unknown'}, r.stderr || ''));
      app.toast('已复制诊断报告 · 可以直接贴进求助帖');
    };
    return (
      <div className={cx('vrec', r.status === 'running' && 'is-running', r.status === 'error' && 'is-bad',
        r.status === 'canceled' && 'is-off')}>
        <div className="vrec__hd">
          <Ic n={{compress: 'film', merge: 'layers', extract: 'wave'}[r.kind] || 'film'} className="ic--16 vrec__ic" />
          <b className="t-title-sm t-truncate grow">{r.name}</b>
          <span className="t-detail-xs">{state}</span>
          <div className="vrec__pop">
            <IconBtn icon="more" size="s" tip="更多" on={pop === 'more'} onClick={() => flip('more')} />
            <Popover open={pop === 'more'} onClose={close} align="right" dir="down" width={236}>
              <Menu>
                <MenuItem icon="edit" label="带回左边再来一版" onClick={() => { close(); onReuse(r); }} />
                {r.plan.args && r.plan.args.length ? <MenuItem icon="copy" label="复制这条 ffmpeg 命令"
                  onClick={() => { close(); copyToClipboard(cmd); app.toast('已复制命令 · 可以直接粘到终端复跑'); }} /> : null}
                {r.taskId ? <MenuItem icon="tasks" label="在后台任务里查看" onClick={() => { close(); app.go({r: 'task', id: r.taskId}); }} /> : null}
                <MenuRule />
                <MenuItem icon="trash" label="删除这条记录" tone="negative" disabled={r.status === 'running'}
                  onClick={() => { close(); drop(r.id); app.toast(`已删除 ${r.name}`); }} />
              </Menu>
            </Popover>
          </div>
        </div>
        <span className="t-detail-xs">{extract ? window.BC_TOOL_EXTRACT.jobMeta(r) : V.jobMeta(r)}</span>

        {r.status === 'running' ? (
          <div className="vrec__busy">
            <div className="row">
              <span className="t-detail-xs grow">{V.progressLine(r)}</span>
              <Btn variant="quiet" size="s" onClick={() => cancel(app, r)}>取消</Btn>
            </div>
            <Progress value={r.pct} thin />
          </div>
        ) : null}
        {r.status === 'queued' ? (
          <div className="row">
            <span className="t-detail-xs grow">前面还有 {V.aheadOf(list, r.id)} 条 · 本机一次跑一条</span>
            <Btn variant="quiet" size="s" onClick={() => cancel(app, r)}>取消</Btn>
          </div>
        ) : null}
        {r.status === 'canceled' ? (
          <div className="row">
            <span className="t-detail-xs grow">没有产出文件</span>
            <Btn variant="quiet" size="s" icon="refresh" onClick={() => requeue(app, r)}>重新排队</Btn>
          </div>
        ) : null}

        {r.status === 'done' ? (
          <>
            <div className="vrec__sum">
              <b className="t-title-sm">{extract ? `${V.humanBytes(r.bytes || 0)} · ${r.plan.copy ? '原样拷贝，没有重新编码' : '转成 AAC'}` : V.resultLine(r)}</b>
              <span className="t-detail-xs">用了 {V.humanDuration(r.elapsed || 0)}</span>
            </div>
            {over ? (
              <div className="hint hint--warn vrec__over">
                {over.text}。{over.kbps ? '按实测比例再收一点码率压一遍就能进去。' : '把分辨率降一档试试。'}
                {over.kbps ? (
                  <Btn variant="secondary" size="s" icon="refresh"
                    onClick={() => { store.outcome = 'ok'; requeue(app, r, {overrideKbps: over.kbps}); app.toast('正在按修正后的码率再压一遍'); }}>
                    再紧一点
                  </Btn>
                ) : null}
              </div>
            ) : null}
            {r.entry ? <window.ToolOutputRow entry={r.entry} fromTool={r.kind} compact /> : null}
          </>
        ) : null}

        {r.status === 'error' && r.noAudio ? (
          <div className="vfail">
            <b className="t-title-sm">{r.noAudio.title}</b>
            <span className="t-detail">{r.noAudio.line}</span>
            <span className="t-detail-xs t-mono">{r.noAudio.code}</span>
            <div className="vrec__acts">
              <Btn variant="accent" size="s" icon="folder" onClick={() => onFix('relocateInput', r)}>换一个文件</Btn>
            </div>
          </div>
        ) : null}
        {r.status === 'error' && !r.noAudio ? (
          <div className="vfail">
            <b className="t-title-sm">{V.causeTitle(r.diagnosis)}</b>
            <span className="t-detail">{(V.CAUSES[r.diagnosis.cause] || V.CAUSES.unknown).line}</span>
            {r.diagnosis.evidence ? <code className="vfail__ev t-mono">{r.diagnosis.evidence}</code> : null}
            <div className="vrec__acts">
              {r.diagnosis.fixes.map((k) => {
                const fix = V.FIXES[k];
                const primary = k === r.diagnosis.fixes[0];
                return (
                  <Btn key={k} variant={primary ? 'accent' : 'quiet'} size="s" icon={fix.icon}
                    onClick={() => (k === 'copyReport' ? copyReport() : onFix(k, r))}>{fix.label}</Btn>
                );
              })}
            </div>
            <BCDisclosure className="vfail__raw" title={<> ffmpeg 原文与整条命令 </>}>
              <code className="t-mono">{cmd}</code>
              <code className="t-mono">{r.stderr}</code>
            </BCDisclosure>
          </div>
        ) : null}
      </div>
    );
  }

  /** 右栏：任务队列。压缩、合并与提取音频共用一条队列，所以三页看到的是同一份。 */
  function JobList({list, onReuse, onFix}) {
    const busy = list.filter((r) => r.status === 'running' || r.status === 'queued').length;
    return (
      <aside className="vw__side">
        <div className="vw__sidehd">
          <span className="t-title-sm grow">任务队列</span>
          {busy ? <Chip tone="accent">{busy} 条进行中</Chip> : <span className="t-detail-xs">{list.length} 条</span>}
        </div>
        {list.length
          ? list.map((r) => <JobCard key={r.id} r={r} list={list} onReuse={onReuse} onFix={onFix} />)
          : <Empty icon="tasks" title="还没有跑过">选好文件、按下按钮，进度会出现在这里。</Empty>}
        <div className="t-detail-xs vw__sidefoot">
          产出的文件保存在保存位置，也是 Space 里的条目；压缩、合并与提取音频共用一条队列，本机一次跑一条。交互演示不落真文件。
        </div>
      </aside>
    );
  }

  Object.assign(window, {VideoJobList: JobList});
})();
