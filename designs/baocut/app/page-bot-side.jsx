/* Bot 页的右栏（docs/design/bot-mode/bot-mode-requirements.md §11.1、§11.6 的修订稿）—— 只在 App 入口加载。
   右栏照 Home 的功能区（product-design §3.3）是一条页签条，和 Home 一样放在标题栏里、左缘对齐右栏：固定的「任务」「Make」，后面是打开的任务与产物；
   分隔条（中间 ∣ 右栏，占满时左栏 ∣ 右栏：拖动、方向键调宽，双击回到默认宽）；任务详情与线程里的产物卡；
   产物页签：视频是嵌进来的编辑器，文档、封面、字幕各有一个只读预览。页签簿与宽度规则在 model-bot.js。 */
(function () {
  const {useState, useEffect, useRef, useLayoutEffect} = React;
  const B = window.BC_BOT;

  /* ---------- 分隔条 ---------- */

  /**
   * 两栏之间的分隔条：调的是它右边那一栏（中间 ∣ 右栏）时往左拖变宽；`start` 时调的是左边那一栏（占满时的左栏），往右拖变宽。
   * 方向键每次 16；双击回到默认宽。不用壳层的 seam--dock：标题栏只在挂载时量一次那些分隔线，右栏随时开合，
   * 标题栏上对应的那根竖线由页签条自己画（.tbar__workspace--bot::before）。
   */
  function BotSideSeam({width, min, max, start: grows = false, label = '调整右栏宽度', onResize, onReset}) {
    const start = useRef(null);
    const [dragging, setDragging] = useState(false);
    const finish = e => {
      if (!start.current || start.current.id !== e.pointerId) return;
      start.current = null;
      setDragging(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    };
    const sign = grows ? 1 : -1;
    const follow = e => { if (start.current?.id === e.pointerId) onResize(start.current.width + sign * (e.clientX - start.current.x)); };
    return <div className={cx('bot__seam', dragging && 'is-drag')} role="separator" aria-label={label} aria-orientation="vertical" tabIndex={0}
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
        onResize(width + sign * (e.key === 'ArrowLeft' ? -16 : 16));
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
   * 产物页签（需求 §11.6 修订）：头部是种类图标、产物名与「种类 · 任务名」（任务名按下切到那个任务的页签），
   * 视频多一个「在视频页打开」。返回、占满与关闭都在页签条上。`onClose` 只给嵌进来的编辑器用（它的「关闭视频」关掉这个页签）。
   */
  function BotOutputView({item, index, onOpenTask, onClose}) {
    const app = useApp();
    const R = window.RSP;
    const output = item ? item.outputs[index] : null;
    if (!output) return <div className="bot-missing"><span>这个产物已经不在了。</span>
      {item ? <R.Button variant="secondary" onPress={onOpenTask}>打开任务</R.Button> : null}</div>;
    const kind = B.OUTPUT_KIND[output.kind] || B.OUTPUT_KIND.doc;
    const Icon = R.Icons[kind.icon];
    const project = output.kind === 'video' && output.project ? app.projById(output.project) : null;
    const body = output.kind === 'video' ? (output.project ? <BotOutputMovie projectId={output.project} onClose={onClose} /> : <Empty icon="film" title="这段视频没有登记到项目里" />)
      : output.kind === 'image' ? <BotOutputImages images={output.images} />
      : output.kind === 'subtitle' ? <BotOutputCues cues={output.cues} />
      : <BotOutputDoc body={output.body} />;
    return <section className="bot-output" aria-label={output.label}>
      <header className="bot-output__head">
        <span className="bot-output__kind" aria-hidden="true"><Icon /></span>
        <div className="bot-detail__heading">
          <h2 className="bot-detail__title" title={output.label}>{output.label}</h2>
          <span className="bot-detail__subline">{`${kind.label} · `}<button type="button" className="bot-output__task" title={item.title}
            aria-label={`打开任务「${item.title}」`} onClick={onOpenTask}>{item.title}</button></span>
        </div>
        {project ? <R.ActionButton isQuiet size="S" aria-label="在视频页打开" onPress={() => app.openMovie(project.id)}><R.Icons.OpenIn /></R.ActionButton> : null}
      </header>
      <div className="bot-output__body">{body}</div>
    </section>;
  }

  /* ---------- 页签条 ---------- */

  const tabDomId = key => 'bot-side-tab-' + encodeURIComponent(key);
  /** 窄时最前面的那个页签（频道或「等你处理」）的键；它管的是中间栏。 */
  const HOME_TAB = 'home';

  /**
   * 右栏的页签条（照 Home 功能区的页签条，product-design §3.3；样子用同一套 .home-tabs__*，BotPage 把它放进标题栏）：
   * 频道里最前面是「任务」（有等你的事时带点，不显示数）与「Make」（有建议时带点），和打开的任务（状态图标 + 任务名）、产物（种类图标 + 名字）一样能关，
   * 只是不拖、宽度按内容；关掉后由频道头的开关再打开（BotPage）。收件箱没有这两个。
   * 窄时照 Home 窄时的会话页签：中间栏变成最前面一个固定页签（`home`：频道或「等你处理」，蓝底、不能关、后面一道分隔），
   * 这时没有完整视图与收起右栏——选它就是收起。✕、中键或选中时按 Delete 关页签；左右方向键、Home、End 在页签之间移动并选中。
   * 条的右端照 Home 标题栏的视图按钮：完整视图（窄时没有）与收起右栏。拖动排序、悬停缩略图与「+」原型不做。
   */
  function BotSideTabs({home, fixed, selected, tabs, waiting, suggestions, full, onToggleFull, onHide, onFixed, onCloseFixed, onSelect, onClose}) {
    const R = window.RSP;
    const bot = window.useBot();
    const list = useRef(null);
    const views = fixed.map(kind => ({key: `fixed:${kind}`, kind}));
    const order = [...(home ? [{key: HOME_TAB, kind: 'home'}] : []), ...views, ...tabs];
    const pick = tab => (tab.kind === 'home' ? home.onSelect() : tab.key.startsWith('fixed:') ? onFixed(tab.kind) : onSelect(tab));
    const focus = key => requestAnimationFrame(() => document.getElementById(tabDomId(key))?.focus());
    useLayoutEffect(() => {
      list.current?.querySelector('.is-active')?.scrollIntoView({block: 'nearest', inline: 'nearest'});
    }, [selected, tabs.length]);
    const look = tab => {
      if (tab.kind === 'home') return home;
      if (tab.kind === 'tasks') return {name: '任务', aria: waiting ? `任务，${waiting} 个等你` : '任务', icon: <R.Icons.ViewList />,
        extra: waiting ? <i className="bot-side-tabs__dot" /> : null};
      if (tab.kind === 'make') return {name: 'Make', aria: suggestions ? `Make，${suggestions} 条建议` : 'Make', icon: <R.Icons.MagicWand />,
        extra: suggestions ? <i className="bot-side-tabs__dot" /> : null};
      const item = bot.items.find(i => i.id === tab.task);
      if (tab.kind === 'task') {
        if (!item) return {name: '已删除的任务', aria: '已删除的任务', icon: <R.Icons.FileText />};
        const status = B.statusOf(item);
        return {name: item.title, aria: `任务「${item.title}」，${status.label}`, icon: <window.BotStatusIcon statusKey={status.key} />};
      }
      const output = item ? item.outputs[tab.index] : null;
      if (!output) return {name: '已不在的产物', aria: '已不在的产物', icon: <R.Icons.FileText />};
      const kind = B.OUTPUT_KIND[output.kind] || B.OUTPUT_KIND.doc;
      const Icon = R.Icons[kind.icon];
      return {name: output.label, aria: `${kind.label}「${output.label}」`, icon: <Icon />};
    };
    const close = tab => {
      const at = order.findIndex(t => t.key === tab.key);
      if (tab.key.startsWith('fixed:')) onCloseFixed(tab.kind); else onClose(tab);
      const next = order.filter(t => t.key !== tab.key);
      focus((next[Math.min(at, next.length - 1)] || {}).key);
    };
    const keys = e => {
      if (e.target.getAttribute('role') !== 'tab') return;
      const at = order.findIndex(t => tabDomId(t.key) === e.target.id);
      const n = order.length;
      const to = e.key === 'ArrowRight' ? (at + 1) % n : e.key === 'ArrowLeft' ? (at + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
      if (to != null) { e.preventDefault(); pick(order[to]); focus(order[to].key); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(order[at]); }
      else if (e.key === 'Delete' && order[at].kind !== 'home') { e.preventDefault(); close(order[at]); }
    };
    const tab = (t, className) => {
      const {name, aria, icon, extra} = look(t);
      const on = selected === t.key;
      const closable = t.kind !== 'home';
      return <div key={t.key} role="presentation" className={cx('home-tabs__item', className, on && 'is-active')}
        onAuxClick={closable ? e => { if (e.button === 1) { e.preventDefault(); close(t); } } : undefined}>
        <div role="tab" id={tabDomId(t.key)} aria-controls={t.kind === 'home' ? home.panel : 'bot-side-panel'} aria-selected={on} aria-label={aria}
          tabIndex={on ? 0 : -1} className="home-tabs__target">
          <span className="home-tabs__button" aria-hidden="true"><BCAction excludeFromTabOrder className="home-tabs__select" title={name} onClick={() => pick(t)}>
            {icon}<span>{name}</span>{extra}
          </BCAction></span>
        </div>
        {closable ? <R.ActionButton size="XS" isQuiet UNSAFE_className="home-tabs__close" aria-label={`关闭页签「${name}」`} onPress={() => close(t)}><R.Icons.Close /></R.ActionButton> : null}
      </div>;
    };
    const S = window.ShellButton;
    return <div className="home-tabs bot-side-tabs">
      <div className="home-tabs__strip" role="tablist" aria-label="右栏页签" onKeyDownCapture={keys}>
        {home ? tab({key: HOME_TAB, kind: 'home'}, 'home-tabs__conversation') : null}
        <div className="home-tabs__list bc-scroll" ref={list} role="presentation">
          {views.map(t => tab(t, 'bot-side-tabs__view'))}{tabs.map(t => tab(t))}
        </div>
      </div>
      <span className="grow" />
      {onToggleFull || onHide ? <div className="bot-side-tabs__controls" role="group" aria-label="右栏视图">
        {onToggleFull ? <S name={full ? 'exit-full' : 'full'} label={full ? '退出完整视图' : '进入完整视图'} pressed={full} onPress={onToggleFull} /> : null}
        {onHide ? <S name="hide-tabs" label="收起右栏" onPress={onHide} /> : null}
      </div> : null}
    </div>;
  }

  Object.assign(window, {BotSideSeam, BotOutputLink, BotOutputView, BotSideTabs, botSideTabId: tabDomId, BOT_HOME_TAB: HOME_TAB});
})();
