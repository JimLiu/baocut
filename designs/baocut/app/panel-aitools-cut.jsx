/* AI Tools · 剪口播两个工具页的专用件（第 196 轮，§15.3）：
   「找可剪的口」默认交给 Agent、可选直接调模型，两条路各有引导与进度；
   「刷新过期译文」多一类来源——原文被剪切的句子（§13.1）。
   这里只放这两页独有的卡与勾选项，DocFlow 仍在 panel-aitools.jsx 里组合它们。 */
(function () {
  const AG = window.BC_AGENT;

  const CLEANUP_OPTS = [
    {k: 'fillers', label: '口癖', sub: '嗯、啊、就是、然后这类词', agentOff: '口癖不找'},
    {k: 'pauses',  label: '长停顿 ≥ 0.8s', sub: '本机按词级时间找，不用模型', agentOff: '停顿不动'},
    {k: 'repeats', label: '重复起句', sub: '同一句起了两次，留后一次', agentOff: '重复起句不找'},
  ];
  const AGENT_STAGES = ['读视频与文稿', '等你放行', '执行 bcut cleanup', '写入建议'];
  const API_STAGES = ['读词级时间', '本机找停顿', '模型找口癖与重复', '写入建议'];

  /** 勾选项折成交给 Agent 的附加句：全勾就一句不加（意图句已经写全了）。 */
  function cleanupExtra(opts) {
    const off = CLEANUP_OPTS.filter((o) => !opts[o.k]).map((o) => o.agentOff);
    return off.length ? [off.join('、')] : [];
  }

  /** 直接调模型时的活动行：停顿在本机、口癖与重复分页送模型。 */
  function cleanupActivity(pct, modelName) {
    if (pct < 26) return '本机 · 读 206 秒词级时间';
    if (pct < 52) return '本机 · 按词间距找停顿';
    return `${modelName} · 在飞 2 · 第 ${Math.min(9, Math.max(1, Math.floor((pct - 52) / 5) + 1))}/9 页找口癖与重复`;
  }

  function CleanupOptions({opts, onChange}) {
    return CLEANUP_OPTS.map((o) => (
      <window.ToolOption key={o.k} on={!!opts[o.k]} onChange={(v) => onChange({...opts, [o.k]: v})} label={o.label} sub={o.sub} />
    ));
  }

  /** 设置态的引导卡：两条路各说清「会发生什么」——这是用户选谁来做的依据。 */
  function CleanupGuide({agent, runnerLabel}) {
    return (
      <div className="aicard">
        <b>{agent ? `交给 ${runnerLabel || 'Agent'} · 在左侧会话里进行` : '直接调模型 · 不用对话'}</b>
        <ol className="aisteps">
          {agent ? <>
            <li>读视频与文稿，按词级时间找口癖、长停顿、重复起句</li>
            <li>把要剪的清单列在会话里，问你一次</li>
            <li>你放行后运行 bcut cleanup --review，建议写进文稿与时间轴</li>
          </> : <>
            <li>本机按词级时间找停顿，不出本机</li>
            <li>文字分页送模型找口癖与重复起句</li>
            <li>建议写进文稿与时间轴，接受前不影响播放和导出</li>
          </>}
        </ol>
        <span>{agent
          ? '推荐：它会先把清单给你看一遍再写，也能按你的口头要求调整（比如只剪第 3 章）。'
          : '最快的一条路；跑完自动应用建议，随时可一键撤销。想先看清单再写，改用 Agent。'}</span>
      </div>
    );
  }

  /** Agent 阶段的进度卡：从会话消息倒推到哪一步了，等放行时给一个直达会话的按钮。 */
  function AgentRun({sess, task, runnerLabel, toolName, onOpen, onReset}) {
    const prog = AG.sessionProgress(sess, task);
    return (
      <>
        <div className="aicard">
          <b>已交给 {runnerLabel} · 在左侧会话里进行</b>
          <ol className="aisteps">
            {AGENT_STAGES.map((s, i) => (
              <li key={s} className={prog.done || i < prog.cur ? 'is-done' : i === prog.cur ? 'is-cur' : ''}>{s}</li>
            ))}
          </ol>
        </div>
        <window.BC_AIFLOWS.Job title={prog.done ? `${toolName} · 已完成` : `${toolName}…`} pct={prog.pct}
          stages={AGENT_STAGES} cur={prog.done ? 4 : prog.cur} activity={prog.note} />
        {prog.waiting ? (
          <div className="aicard aicard--warn">
            <b>等你在会话里放行</b>
            <span>清单已经列好，放行后才会写入视频。</span>
            <div><Btn variant="accent" size="s" onClick={onOpen}>去会话放行</Btn></div>
          </div>
        ) : null}
        <div className="row gap6" style={{marginTop: 10}}>
          <Btn variant="secondary" size="s" icon="agent" onClick={onOpen}>打开会话</Btn>
          <Btn variant="quiet" size="s" onClick={onReset}>重新设置</Btn>
        </div>
        <div className="signpost">可先继续编辑 · 建议写好后会以划线形态进文稿与时间轴，这里给出收据。</div>
      </>
    );
  }

  /** 会话 + 它挂的任务：工具页留在原地画进度，读的是 store 里同一条会话与任务记录。 */
  function useAgentRun(app, sid) {
    const sess = sid ? app.sessions.find((s) => s.id === sid) || null : null;
    const task = sess && sess.taskId ? app.tasks.find((t) => t.id === sess.taskId) || null : null;
    return {sess, task, prog: AG.sessionProgress(sess, task)};
  }

  /* ---------- 刷新过期译文：两类来源 ---------- */

  function StaleOptions({pick, onChange, edited, impact}) {
    const cut = impact.stale.length;
    return (
      <>
        <window.ToolOption on={!!pick.edited} onChange={(v) => onChange({...pick, edited: v})}
          label={`原文改过的 ${edited} 句`} sub="你在文稿里改过字，译文还是旧的" />
        <window.ToolOption on={!!pick.cut && cut > 0} onChange={(v) => onChange({...pick, cut: v})}
          label={`原文被剪切的 ${cut} 句`}
          sub={cut ? `剪口播剪掉了半句${impact.whole ? `，其中 ${impact.whole} 句整句已剪` : ''}；按剪后的原文重译` : '没有——剪口播还没剪到句中'} />
      </>
    );
  }

  /** 两类来源折成计数与交给 Agent 的意图字段。 */
  function staleIntent(pick, edited, impact) {
    const cut = pick.cut ? impact.stale.length : 0;
    const ed = pick.edited ? edited : 0;
    return {edited: ed, cut, count: ed + cut};
  }

  Object.assign(window, {BC_AICUT: {CLEANUP_OPTS, AGENT_STAGES, API_STAGES, cleanupExtra, cleanupActivity,
    CleanupOptions, CleanupGuide, AgentRun, useAgentRun, StaleOptions, staleIntent}});
})();
