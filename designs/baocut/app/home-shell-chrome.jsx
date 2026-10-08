/* App shell chrome (product-design §2.5 / §3.3 user revision): the title bar's
   workspace view controls, the tab hover thumbnail and the sidebar peek.
   App entry only — the Web entry never loads app/home-*. */
(function () {
  const {useState, useRef, useEffect, useLayoutEffect} = React;
  const R = window.RSP;
  const W = window.BC_HOME_WORKSPACE;
  const AP = window.BC_AGENT_PROJECTS;
  const SESSION_STATUS = {running: '进行中', waiting: '待允许'};

  /* Shell glyphs (assets/shell, drawn on the S2 20-px grid) are single-colour SVGs used as
     a mask, so they follow currentColor through hover, pressed and disabled states. The mask
     URLs live in home-shell-chrome.css, where the build versions them by content. */
  function ShellIcon({name}) {
    return <span aria-hidden="true" className={`shell-icon shell-icon--${name}`} />;
  }

  function ShellButton({name, label, onPress, pressed, tooltip = true, className, children, ...rest}) {
    return <R.TooltipTrigger isDisabled={!tooltip}>
      <R.ActionButton isQuiet aria-label={label} aria-pressed={pressed} onPress={onPress}
        UNSAFE_className={cx('shell-button', className)} {...rest}>
        {children || <ShellIcon name={name} />}
      </R.ActionButton>
      <R.Tooltip>{label}</R.Tooltip>
    </R.TooltipTrigger>;
  }

  /* The tabs button's icon: a tab frame with a centred overlay on the same 20-px grid — a
     small plus with no tab open, otherwise the count (9+ above nine). */
  function TabStackIcon({state}) {
    return <span className="shell-tabstack" aria-hidden="true">
      <ShellIcon name="tabs" />
      <span className="shell-tabstack__overlay">
        {state.overlay ? <ShellIcon name={state.overlay} />
          : <span className={cx('shell-tabstack__count', state.badge.length > 1 && 'is-wide')}>{state.badge}</span>}
      </span>
    </span>;
  }

  /* Tabs button: opens the first tab, then hides / shows the split (or leaves full view).
     With the split hidden it shows the tab count, and hovering it (or ArrowDown) lists the
     tabs; a row opens that tab in the split, the row's trailing button in full view. With
     the split visible or in full view it is a plain hide-tabs icon button. */
  function ShellTabsButton() {
    const app = useApp();
    const {tabs} = app.workspace;
    const state = W.tabsButton({count: tabs.length, visible: app.workspaceVisible, full: app.workspaceFull});
    const [open, setOpen] = useState(false);
    const anchor = useRef(null);
    const list = useRef(null);
    const timer = useRef(null);
    const close = () => { clearTimeout(timer.current); setOpen(false); };
    // Only the count state (split hidden) lists the open tabs; the hide-tabs icon does not.
    const listed = !!state.badge;
    const enter = () => { clearTimeout(timer.current); if (listed && !open) timer.current = setTimeout(() => setOpen(true), 300); };
    const leave = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 150); };
    useEffect(() => () => clearTimeout(timer.current), []);
    useEffect(() => { if (!listed) close(); }, [listed]);
    useEffect(() => {
      if (!open) return undefined;
      const escape = e => {
        if (e.key !== 'Escape') return;
        const inside = list.current?.contains(document.activeElement);
        close();
        if (inside) requestAnimationFrame(() => anchor.current?.querySelector('button')?.focus());
      };
      // Capture phase: decide before the popover's own Escape handling moves focus.
      window.addEventListener('keydown', escape, true);
      return () => window.removeEventListener('keydown', escape, true);
    }, [open]);
    // Keyboard: ArrowDown on the button opens the list and moves into its first row.
    const keys = e => {
      if (e.key !== 'ArrowDown' || !listed || list.current?.contains(e.target)) return;
      e.preventDefault(); clearTimeout(timer.current); setOpen(true);
      requestAnimationFrame(() => requestAnimationFrame(() => list.current?.querySelector('.shell-tabs__open')?.focus()));
    };
    const active = app.workspaceConversation ? null : app.workspace.active;
    const run = fn => { close(); fn(); };
    return <span ref={anchor} className="shell-tabs" onPointerEnter={enter} onPointerLeave={leave} onKeyDown={keys}>
      <ShellButton label={state.label} tooltip={!open} onPress={() => run(app.toggleWorkspace)}
        aria-description={listed ? `${state.count} 个已打开的标签页` : undefined} aria-haspopup={listed ? 'dialog' : undefined} aria-expanded={listed ? open : undefined}>
        {state.icon ? <ShellIcon name={state.icon} /> : <TabStackIcon state={state} />}
      </ShellButton>
      {listed ? <Popover nonModal open={open} onClose={close} anchorRef={anchor} align="right" width={280} label="已打开的标签页" padding="none">
        <div className="shell-tabs__list" ref={list} onPointerEnter={enter} onPointerLeave={leave}>
          <h2 className="shell-tabs__head">已打开的标签页</h2>
          {tabs.map(item => {
            const name = window.workspaceTabName(app, item);
            const on = active === item.key;
            return <div key={item.key} className={cx('shell-tabs__row', on && 'is-active')}>
              <BCAction className="shell-tabs__open" aria-current={on ? 'true' : undefined} title={name}
                onClick={() => run(() => app.showWorkspaceTab(item.key))}>
                {window.workspaceTabIcon(item)}<span>{name}</span>
              </BCAction>
              <ShellButton name="full" className="shell-tabs__full" label={`在完整视图中打开「${name}」`} tooltip={false}
                onPress={() => run(() => app.showWorkspaceTab(item.key, true))} />
            </div>;
          })}
        </div>
      </Popover> : null}
    </span>;
  }

  function ShellSummaryButton() {
    const app = useApp();
    const [open, setOpen] = useState(false);
    const anchor = useRef(null);
    const sess = app.sessionById(app.workspaceSessionId);
    useEffect(() => setOpen(false), [sess?.id]);
    if (!sess) return null;
    const items = AP.artifactList(sess, app.spaceItems, app.tasks);
    const status = SESSION_STATUS[sess.status];
    return <span ref={anchor} className="shell-summary-anchor">
      <ShellButton name="summary" label="会话摘要" tooltip={!open} pressed={open} onPress={() => setOpen(v => !v)} />
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} align="right" width={360} label="会话摘要">
        <section className="shell-summary">
          <h2 className="shell-summary__title">{sess.title || '新会话'}</h2>
          {status ? <p className={cx('shell-summary__status', sess.status === 'waiting' && 'is-waiting')} role="status">{status}</p> : null}
          <h3 className="shell-summary__section">产物 · {items.length}</h3>
          {items.map(item => <window.SessionArtifactCard key={item.id} item={item} sess={sess} onOpen={() => setOpen(false)} />)}
          {!items.length ? <p className="shell-summary__empty">这条会话还没有产物。</p> : null}
        </section>
      </Popover>
    </span>;
  }

  /* With the split pane visible the summary belongs to the conversation column: it sits in
     the title-bar session head right after ···, left of the column divider, and the right
     group keeps only [full view][tabs]. Collapsed split, full view and narrow mode keep it
     on the right. shell.jsx and the controls both ask this one question. */
  function summaryInHead(app) {
    return !!app.workspaceVisible && !app.workspaceSingle && app.workspace.tabs.length > 0;
  }

  /* [summary][full view][tabs] — tabs stay rightmost. Narrow mode is already a single
     strip, so it keeps only the summary. */
  function ShellViewControls() {
    const app = useApp();
    const narrow = !!app.workspaceNarrow;
    const full = app.workspaceFull;
    return <div className="home-workspace-controls" role="group" aria-label="工作区视图">
      {!summaryInHead(app) ? <ShellSummaryButton /> : null}
      {!narrow && app.workspace.tabs.length ? <ShellButton name={full ? 'exit-full' : 'full'} label={full ? '退出完整视图' : '进入完整视图'}
        pressed={full} onPress={app.toggleWorkspaceFull} /> : null}
      {!narrow ? <ShellTabsButton /> : null}
    </div>;
  }

  /* Tab hover thumbnail: an inert clone of the tab's pane, scaled into the card. Media,
     frames and scripts are dropped; canvases are copied pixel for pixel. */
  function WorkspaceTabPreview({item, rect, title}) {
    const app = useApp();
    const target = useRef(null);
    const [empty, setEmpty] = useState(false);
    useLayoutEffect(() => {
      const pane = item.key === W.CONVERSATION ? document.querySelector('.home-workspace__conversation')
        : document.getElementById('workspace-panel-' + encodeURIComponent(item.key));
      if (!pane || !target.current) { setEmpty(true); return; }
      const copy = pane.cloneNode(true);
      ['hidden', 'id', 'role', 'aria-labelledby'].forEach(a => copy.removeAttribute(a));
      copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      copy.querySelectorAll('iframe, video, audio, script').forEach(el => el.remove());
      copy.querySelectorAll('[hidden]').forEach(el => { el.hidden = false; });
      [copy, ...copy.querySelectorAll('[style]')].forEach(el => {
        if (el.style.getPropertyPriority('display') === 'important') el.style.removeProperty('display');
      });
      copy.inert = true;
      copy.classList.add('shell-tab-preview__clone');
      const originals = pane.querySelectorAll('canvas');
      copy.querySelectorAll('canvas').forEach((el, i) => {
        try { el.width = originals[i].width; el.height = originals[i].height; el.getContext('2d').drawImage(originals[i], 0, 0); } catch {}
      });
      target.current.replaceChildren(copy);
    }, [item.key]);
    const file = item.kind === 'file' ? app.spaceItems.find(x => x.id === item.id) : null;
    const dir = file?.dir ? app.dirById(file.dir) : null;
    const sub = item.key === W.CONVERSATION ? '会话'
      : item.kind === 'web' ? item.url || '新标签页'
      : file ? (dir ? `${dir.path}/${file.file || file.name}` : file.file || file.name) : title;
    return ReactDOM.createPortal(<div className="shell-tab-preview" role="tooltip"
      style={{left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)), top: rect.bottom + 8}}>
      <div className={cx('shell-tab-preview__image', empty && 'is-empty')} ref={target} />
      <strong className="shell-tab-preview__title">{title}</strong>
      <span className="shell-tab-preview__path">{sub}</span>
    </div>, document.body);
  }

  Object.assign(window, {ShellIcon, ShellButton, ShellSummaryButton, ShellViewControls, WorkspaceTabPreview, summaryInHead});
})();

