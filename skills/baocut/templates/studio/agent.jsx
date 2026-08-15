// BaoCut Subtitle Studio — the Agent boundary. Every AI action is EXECUTED BY
// THE AGENT, not the page: clicking an AI control queues a request into
// localStorage (bcs:requests) and shows this dialog; the agent polls the queue
// (window.BC.requests()), does the work, rewrites app/data.json (rev+1), and
// the page hot-swaps. See AGENT.md for the protocol.
(() => {
const { useState, useRef, useEffect } = React;
const { Ic, QBtn, Pop, CopyBtn, useApp, toast, fmt } = window;

const AGENT_HINT = '处理 subtitle-studio 的请求队列';

function AgentDialog({ req, onClose }) {
  const { Overlay } = window;
  const cmd = AGENT_HINT + '：' + req.label;
  return (
    <Overlay onClose={onClose}>
      <div className="vk-dialog" style={{ width: 440 }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="vk-dialog__title vk-row" style={{ gap: 8 }}>
          <span className="bcs-aimark"><Ic name="ai-sparkle" size={15} /></span>
          已发送给 Agent
        </div>
        <div className="vk-dialog__body">
          <p><b>{req.label}</b> 已加入请求队列。AI 操作由 Agent 端执行：Agent 会读取请求、更新项目数据，本页面将自动同步刷新。</p>
          <div className="bcs-cmd">
            <span className="vk-mono">{cmd}</span>
            <CopyBtn quiet getText={() => cmd} tip="复制指令" note="指令已复制" />
          </div>
          <p className="vk-dim" style={{ fontSize: 12, marginTop: 10 }}>如果 Agent 正在监听本会话，它会自动处理；否则把上面这句话发给 Agent 即可。</p>
        </div>
        <div className="vk-dialog__footer">
          <button className="s2-btn s2-btn--M s2-btn--accent" onClick={onClose}>好的</button>
        </div>
      </div>
    </Overlay>
  );
}

// One call = queue + dialog. Returns a hook-ish helper used by the panes.
function useAgentAction() {
  const app = useApp();
  const [dlg, setDlg] = useState(null);
  const run = (action, label, params) => {
    const req = app.request(action, label, params);
    setDlg(req);
  };
  const node = dlg ? <AgentDialog req={dlg} onClose={() => setDlg(null)} /> : null;
  return [run, node];
}

// pending-requests chip in the tab bar (popover lists + revoke)
function AgentQueue() {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const pending = app.reqs.filter((r) => r.status === 'pending');
  if (!pending.length) return null;
  return (
    <>
      <button ref={btnRef} className="bcs-queue" data-tip="等待 Agent 处理的请求" onClick={() => setOpen(true)}>
        <Ic name="ai-sparkle" size={13} />
        <span>{pending.length}</span>
      </button>
      {open ? (
        <Pop anchorRef={btnRef} onClose={() => setOpen(false)} align="end" width={300}>
          <div className="vk-pop__title">Agent 请求队列</div>
          {pending.map((r) => (
            <div key={r.id} className="bcs-queue__row">
              <Ic name="clock" size={13} />
              <span className="bcs-queue__label">{r.label}</span>
              <QBtn icon="close" size="XS" tip="撤销" onClick={() => { app.dropRequest(r.id); toast('已撤销请求', { variant: 'neutral' }); }} />
            </div>
          ))}
          <div className="vk-dim" style={{ fontSize: 11.5, padding: '6px 4px 0' }}>Agent 处理后会更新数据并刷新本页。</div>
        </Pop>
      ) : null}
    </>
  );
}

// ---------- live progress headers (agent-driven status) ----------
// status: { phase:'translating', pct, detail, phases:[{label,state}], linesDone, linesTotal }

// callsActive 是 provider 并发泳道的在飞调用数（agent 路径不报）。
// 只有 ≥2 才值得标注——单发是常态，不用占字。
function inFlightText(status) {
  return Number.isFinite(status.callsActive) && status.callsActive > 1
    ? ' · ' + status.callsActive + ' 个请求并发中'
    : '';
}

function LiveHeader({ status, title }) {
  const determinate = Number.isFinite(status.pct);
  return (
    <div className="tr-live">
      <div className="tr-live__row1">
        <span className="tr-live__title">{title}</span>
        <span className="tr-live__sub">{status.detail || ''}</span>
        <span className="vk-spacer"></span>
        {determinate ? <span className="vk-mono" style={{ fontSize: 12, fontWeight: 700 }}>{Math.round(status.pct)}%</span> : <span className="vk-dim" style={{ fontSize: 11.5 }}>处理中</span>}
      </div>
      <div className="vk-prog__bar" style={{ height: 6, borderRadius: 3, flex: 'none' }}>
        <span className={'vk-prog__fill' + (determinate ? '' : ' vk-prog__fill--indeterminate')}
          style={{ width: determinate ? status.pct + '%' : '38%', borderRadius: 3 }}></span>
      </div>
      {status.phases && status.phases.length ? (
        <div className="vk-airun__phases" style={{ margin: '4px 0 0' }}>
          {status.phases.map((p, i) => (
            <span key={i} className={'vk-phase' + (p.state === 'done' ? ' vk-phase--done' : '') + (p.state === 'active' ? ' vk-phase--cur' : '')}>
              {p.state === 'done' ? <Ic name="checkmark" size={10} /> : p.state === 'active' ? <span className="vk-spin"></span> : null}
              {p.label}
            </span>
          ))}
        </div>
      ) : null}
      {status.linesTotal ? <div className="tr-live__counts">{status.linesDone || 0} / {status.linesTotal} 句{inFlightText(status)} · CLI 实时写入</div>
        : status.callsTotal ? <div className="tr-live__counts">已完成 {status.callsDone || 0}/{status.callsTotal} 次模型调用{inFlightText(status)} · CLI 实时写入</div>
        : status.callsDone ? <div className="tr-live__counts">已完成 {status.callsDone} 次模型调用{inFlightText(status)} · CLI 实时写入</div> : null}
    </div>
  );
}

// Full-pane view while the agent streams a transcription in (status.phase ===
// 'transcribing'): progress header + the cue rows that have landed so far.
function TranscribingPane() {
  const app = useApp();
  const { doc } = app;
  const liveSegments = Array.isArray(doc.status.liveSegments) ? doc.status.liveSegments : [];
  const rows = liveSegments.length ? liveSegments : doc.cues;
  const scrollRef = useRef(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length]);
  return (
    <div className="vk-transcript" data-screen-label="Transcribing">
      <LiveHeader status={doc.status} title={'转录中 · ' + (doc.meta.model || '')} />
      <div className="vk-transcript__scroll" ref={scrollRef}>
        {rows.map((c) => (
          <div key={c.id || (c.start + '|' + c.text)} className="tg tg--preview" onClick={() => app.seekSource('main', c.start)}>
            <span className="tg__time vk-mono">{fmt(c.start)}</span>
            <span className="tg-preview__col">
              <span className="tg-preview__txt">{c.text}</span>
            </span>
          </div>
        ))}
        <div className="tg tg--preview">
          <span className="tg__time vk-mono">--:--</span>
          <span className="tg-preview__col"><span className="tg-preview__txt tg-preview__txt--pending">识别中…</span></span>
        </div>
        <div style={{ height: 40 }}></div>
      </div>
    </div>
  );
}

Object.assign(window, { useAgentAction, AgentQueue, LiveHeader, TranscribingPane, AGENT_HINT });
})();
