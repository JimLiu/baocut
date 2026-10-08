/* Per-conversation workspace metadata; editor state stays inside its view. */
(function () {
  const W = window.BC_HOME_WORKSPACE;
  function useHomeWorkspace(app) {
    const [book, setBook] = React.useState({});
    const [workspaceAttachments, setWorkspaceAttachments] = React.useState({});
    const [mediaBook, setMediaBook] = React.useState({});
    const [views, setViews] = React.useState({});
    const [fileTitleBook, setFileTitles] = React.useState({});
    const remembered = React.useRef({});
    const current = W.reconcile(book, app.route);
    React.useEffect(() => { if (current !== book) setBook(current); }, [current, book]);
    // Session id, or a `draft:` key before the first message (BC_HOME_WORKSPACE.keyFor).
    const sid = W.keyFor(app.route);
    const workspaceSessionId = app.route.r === 'agent' ? app.route.id || null : null;
    const workspace = current[sid] || W.empty();
    const workspaceFileTitles = fileTitleBook[sid] || {};
    const setWorkspaceFileTitle = (id, title) => setFileTitles(previous => previous[sid]?.[id] === title ? previous : {...previous, [sid]: {...previous[sid], [id]: title}});
    const workspaceMediaState = mediaBook[sid] || {comments: {}, drafts: {}};
    const updateWorkspaceMediaState = update => setMediaBook(previous => ({...previous, [sid]: update(previous[sid] || {comments: {}, drafts: {}})}));
    if (workspace.active) remembered.current[sid] = workspace.active;
    const view = views[sid] || {};
    const workspaceVisible = !!workspace.active && !view.hidden;
    const workspaceDockW = app.prefs.workspaceDockW ?? app.dockW;
    const resizeWorkspace = (width, available) => {
      const next = W.resizeSplit(width, available);
      // Collapsing retains the last usable split for the existing reopen control.
      if (!next.hidden) app.setPref('workspaceDockW', next.width);
      setViews(previous => ({...previous, [sid]: {...previous[sid], hidden: next.hidden, full: false}}));
    };
    // Full view is a mode of its own: its conversation tab can be selected (pane hidden).
    const workspaceFull = !!view.full;
    const show = sessionId => setViews(previous => ({...previous, [sessionId]: {...previous[sessionId], hidden: false}}));
    const keepConversation = React.useRef(false);
    React.useEffect(() => {
      if (keepConversation.current) { keepConversation.current = false; return; }
      if (sid) setViews(previous => ({...previous, [sid]: {...previous[sid], hidden: false}}));
    }, [sid, workspace.active]);
    const selectWorkspaceTab = key => {
      const item = workspace.tabs.find(t => t.key === key);
      if (item) { show(sid); app.go(W.route(sid, item)); }
    };
    const closeWorkspaceTab = key => {
      const closing = workspace.tabs.find(t => t.key === key);
      if (closing?.kind === 'file') setFileTitles(previous => { const next = {...previous[sid]}; delete next[closing.id]; return {...previous, [sid]: next}; });
      const next = W.close(workspace, key);
      setBook({...current, [sid]: next});
      // Full view needs a tab; closing the last one returns to the plain conversation.
      if (!next.tabs.length && workspaceFull) setViews(previous => ({...previous, [sid]: {...previous[sid], full: false, hidden: false}}));
      // Closing the remembered pane behind a selected conversation tab must not pull
      // the view onto its neighbour (product-design §2.5).
      if (workspace.active === key && workspaceSingle && !workspaceVisible && next.active) keepConversation.current = true;
      if (workspace.active === key) app.replace(W.route(sid, next.tabs.find(t => t.key === next.active)));
    };
    const openWorkspaceFile = (id, sessionId = sid) => { show(sessionId); app.go(W.route(sessionId, {kind: 'file', id})); };
    const openWorkspaceAttachment = file => {
      setWorkspaceAttachments(previous => ({...previous, [file.id]: file}));
      setWorkspaceFileTitle(file.id, file.name);
      openWorkspaceFile(file.id);
    };
    const openWorkspaceBrowser = () => { show(sid); app.go(W.route(sid, {kind: 'web', id: crypto.randomUUID(), url: ''})); };
    const openMovie = (id, options) => { show(options?.sid || sid); app.openMovie(id, options); };
    // 「新建网页」on a new tab's start page: a demo HTML file in the session's project.
    // It takes the start page's slot (BC_HOME_WORKSPACE.replace), so no empty start page is left.
    const replaceWorkspaceTab = (replaceKey, item) => {
      if (!replaceKey || !workspace.tabs.some(t => t.key === replaceKey)) { openWorkspaceFile(item.id); return; }
      setBook({...current, [sid]: W.replace(workspace, replaceKey, item)});
      show(sid);
      app.replace(W.route(sid, item));
    };
    const createWorkspacePage = replaceKey => {
      const session = workspaceSessionId && app.sessionById(workspaceSessionId);
      const page = app.createHtmlPage(session ? app.dirOfSession(session) : app.route.dir || null, workspaceSessionId);
      if (page) replaceWorkspaceTab(replaceKey, {key: 'file:' + page.id, kind: 'file', id: page.id});
      return page;
    };
    // 「浏览项目文件」on the start page: the project file browser takes the start page's slot too.
    const browseWorkspaceFiles = replaceKey => replaceWorkspaceTab(replaceKey, {key: 'file:__browse__', kind: 'file', id: '__browse__'});
    const rememberedItem = () => workspace.tabs.find(t => t.key === (workspace.active || remembered.current[sid])) || workspace.tabs.at(-1);
    // Leaving full view: conversation on the left, the last active tab on the right.
    const exitFull = () => {
      setViews(previous => ({...previous, [sid]: {...previous[sid], full: false, hidden: false}}));
      const item = !workspace.active && rememberedItem();
      if (item) app.go(W.route(sid, item));
    };
    const toggleWorkspace = () => {
      const state = W.tabsButton({count: workspace.tabs.length, visible: workspaceVisible, full: workspaceFull});
      if (state.action === 'open') openWorkspaceBrowser();
      else if (state.action === 'split') exitFull();
      else if (state.action === 'hide') setViews(previous => ({...previous, [sid]: {...previous[sid], hidden: true}}));
      else {
        const item = rememberedItem();
        if (item) { show(sid); app.go(W.route(sid, item)); }
      }
    };
    // product-design §2.5 / §3.3: in a narrow or full workspace the conversation is the
    // pinned first tab. Selecting it only hides the pane view; route, tabs and editor state stay.
    const showConversation = () => setViews(previous => ({...previous, [sid]: {...previous[sid], hidden: true}}));
    const [workspaceWidth, setWorkspaceWidth] = React.useState(0);
    const [workspaceNarrow, setNarrow] = React.useState(false);
    const live = React.useRef(null);
    live.current = {sid, visible: workspaceVisible, hidden: !!view.hidden};
    const narrowRef = React.useRef(null);
    const hiddenBeforeNarrow = React.useRef({});
    // Only a mode flip changes state; the first measurement of a mounted workspace
    // just records the mode, so a narrow deep link keeps showing its pane. No other
    // automatic switching: only user actions leave the conversation (§2.5).
    const workspaceRef = React.useCallback(el => {
      if (!el) return undefined;
      const observer = new ResizeObserver(([entry]) => {
        setWorkspaceWidth(entry.contentRect.width);
        const next = W.isNarrow(entry.contentRect.width);
        const previous = narrowRef.current;
        narrowRef.current = next;
        if (previous === next) return;
        const {sid: id, visible, hidden} = live.current;
        if (previous !== null && id) {
          if (next) {
            hiddenBeforeNarrow.current[id] = hidden;
            const focus = document.activeElement?.closest?.('.home-workspace__conversation');
            if (W.narrowShowsConversation(!!focus, visible)) setViews(views => ({...views, [id]: {...views[id], hidden: true}}));
          } else {
            // Back to two columns: conversation and the remembered pane both return,
            // unless the pane had been hidden on purpose before narrowing and still is.
            const keep = hiddenBeforeNarrow.current[id] && hidden;
            delete hiddenBeforeNarrow.current[id];
            if (!keep) show(id);
          }
        }
        setNarrow(next);
      });
      observer.observe(el);
      return () => { observer.disconnect(); narrowRef.current = null; };
    }, []);
    // product-design §2.5 / §3.3: narrow and full view share the single tab strip.
    const workspaceSingle = workspaceNarrow || workspaceFull;
    const workspaceConversation = workspaceSingle && !workspaceVisible;
    // Entering full view selects what was on screen (BC_HOME_WORKSPACE.fullViewEntry);
    // with no tabs it is just the conversation tab — never auto-open a tab here.
    const toggleWorkspaceFull = () => {
      if (workspaceFull) { exitFull(); return; }
      const conversation = W.fullViewEntry(workspaceVisible, workspace.active) === W.CONVERSATION;
      setViews(previous => ({...previous, [sid]: {...previous[sid], full: true, hidden: conversation}}));
    };
    // Tabs list popover: open a tab in the split, or straight into full view.
    const showWorkspaceTab = (key, full = false) => {
      const item = workspace.tabs.find(t => t.key === key);
      if (!item) return;
      setViews(previous => ({...previous, [sid]: {...previous[sid], hidden: false, full}}));
      app.go(W.route(sid, item));
    };
    // The first message turns a draft into a session; tabs opened before it move along.
    const carryDraft = session => {
      if (!String(sid).startsWith('draft:') || !session?.id) return false;
      setBook(previous => W.carry(W.reconcile(previous, app.route), sid, session.id));
      setViews(previous => W.carry(previous, sid, session.id));
      setMediaBook(previous => W.carry(previous, sid, session.id));
      setFileTitles(previous => W.carry(previous, sid, session.id));
      return true;
    };
    const finishDraftWorkspace = session => {
      if (carryDraft(session)) {
        keepConversation.current = true;
        app.replace(W.route(session.id, workspace.tabs.find(t => t.key === workspace.active)));
      } else app.replace({r: 'agent', id: session.id});
    };
    // Home's start page sends through openAgent, which picks its own destination.
    const openAgent = options => {
      const session = app.openAgent(options);
      if (!options?.sid && workspace.tabs.length) carryDraft(session);
      return session;
    };
    const moveWorkspaceTab = (key, targetKey, after) => setBook(previous => {
      const synced = W.reconcile(previous, app.route);
      return {...synced, [sid]: W.move(synced[sid] || W.empty(), key, targetKey, after)};
    });
    return {workspaceKey: sid, workspaceSessionId, workspaceSingle, showWorkspaceTab, finishDraftWorkspace, openAgent, createWorkspacePage, browseWorkspaceFiles, workspaceAttachments, openWorkspaceAttachment, workspaceMediaState, updateWorkspaceMediaState, workspaceFileTitles, setWorkspaceFileTitle, workspace, workspaceVisible, workspaceFull, workspaceNarrow, workspaceConversation, workspaceRef, showConversation,
      workspaceWidth, workspaceDockW, resizeWorkspace, toggleWorkspace, toggleWorkspaceFull,
      selectWorkspaceTab, closeWorkspaceTab, moveWorkspaceTab, openWorkspaceFile, openWorkspaceBrowser, openMovie};
  }
  Object.assign(window, {useHomeWorkspace});
})();