(function () {
  const {useState, useRef, useEffect, useLayoutEffect} = React;
  const IA = window.BC_APP_IA;
  // Inset from the sheet; the peek's corner radius (home-shell-chrome.css) is the sheet's 16px minus this.
  const PEEK_INSET = 6;
  const KEEP_OPEN = '.shell-side-peek:focus-within, [role="menu"], [role="dialog"], [role="alertdialog"]';

  /* Sidebar peek (product-design §2.2 user revision): with the sidebar hidden, hovering a
     rail entry or the title bar's sidebar toggle floats that page's sidebar over the sheet. */
  function useShellPeek(app) {
    const [peek, setPeek] = useState(null);
    const timer = useRef(null);
    const cancel = () => clearTimeout(timer.current);
    const closePeek = () => { cancel(); setPeek(null); };
    const peekSidebar = kind => {
      cancel();
      if (!app.sidebar.ghost || !kind || kind === 'settings') return;
      timer.current = setTimeout(() => setPeek(kind), 100);
    };
    const leaveSidebar = () => {
      cancel();
      timer.current = setTimeout(() => { if (!document.querySelector(KEEP_OPEN)) setPeek(null); }, 100);
    };
    useEffect(() => { closePeek(); }, [app.route, app.sidebar.ghost]);
    useEffect(() => {
      if (!peek) return undefined;
      const escape = e => { if (e.key === 'Escape' && !document.querySelector('[role="menu"], [role="dialog"]')) closePeek(); };
      const outside = e => {
        if (e.target.closest?.('.shell-side-peek, .apprail, .tbar__nav, [role="menu"], [role="dialog"], [data-rac][role="presentation"]')) return;
        closePeek();
      };
      window.addEventListener('keydown', escape);
      document.addEventListener('pointerdown', outside, true);
      return () => { window.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside, true); };
    }, [peek]);
    useEffect(() => cancel, []);
    return {peek, peekSidebar, leaveSidebar, keepSidebar: cancel, closePeek};
  }

  function ShellPeek({state}) {
    const app = useApp();
    const kind = state?.peek;
    const [box, setBox] = useState(null);
    useLayoutEffect(() => {
      if (!kind) return undefined;
      const sheet = document.querySelector('.appsheet');
      const sync = () => {
        const r = sheet?.getBoundingClientRect();
        if (r) setBox({left: r.left + PEEK_INSET, top: r.top + PEEK_INSET, bottom: window.innerHeight - r.bottom + PEEK_INSET});
      };
      sync();
      window.addEventListener('resize', sync);
      return () => window.removeEventListener('resize', sync);
    }, [kind]);
    if (!kind || !app.sidebar.ghost || !box) return null;
    const Side = kind === 'home' ? window.HomeSidebar : kind === 'space' ? window.SpaceSidebar : window.UtilitySidebar;
    const current = kind === IA.sideOf(app.route);
    const route = current ? app.route : IA.railTarget(app.nav, kind) || app.route;
    const closing = fn => (...args) => { state.closePeek(); return fn?.(...args); };
    const context = {...app, route, go: closing(app.go), replace: closing(app.replace), railGo: closing(app.railGo)};
    // Pin: show the real sidebar; a peek of another rail entry also goes there.
    const pin = () => {
      state.closePeek();
      if (app.sidebar.ghost) app.toggleSidebar();
      if (!current) app.go(route);
    };
    return <div className="shell-side-peek" style={box} onPointerEnter={state.keepSidebar} onPointerLeave={state.leaveSidebar}
      onFocus={state.keepSidebar} onBlur={state.leaveSidebar}>
      <window.AppCtx.Provider value={context}><Side kind={kind} /></window.AppCtx.Provider>
      <div className="shell-side-peek__pin"><window.ShellButton name="sidebar" label="固定侧边栏" onPress={pin} /></div>
    </div>;
  }

  Object.assign(window, {useShellPeek, ShellPeek});
})();
