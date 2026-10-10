/* AI 工具 Tab 的列表页（product-design §5.10，2026-10-09）：rail 第三格，文稿、字幕之后。
   顶部一张卡：不在列表里的活用一句话交给 Agent（新会话、这部视频作为上下文）；没有可用 Agent 时换成配置引导。
   下面按组列工具，第一批只有从文稿出发的三组（整理文稿 / 写作 / 发布），翻译与画面的工具仍从各自面板进来、
   列表脚注说清去处。每行：名字、一句说明、这部视频上的状态（在跑 / 待处理 / 已选用 / 上次什么时候）。
   没有文稿的视频：整张列表换成一张说明卡——这些工具都从文稿出发，先转录。 */
(function () {
  const D = window.BC_DATA;
  const AG = window.BC_AGENT;
  const P = window.BC_AIPROMPT;
  const CUT = window.BC_CUT;
  const {TOOLS, GROUP_SUB} = window.BC_AIFLOWS;

  /** 这一行右侧的状态：在跑 > 待处理 > 已选用 / 候选 > 上次跑过 */
  function rowState(app, ctx, k) {
    const mine = app.tasks.filter((t) => t.kind === k && t.project === ctx.proj.id);
    const running = mine.find((t) => t.status === 'running');
    if (running) return {tone: 'accent', text: `${running.pct || 0}%`};
    if (k === 'cleanup') {
      const n = CUT.suggested(ctx.cuts || []).length;
      if (n) return {tone: 'info', text: `${n} 处待定`};
    }
    if (k === 'stale' && ctx.transImpact && ctx.transImpact.stale.length) return {tone: 'notice', text: `${ctx.transImpact.stale.length} 句过期`};
    if (k === 'chapters' && (ctx.chapters || []).length) return {text: `${ctx.chapters.length} 章`};
    const done = mine.filter((t) => t.status === 'done').slice(-1)[0];
    if (done) return {text: done.undone ? '已撤销' : `上次 · ${done.started || '刚刚'}`};
    return null;
  }

  function AgentCard({ctx}) {
    const app = useApp();
    if (app.harness) {
      return (
        <button className="atagent" onClick={() => app.openAgent({project: ctx.proj.id})}>
          <span className="ic2"><Ic n="agent" className="ic--16" /></span>
          <span className="tt"><b>不在下面列表里的活，用一句话交给 Agent</b>
            <span>{`新开一条会话，这部视频作为上下文；在本机 ${app.harness.name} 里跑，写入前会先问你 →`}</span></span>
        </button>
      );
    }
    const guide = AG.setupGuide(app.agentAvail);
    return (
      <button className="atagent atagent--setup" onClick={() => (guide.state === 'off' ? app.enableAgent(guide.harness.id) : app.go({r: 'settings', sec: 'agent'}))}>
        <span className="ic2"><Ic n={guide.state === 'off' ? 'settings' : 'agent'} className="ic--16" /></span>
        <span className="tt"><b>{guide.title}</b>
          <span>{guide.state === 'off' ? `${guide.cta} · 每个工具页的「用」就能选它；没有 Agent 也能直接调模型 →` : '装 Claude Code 或 Codex CLI 就能交给它；没有 Agent 也能直接调模型 →'}</span></span>
      </button>
    );
  }

  function AiToolsList({ctx, onOpen}) {
    const app = useApp();
    const WF = window.BC_WRITEFLOWS;
    const hasTranscript = (ctx.cues || []).length > 0;
    return (
      <div className="pview">
        <PanelHead title="AI 工具" />
        <div className="pscroll bc-scroll">
          <AgentCard ctx={ctx} />
          {!hasTranscript ? (
            <div className="aicard ail__empty">
              <b>这部视频还没有文稿</b>
              <span>这里的工具都从文稿出发：润色、分章、写总结、起标题都要先有转录。{ctx.proj.status === 'running' ? '转录正在进行，完成后这里就能用。' : '先转录一遍。'}</span>
              {ctx.proj.status !== 'running' ? <div className="chiprow"><Btn size="s" variant="accent" onClick={() => ctx.setTab('video')}>去转录</Btn></div> : null}
            </div>
          ) : null}
          {P.GROUPS_NOW.map((g) => (
            <React.Fragment key={g}>
              <SecHead first={g === P.GROUPS_NOW[0]}>{g}</SecHead>
              {GROUP_SUB[g] ? <div className="aigrp__sub">{GROUP_SUB[g]}</div> : null}
              {Object.keys(TOOLS).filter((k) => TOOLS[k].group === g).map((k) => {
                const t = TOOLS[k];
                const st = rowState(app, ctx, k);
                const sub = WF ? WF.listStatus(ctx.proj.id, k, t.desc) : t.desc;
                return (
                  <button className={cx('drill ail__row', !hasTranscript && 'is-off')} key={k} onClick={() => onOpen(k)} aria-disabled={!hasTranscript || undefined}>
                    <span className="ic2"><Ic n={t.icon} className="ic--16" /></span>
                    <span className="tt"><b>{t.name}</b><span>{sub}</span></span>
                    {st ? <Chip tone={st.tone} pill className="ail__st">{st.text}</Chip> : null}
                    <Ic n="chevright" className="ic--14 ail__chev" />
                  </button>
                );
              })}
            </React.Fragment>
          ))}
          <div className="hint ail__later">{P.LATER_NOTE}</div>
        </div>
      </div>
    );
  }

  Object.assign(window, {AiToolsList});
})();
