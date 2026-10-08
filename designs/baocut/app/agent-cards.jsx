/* Agent 会话线程里挂在行后面的卡（product-design §3.2.2、§3.2.7、§4.2；只在 App 入口加载）。

   - 视频卡（home-session.jsx 的 SessionArtifactCard）：这里只画它下面活的那一段（MovieJobRows）。
     一条会话一部视频一张，挂在最后一条引用它的消息后面（有新引用就挪过去，还在跑的活跟到最新一轮；BC_AGENT_PROJECTS.sessionArtifacts），
     列这条会话在它上面的全部活。
     只摊开正在进行的活，都结束了只摊开最后一件；其余收进「之前的 N 项」，默认收起，里面有待处理的就写「N 项待处理」（BC_AGENT_CARDS.foldRows，§3.2.2）。
   - 下载卡（DownloadCard）：Agent 调下载工具时视频还没创建，单独一张；下载完成、视频建好后同一个锚点换成视频卡。
   - 候选卡（CandidateCard）：合成语音 / 生成图片完成后的候选，可试听 / 预览、选用。运行中与失败只在步骤行上。
   内容一律从任务记录与视频记录算（BC_AGENT_CARDS），不读回复正文；任务记录改了，卡跟着变。 */
(function () {
  const {useState, useEffect} = React;
  const CARDS = window.BC_AGENT_CARDS;

  /** 卡上的按钮：取消走共享的取消口子（带确认），重试交给会话的演示推进，去处是路由。 */
  function useCardAction(task) {
    const app = useApp();
    return (a, file) => {
      switch (a.k) {
        case 'cancel': app.cancelTask(task); return;
        case 'retry': app.retryAgentTask(task.id); return;
        case 'play': app.toast(`用默认播放器打开 ${file ? file.name : '成片'}（演示）`); return;
        case 'reveal': app.toast(`在文件夹中显示 ${file ? file.path || file.name : '成片'}（演示）`); return;
        default: if (a.route) app.go(a.route);
      }
    };
  }

  /** 一件活一行。`compact` 是收起区里的历史行：只留头一行、成片文件名、失败原因与按钮，
      不画进度、结果事实、提醒与质量检查（展开的历史只用来找回成片与失败的去处）。 */
  function JobRow({r, task, compact}) {
    const run = useCardAction(task);
    const full = !compact;
    const time = full ? r.time : null;
    return <li className={cx('mjob', compact && 'mjob--compact', `is-${r.state}`)}>
      <div className="mjob__head">
        <Ic n={r.state === 'failed' ? 'alert' : r.icon} className="ic--14 mjob__ic" />
        <span className={cx('mjob__name', r.state === 'running' && 'is-shimmer')}>{r.name}</span>
        <span className="mjob__tail">{r.tail}</span>
      </div>
      {full && r.pct != null ? <Progress value={r.pct} thin label={`${r.name} · ${r.line || r.tail}`} /> : null}
      {full && r.line ? <span className="mjob__line">{r.line}</span> : null}
      {full && r.facts.length ? <span className="mjob__facts">{r.facts.join(' · ')}</span> : null}
      {full && r.asr ? <span className="mjob__asr" title={r.asr}>{r.asr}</span> : null}
      {full ? r.warnings.map((w) => <span key={w} className="mjob__warn">{w}</span>) : null}
      {r.file ? <span className="mjob__file"><span className="mjob__fname" title={r.file.name}>{r.file.name}</span>
        {full && r.file.meta ? <span className="mjob__fmeta">{r.file.meta}</span> : null}</span> : null}
      {full && r.checks.length ? <ul className="mjob__checks" aria-label="质量检查">{r.checks.map((c) => <li key={c.label} className={c.ok ? 'is-ok' : 'is-warn'}>
        <Ic n={c.ok ? 'ok' : 'alert'} className="ic--14" />{c.label}</li>)}</ul> : null}
      {r.error ? <span className="mjob__err">{r.error}</span> : null}
      {time || r.actions.length ? <div className="mjob__foot">
        <span className="mjob__time">{time}</span>
        {r.actions.map((a) => <Btn key={a.k} variant={a.k === 'cancel' ? 'quiet' : 'secondary'} size="s" onClick={() => run(a, r.file)}>{a.label}</Btn>)}
      </div> : null}
    </li>;
  }

  /** 视频卡下面的活（`shown` / `earlier` / `pending` 来自 BC_AGENT_CARDS.movieCard 的 foldRows）：
      摊开的照常一件一行；之前的收进一行「之前的 N 项」，默认收起，展开是紧凑的历史行（新的在前）。
      收起的里有失败待处理的（重试 / 去设置 / 去登录），这一行靠右带一枚警示图标与「N 项待处理」；
      两段字读屏会连成一串，这时按钮另给 aria-label「之前的 N 项，M 项待处理」，没有待处理的就念按钮文字。
      开合只是这张卡自己的事（局部 useState），不进 store。展开的样子照工具步骤行（agent-steps.jsx）：BCAction + 箭头。 */
  function MovieJobRows({shown, earlier, pending}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    const rest = earlier || [];
    if (!(shown && shown.length) && !rest.length) return null;
    const task = (id) => app.tasks.find((t) => t.id === id);
    return <ul className="mjobs" aria-label="这部视频上的活">
      {(shown || []).map((r) => <JobRow key={r.id} r={r} task={task(r.id)} />)}
      {rest.length ? <li className="mjobs__more">
        <BCAction className="mjobs__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}
          aria-label={pending > 0 ? `之前的 ${rest.length} 项，${pending} 项待处理` : undefined}>
          <span className="mjobs__label">{`之前的 ${rest.length} 项`}</span>
          {pending > 0 ? <span className="mjobs__pending"><Ic n="alert" className="ic--14 mjobs__pendic" />{`${pending} 项待处理`}</span> : null}
          <Ic n={open ? 'chevdown' : 'chevright'} className="ic--14 mjobs__chev" />
        </BCAction>
        {open ? <ul className="mjobs__earlier" aria-label="之前的活">
          {rest.map((r) => <JobRow key={r.id} r={r} task={task(r.id)} compact />)}
        </ul> : null}
      </li> : null}
    </ul>;
  }

  /** 下载卡：视频还没创建时的占位（§4.2）。 */
  function DownloadCard({task}) {
    const run = useCardAction(task);
    const c = CARDS.download(task);
    return <section className={cx('dlcard', `is-${c.state}`)} aria-label={`${c.title} · ${c.name}`}>
      <header className="dlcard__head">
        <span className="dlcard__ic"><Ic n={c.state === 'failed' ? 'alert' : 'download'} className="ic--16" /></span>
        <span className="dlcard__titles">
          <span className="dlcard__title">{c.title}</span>
          <span className="dlcard__name" title={c.name}>{c.name}</span>
        </span>
        {c.pct != null ? <span className="dlcard__pct">{`${c.pct}%`}</span> : null}
      </header>
      {c.source ? <span className="dlcard__src" title={c.source}>{c.source}</span> : null}
      {c.pct != null ? <Progress value={c.pct} thin label={`${c.title} · ${c.name}`} /> : null}
      {c.line ? <span className="dlcard__line">{c.line}</span> : null}
      {c.error ? <span className="dlcard__err">{c.error}</span> : null}
      {c.hint ? <span className="dlcard__hint">{c.hint}</span> : null}
      {c.time || c.actions.length ? <div className="dlcard__foot">
        <span className="dlcard__time">{c.time}</span>
        {c.actions.map((a) => <Btn key={a.k} variant={a.k === 'cancel' ? 'quiet' : 'secondary'} size="s" onClick={() => run(a)}>{a.label}</Btn>)}
      </div> : null}
    </section>;
  }

  /* 候选：图片是缩略（演示渐变），语音是一行波形；预览 / 试听在卡里展开，不离开会话 */
  function CandidateCard({task}) {
    const app = useApp();
    const [peek, setPeek] = useState(null);
    useEffect(() => {
      if (peek == null || task.kind !== 'tts') return undefined;
      const t = setTimeout(() => setPeek(null), 3000);
      return () => clearTimeout(t);
    }, [peek, task.kind]);
    const c = CARDS.candidate(task);
    if (!c) return null;
    const art = (x) => (x.art != null && window.BC_CLOUD_IMAGE ? window.BC_CLOUD_IMAGE.demoArt(x.art) : null);
    return <section className="acard" aria-label={c.title}>
      <header className="acard__head">
        <span className="acard__ic"><Ic n={task.kind === 'tts' ? 'wave' : 'image'} className="ic--16" /></span>
        <span className="acard__titles">
          <span className="acard__title">{c.title}</span>
          {c.sub ? <span className="acard__sub">{c.sub}</span> : null}
        </span>
      </header>
      <ul className={cx('acard__cands', task.kind === 'image' && 'acard__cands--grid')}>
        {c.candidates.map((x) => <li key={x.i} className={cx('acard__cand', x.picked && 'is-picked')}>
          {task.kind === 'image'
            ? <span className={cx('acard__thumb', peek === x.i && 'is-big')} style={{background: art(x)}} aria-hidden="true" />
            : <span className={cx('acard__voice', peek === x.i && 'is-playing')} aria-hidden="true"><Ic n="wave" className="ic--16" /></span>}
          <span className="acard__cand-t">
            <span className="acard__cand-name">{x.name}</span>
            {x.text ? <span className="acard__cand-text">{x.text}</span> : null}
            {x.meta ? <span className="acard__cand-meta">{x.meta}</span> : null}
          </span>
          <span className="acard__cand-acts">
            <Btn variant="quiet" size="s" icon={task.kind === 'tts' ? (peek === x.i ? 'stop' : 'play') : null}
              onClick={() => setPeek((v) => (v === x.i ? null : x.i))}>
              {peek === x.i ? (task.kind === 'tts' ? '停止' : '收起') : c.action}</Btn>
            {x.picked ? <Chip tone="positive" icon="ok">已选用</Chip>
              : <Btn variant="secondary" size="s" onClick={() => { app.patchTask(task.id, {picked: x.i}); app.toast(`已选用「${x.name}」`, 'positive'); }}>选用</Btn>}
          </span>
        </li>)}
      </ul>
    </section>;
  }

  /** 线程里一行后面挂的卡（`cards` 来自 BC_AGENT_CARDS.rowCards）：会话产物（视频卡等）、下载卡、候选卡。 */
  function AgentRowCards({cards, sess}) {
    const app = useApp();
    if (!cards || !cards.length) return null;
    const task = (id) => app.tasks.find((t) => t.id === id);
    return <div className="chat-outputs" role="group" aria-label="消息产物">
      {cards.map((c) => {
        if (c.k === 'artifact') return <window.SessionArtifactCard key={`${c.item.id}@${c.item.turn != null ? c.item.turn : ''}`} item={c.item} sess={sess} />;
        const t = task(c.taskId);
        if (!t) return null;
        return c.k === 'download' ? <DownloadCard key={t.id} task={t} /> : <CandidateCard key={t.id} task={t} />;
      })}
    </div>;
  }

  Object.assign(window, {AgentRowCards, MovieJobRows});
})();
