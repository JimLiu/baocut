/* Bot 页的右栏（docs/design/bot-mode/bot-mode-requirements.md §11.1、§11.6 的修订稿）—— 只在 App 入口加载。
   中间与右栏之间的分隔条（拖动、方向键调宽，双击回到默认宽）；任务详情与线程里的产物卡；
   点开产物后推进右栏的产物页：视频是嵌进来的编辑器，文档、封面、字幕各有一个只读预览。宽度规则在 model-bot.js 的 sideWidth。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const B = window.BC_BOT;

  /* ---------- 分隔条 ---------- */

  /**
   * 中间 ∣ 右栏的分隔条：往左拖右栏变宽；左右方向键每次 16；双击回到这种右栏的默认宽。
   * 不用壳层的 seam--dock：标题栏按那个类名画分隔线。
   */
  function BotSideSeam({width, min, max, onResize, onReset}) {
    const start = useRef(null);
    const [dragging, setDragging] = useState(false);
    const finish = e => {
      if (!start.current || start.current.id !== e.pointerId) return;
      start.current = null;
      setDragging(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    };
    const follow = e => { if (start.current?.id === e.pointerId) onResize(start.current.width - (e.clientX - start.current.x)); };
    return <div className={cx('bot__seam', dragging && 'is-drag')} role="separator" aria-label="调整右栏宽度" aria-orientation="vertical" tabIndex={0}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} title="拖动调整宽度，双击还原"
      onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault();
        start.current = {id: e.pointerId, x: e.clientX, width};
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={follow}
      onPointerUp={e => { follow(e); finish(e); }}
      onPointerCancel={finish} onLostPointerCapture={finish}
      onDoubleClick={onReset}
      onKeyDown={e => {
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        e.preventDefault();
        onResize(width + (e.key === 'ArrowLeft' ? 16 : -16));
      }}><div className="bot__seam-bar" /></div>;
  }

  /* ---------- 产物卡 ---------- */

  /** 一个产物：任务详情「产物」里是一行，线程消息下面是一张卡；按下在右栏推开它。 */
  function BotOutputLink({output, card, onOpen}) {
    const kind = B.OUTPUT_KIND[output.kind] || B.OUTPUT_KIND.doc;
    const Icon = window.RSP.Icons[kind.icon];
    const meta = [kind.label, output.at ? window.BC_AGENT.agoLabel((Date.now() - output.at) / 60000) : null].filter(Boolean).join(' · ');
    return <button type="button" className={cx('bot-output-link', card && 'bot-output-link--card')} onClick={onOpen} aria-label={`打开「${output.label}」，${meta}`}>
      <span className="bot-output-link__icon" aria-hidden="true"><Icon /></span>
      <span className="bot-output-link__text">
        <span className="bot-output-link__name">{output.label}</span>
        {card ? <span className="bot-output-link__meta">{meta}</span> : null}
      </span>
      <window.RSP.Icons.ChevronRight UNSAFE_className="bot-output-link__go" />
    </button>;
  }

  /* ---------- 产物页 ---------- */

  /** 嵌进右栏的视频编辑器：与首页功能区的视频标签页同一个 EditorPage；编辑器的 Tab 是这一页自己的状态，不写进 Bot 的路由。 */
  function BotOutputMovie({projectId, onClose}) {
    const app = useApp();
    const urls = useRef(new Set());
    const [tab, setTab] = useState(null);
    useEffect(() => () => { urls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
    const project = app.projById(projectId);
    if (!project) return <Empty icon="film" title="视频已移走或删除" />;
    window.BC_DATA.activateProject(projectId, project);
    const context = {...app, route: {r: 'editor', id: projectId, ...(tab ? {tab} : {})},
      replace: r => setTab(r.tab || null), closeMovie: onClose};
    return <div className="movie-workspace__editor bot-output__movie">
      <window.AppCtx.Provider value={context}>
        <window.EditorPage key={projectId} projectId={projectId} embedded retainedUrls={urls.current} />
      </window.AppCtx.Provider>
    </div>;
  }

  /** 文档：几行 Markdown（# 标题、## 小节、- 列表），只读。 */
  function BotOutputDoc({body}) {
    const blocks = [];
    String(body || '').split('\n').forEach((line, n) => {
      if (line.startsWith('# ')) blocks.push(<h1 key={n}>{line.slice(2)}</h1>);
      else if (line.startsWith('## ')) blocks.push(<h2 key={n}>{line.slice(3)}</h2>);
      else if (line.startsWith('- ')) {
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'ul') blocks[blocks.length - 1] = <ul key={last.key}>{[...React.Children.toArray(last.props.children), <li key={n}>{line.slice(2)}</li>]}</ul>;
        else blocks.push(<ul key={n}><li>{line.slice(2)}</li></ul>);
      } else if (line.trim()) blocks.push(<p key={n}>{line}</p>);
    });
    return <article className="bot-output__doc bc-scroll">{blocks}</article>;
  }

  const ORDINAL = ['第一张', '第二张', '第三张', '第四张', '第五张', '第六张'];

  /** 封面候选：每张一块 16:9 的占位与它的说明。 */
  function BotOutputImages({images}) {
    const Icon = window.RSP.Icons.Image;
    return <div className="bot-output__scroll bc-scroll"><ul className="bot-output__images">
      {(images || []).map((text, n) => <li key={n}>
        <span className="bot-output__frame" aria-hidden="true"><Icon /></span>
        <span className="bot-output__caption"><strong>{ORDINAL[n] || `第 ${n + 1} 张`}</strong>{text}</span>
      </li>)}
    </ul></div>;
  }

  /** 双语字幕：时间、原文、译文，一条一行。 */
  function BotOutputCues({cues}) {
    return <div className="bot-output__scroll bc-scroll"><ol className="bot-output__cues" aria-label="字幕">
      {(cues || []).map((c, n) => <li key={n}>
        <span className="bot-output__time">{c.t}</span>
        <span className="bot-output__lines"><span>{c.src}</span><span className="bot-output__dst">{c.dst}</span></span>
      </li>)}
    </ol></div>;
  }

  /**
   * 推进右栏的产物页（需求 §11.6 修订）：头部是返回（回到任务详情）、种类图标、产物名与「种类 · 任务名」、
   * 视频多一个「在视频页打开」、占满（中间收起，右栏占满主区；窄时没有）与关闭（收起右栏）。
   */
  function BotOutputView({item, index, full, onBack, onToggleFull, onClose}) {
    const app = useApp();
    const R = window.RSP;
    const output = item ? item.outputs[index] : null;
    if (!output) return <div className="bot-missing"><span>这个产物已经不在了。</span>
      {item ? <R.Button variant="secondary" onPress={onBack}>回到任务</R.Button> : null}</div>;
    const kind = B.OUTPUT_KIND[output.kind] || B.OUTPUT_KIND.doc;
    const Icon = R.Icons[kind.icon];
    const project = output.kind === 'video' && output.project ? app.projById(output.project) : null;
    const body = output.kind === 'video' ? (output.project ? <BotOutputMovie projectId={output.project} onClose={onClose} /> : <Empty icon="film" title="这段视频没有登记到项目里" />)
      : output.kind === 'image' ? <BotOutputImages images={output.images} />
      : output.kind === 'subtitle' ? <BotOutputCues cues={output.cues} />
      : <BotOutputDoc body={output.body} />;
    return <section className="bot-output" aria-label={output.label}>
      <header className="bot-output__head">
        <R.ActionButton isQuiet size="S" aria-label={`回到任务「${item.title}」`} onPress={onBack}><R.Icons.ChevronLeft /></R.ActionButton>
        <span className="bot-output__kind" aria-hidden="true"><Icon /></span>
        <div className="bot-detail__heading">
          <h2 className="bot-detail__title" title={output.label}>{output.label}</h2>
          <span className="bot-detail__subline" title={item.title}>{`${kind.label} · ${item.title}`}</span>
        </div>
        {project ? <R.ActionButton isQuiet size="S" aria-label="在视频页打开" onPress={() => app.openMovie(project.id)}><R.Icons.OpenIn /></R.ActionButton> : null}
        {onToggleFull ? <R.ActionButton isQuiet size="S" aria-label={full ? '收回右栏' : '占满'} onPress={onToggleFull}>
          {full ? <R.Icons.FullScreenExit /> : <R.Icons.FullScreen />}
        </R.ActionButton> : null}
        <R.ActionButton isQuiet size="S" aria-label="关闭" onPress={onClose}><R.Icons.Close /></R.ActionButton>
      </header>
      <div className="bot-output__body">{body}</div>
    </section>;
  }

  Object.assign(window, {BotSideSeam, BotOutputLink, BotOutputView});
})();
