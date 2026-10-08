/* Home's multi-resource workspace (product-design §2.5 / §3.3 user revision).
   Browser-shaped tab containers use native S2 actions, with sibling close buttons
   and keep tab selection separate from the close action. */
(function () {
  const {useState, useRef, useEffect, useLayoutEffect} = React;
  const W = window.BC_HOME_WORKSPACE;
  const R = window.RSP;
  const panelId = key => 'workspace-panel-' + encodeURIComponent(key);
  const tabId = key => 'workspace-tab-' + encodeURIComponent(key);
  // product-design §2.5 / §3.3: the narrow / full workspace's pinned first tab. It lives
  // outside `tabs`, so moving, closing, routing and the tab list menu never see it.
  const CONVERSATION = W.CONVERSATION;
  const SESSION_STATUS = {running: '进行中', waiting: '待允许'};
  // Shared by the tab strip, the drag ghost and the title bar's open-tabs list.
  const workspaceTabName = (app, item) => item.id === '__browse__' ? '项目文件' : (item.kind === 'file' && app.workspaceFileTitles[item.id]) || W.title(item, app.spaceItems);
  const workspaceTabIcon = item => item.kind === 'file' && item.id !== '__browse__' ? <R.Icons.FileText /> : <Ic n={item.kind === 'movie' ? 'film' : item.kind === 'web' ? 'web' : 'folder'} className="ic--16" />;

  function ConversationTab({hover}) {
    const app = useApp();
    const R = window.RSP;
    const sess = app.sessionById(app.workspaceSessionId);
    const title = sess?.title || '新会话';
    const status = sess && SESSION_STATUS[sess.status];
    const selected = app.workspaceConversation;
    const select = () => { app.showConversation(); document.getElementById(tabId(CONVERSATION))?.focus(); };
    // No data-workspace-tab and no pointer handlers: it cannot be dragged, and the
    // drag hit-test never offers a slot before it. It has no close button either.
    // Accent fill and ring plus a divider after it mark this one as the conversation,
    // pinned first; the tooltip says it cannot be dragged or closed. No icon on purpose.
    const tip = `会话「${title}」${status ? ` · ${status}` : ''} · 固定在第一位，不能拖动或关闭`;
    return <div className={cx('home-tabs__item home-tabs__conversation', selected && 'is-active')} role="presentation" {...hover({key: CONVERSATION, kind: 'conversation'}, title)}>
      <div role="tab" id={tabId(CONVERSATION)} aria-controls={panelId(CONVERSATION)} aria-selected={selected}
        aria-label={status ? `会话「${title}」，${status}，固定在第一位` : `会话「${title}」，固定在第一位`} tabIndex={selected ? 0 : -1} className="home-tabs__target">
        <span className="home-tabs__button" aria-hidden="true"><BCAction excludeFromTabOrder className="home-tabs__select" title={title} onClick={select}>
          <span className="home-tabs__glyph"><R.Icons.Comment />
            {status ? <i className={cx('home-tabs__dot', sess.status === 'waiting' && 'is-waiting')} /> : null}</span>
          <span>{title}</span><span className="mtip">{tip}</span>
        </BCAction></span>
      </div>
    </div>;
  }

  function WorkspaceTabs() {
    const app = useApp();
    const list = useRef(null);
    const dragged = useRef(null);
    const suppressClick = useRef(false);
    const [preview, setPreview] = useState(null);
    const [announcement, announce] = useState('');
    const scrollFrame = useRef(null);
    const {tabs} = app.workspace;
    // Narrow and full view: one strip with the conversation pinned first.
    const narrow = app.workspaceSingle;
    // With the conversation tab selected, the remembered pane is not the selected tab.
    const active = app.workspaceConversation ? null : app.workspace.active;
    const name = item => workspaceTabName(app, item);
    const icon = workspaceTabIcon;
    // Hover thumbnail (product-design §2.5 user revision): after 500 ms, cancelled by
    // leaving, pressing or dragging.
    const [hoverTab, setHoverTab] = useState(null);
    const hoverTimer = useRef(null);
    useEffect(() => () => clearTimeout(hoverTimer.current), []);
    const clearHover = () => { clearTimeout(hoverTimer.current); setHoverTab(null); };
    const hover = (item, title) => ({
      onPointerEnter: e => {
        const rect = e.currentTarget.getBoundingClientRect();
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => { if (!dragged.current) setHoverTab({item, rect, title}); }, 500);
      },
      onPointerLeave: clearHover,
    });
    useLayoutEffect(() => {
      list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block: 'nearest', inline: 'nearest'});
    }, [active, tabs.length, narrow]);
    const keys = e => {
      if (e.key === 'Escape' && dragged.current) {
        e.preventDefault(); e.stopPropagation(); finishDrag(); return;
      }
      if (e.target.getAttribute('role') !== 'tab') return;
      const conversation = e.target.id === tabId(CONVERSATION);
      const i = tabs.findIndex(t => tabId(t.key) === e.target.id);
      if (e.altKey && e.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation();
        // The conversation tab stays first: it never moves, and tabs[-1] is empty.
        const offset = e.key === 'ArrowRight' ? 1 : -1;
        if (!conversation && tabs[i + offset]) app.moveWorkspaceTab(tabs[i].key, tabs[i + offset].key, offset > 0);
        return;
      }
      const order = [...(narrow ? [CONVERSATION] : []), ...tabs.map(t => t.key)];
      const at = conversation ? 0 : i + (narrow ? 1 : 0);
      const n = order.length;
      const next = !n ? null : e.key === 'ArrowRight' ? (at + 1) % n : e.key === 'ArrowLeft' ? (at + n - 1) % n
        : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
      const pick = key => key === CONVERSATION ? app.showConversation() : app.selectWorkspaceTab(key);
      if (next != null) {
        e.preventDefault(); e.stopPropagation(); pick(order[next]);
        document.getElementById(tabId(order[next]))?.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation(); pick(conversation ? CONVERSATION : tabs[i].key);
      } else if (e.key === 'Delete' && !conversation) {
        e.preventDefault(); e.stopPropagation(); close(tabs[i]);
      }
    };
    const close = item => {
      const next = W.close(app.workspace, item.key);
      app.closeWorkspaceTab(item.key);
      const stay = app.workspaceConversation;
      requestAnimationFrame(() => {
        const target = !stay && next.active ? document.getElementById(tabId(next.active))
          : narrow ? document.getElementById(tabId(CONVERSATION)) : document.querySelector('.tbar .hhd button');
        target?.focus();
      });
    };
    const finishDrag = () => {
      const drag = dragged.current;
      dragged.current = null;
      cancelAnimationFrame(scrollFrame.current); scrollFrame.current = null;
      if (drag?.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
      setPreview(null);
    };
    useEffect(() => {
      const cancel = () => { if (dragged.current?.active) announce('已取消拖动'); finishDrag(); };
      const escape = e => { if (e.key === 'Escape' && dragged.current) { e.preventDefault(); e.stopPropagation(); cancel(); } };
      const hidden = () => { if (document.hidden) cancel(); };
      window.addEventListener('blur', cancel);
      window.addEventListener('keydown', escape, true);
      document.addEventListener('visibilitychange', hidden);
      return () => { cancelAnimationFrame(scrollFrame.current); window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape, true); document.removeEventListener('visibilitychange', hidden); };
    }, []);
    const updatePreview = () => {
      const drag = dragged.current, strip = list.current;
      if (!drag?.active || !strip) return;
      const bounds = strip.getBoundingClientRect();
      const rects = drag.rects.map(r => ({...r, left: r.left - (strip.scrollLeft - drag.scrollLeft)}));
      const inside = drag.cy >= bounds.top - 24 && drag.cy <= bounds.bottom + 24 && drag.cx >= bounds.left - 24 && drag.cx <= bounds.right + 24;
      drag.target = inside ? W.dragTarget(rects, drag.key, drag.cx) : null;
      setPreview({item: drag.item, key: drag.key, width: drag.width,
        x: Math.max(0, Math.min(window.innerWidth - drag.width, drag.cx - drag.offsetX)),
        y: Math.max(4, Math.min(window.innerHeight - 40, drag.cy - drag.offsetY)),
        offsets: W.dragOffsets(rects, drag.key, drag.target), valid: inside});
    };
    const autoScroll = () => {
      const drag = dragged.current, strip = list.current;
      if (!drag?.active || !strip) return;
      const b = strip.getBoundingClientRect();
      if (drag.cy >= b.top - 24 && drag.cy <= b.bottom + 24) {
        const speed = drag.cx < b.left + 32 ? -8 : drag.cx > b.right - 32 ? 8 : 0;
        const before = strip.scrollLeft;
        strip.scrollLeft += speed;
        if (strip.scrollLeft !== before) updatePreview();
      }
      scrollFrame.current = requestAnimationFrame(autoScroll);
    };
    // Match the reference's drag overlay + sortable neighbors. Reordering commits
    // only on release, so Escape or leaving the strip preserves every pane.
    const dragMove = e => {
      const drag = dragged.current;
      if (!drag) return;
      if (!(e.buttons & 1)) { finishDrag(); return; }
      if (!drag.active && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.cx = e.clientX; drag.cy = e.clientY;
      if (!drag.active) {
        drag.element.setPointerCapture(e.pointerId);
        drag.active = true; suppressClick.current = true;
        announce(`正在拖动「${name(drag.item)}」，松开放置，Esc 取消`);
        scrollFrame.current = requestAnimationFrame(autoScroll);
      }
      e.preventDefault();
      updatePreview();
    };
    return <div className={cx('home-tabs', hoverTab && !preview && 'is-previewing')}>
      <div className="home-tabs__strip" role="tablist" aria-label="工作区标签页"
        aria-description="拖动标签调整顺序，也可按 Alt + Shift + 左右方向键。" onKeyDownCapture={keys}>
      {narrow ? <ConversationTab hover={hover} /> : null}
      <div className="home-tabs__list bc-scroll" ref={list} role="presentation">
        {tabs.map(item => <div key={item.key} className={cx('home-tabs__item', active === item.key && 'is-active',
          preview?.key === item.key && 'is-dragging')}
          style={preview ? {transform: `translateX(${preview.offsets[item.key] || 0}px)`} : undefined}
          role="presentation" data-workspace-tab={item.key} {...hover(item, name(item))} onPointerDownCapture={e => {
            clearHover(); suppressClick.current = false;
            if (e.button !== 0 || e.target.closest('.home-tabs__close')) return;
            const box = e.currentTarget.getBoundingClientRect();
            dragged.current = {key: item.key, item, element: e.currentTarget, pointerId: e.pointerId, x: e.clientX, y: e.clientY,
              width: box.width, offsetX: e.clientX - box.left, offsetY: e.clientY - box.top, scrollLeft: list.current.scrollLeft,
              rects: [...list.current.querySelectorAll('[data-workspace-tab]')].map(el => ({key: el.dataset.workspaceTab, left: el.getBoundingClientRect().left, width: el.getBoundingClientRect().width})), active: false, target: null};
          }} onPointerMove={dragMove} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
          onPointerUp={e => {
            const drag = dragged.current;
            if (drag?.active && drag.target) { app.moveWorkspaceTab(drag.key, drag.target.key, drag.target.after); announce(`已移动「${name(drag.item)}」`); }
            finishDrag();
          }} onClickCapture={e => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); } }}
          onAuxClick={e => { if (e.button === 1) { e.preventDefault(); close(item); } }}>
          <div role="tab" id={tabId(item.key)} aria-controls={panelId(item.key)} aria-selected={active === item.key}
            aria-label={name(item)} tabIndex={active === item.key ? 0 : -1} className="home-tabs__target">
          <span className="home-tabs__button" aria-hidden="true"><BCAction excludeFromTabOrder className="home-tabs__select" title={name(item)}
            onClick={() => { app.selectWorkspaceTab(item.key); document.getElementById(tabId(item.key))?.focus(); }}>
            {icon(item)}
            <span>{name(item)}</span><span className="mtip">{item.kind === 'web' && item.url ? item.url : name(item)}</span>
          </BCAction></span></div>
          <R.ActionButton size="XS" isQuiet UNSAFE_className="home-tabs__close" aria-label={`关闭标签页「${name(item)}」`} onPress={() => close(item)}><R.Icons.Close /></R.ActionButton>
        </div>)}
      </div>
      </div>
      {/* 「+」直接开一个空网址的网页页签（落到起始页），与标题栏「打开新标签页」同一条路径 */}
      <R.ActionButton isQuiet aria-label="打开新标签页" onPress={app.openWorkspaceBrowser}><R.Icons.Add /></R.ActionButton>
      {hoverTab && !preview && window.WorkspaceTabPreview ? <window.WorkspaceTabPreview item={hoverTab.item} rect={hoverTab.rect} title={hoverTab.title} /> : null}
      <span className="home-tabs__announcement" role="status">{announcement}</span>
      {preview && ReactDOM.createPortal(<div className="home-tabs__drag-shield" aria-hidden="true">
        <div className={cx('home-tabs__ghost', !preview.valid && 'is-outside')} style={{left: preview.x, top: preview.y, width: preview.width}}>
          {icon(preview.item)}<span>{name(preview.item)}</span><R.Icons.Close />
        </div>
      </div>, document.body)}
    </div>;
  }

  // Title bar view controls live in home-shell-chrome.jsx (tabs, full view, summary).
  function WorkspaceViewControls() { return window.ShellViewControls ? <window.ShellViewControls /> : null; }

  function WorkspaceMovieFrame({editor, children}) {
    return <><window.Moviebar editor={editor} />{children}</>;
  }

  // Activity keeps edit history, selection and drafts while suspending effects and
  // global shortcuts in inactive editors. Freeze the context of inactive panes so
  // another movie's route cannot overwrite their tool selection.
  function WorkspaceMovie({item, active}) {
    const app = useApp();
    const urls = useRef(new Set());
    useEffect(() => () => { urls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
    const view = useRef(null);
    if (active) {
      const project = app.projById(item.id);
      if (project) window.BC_DATA.activateProject(item.id, project);
      const context = {...app, route: W.route(app.workspaceKey, item),
        closeMovie: () => app.closeWorkspaceTab(item.key)};
      view.current = <window.AppCtx.Provider value={context}>
        {project ? <window.EditorPage projectId={item.id} startT={item.t} embedded retainedUrls={urls.current} />
          : <Empty icon="film" title="视频已移走或删除" />}
      </window.AppCtx.Provider>;
    }
    return <React.Activity mode={active ? 'visible' : 'hidden'}>{view.current}</React.Activity>;
  }

  function WorkspaceFiles({item, active}) {
    const app = useApp();
    const [source, setSource] = useState(false);
    const [selectedImage, setSelectedImage] = useState(item.id);
    const [search, setSearch] = useState('');
    const session = app.sessionById(app.workspaceSessionId);
    const dirId = session ? app.dirOfSession(session) : app.route.dir || null;
    const dir = app.dirById(dirId);
    const original = app.spaceItems.find(it => it.id === item.id) || app.workspaceAttachments?.[item.id];
    const images = original?.attachment && original.contentKind === 'image' ? [original] : window.BC_MEDIA_PREVIEW.gallery(original, app.spaceItems);
    const file = images.find(it => it.id === selectedImage) || original;
    const selectImage = image => { setSelectedImage(image.id); app.setWorkspaceFileTitle(item.id, image.name); };
    const open = it => it.kind === 'movie' ? app.openMovie(it.id, {sid: app.workspaceSessionId, via: 'home'}) : app.openWorkspaceFile(it.id);
    if (item.id === '__browse__') {
      const items = app.spaceItems.filter(it => !it.trashed && (!dirId || it.dir === dirId) && it.name.toLowerCase().includes(search.toLowerCase()));
      return <div className="home-files">
        <header className="home-resource__bar"><Ic n="folder" /><strong>{dir?.name || '所有项目文件'}</strong></header>
        <div className="home-files__search"><R.SearchField aria-label="查找项目文件" placeholder="查找文件或视频" value={search} onChange={setSearch} /></div>
        <div className="home-files__list bc-scroll">
          {items.map(it => <BCAction key={it.id} className="home-files__row" onClick={() => open(it)}>
            <Ic n={it.kind === 'movie' ? 'film' : 'transcript'} /><span><strong>{it.name}</strong><small>{window.BC_SPACE.KINDS[it.kind]?.label} · {it.file || it.name}</small></span><NavChevron />
          </BCAction>)}
          {!items.length && <Empty icon="search" title="没有匹配的文件" />}
        </div>
      </div>;
    }
    if (!file) return <Empty icon="file" title="文件已移走或删除" />;
    const format = window.BC_FILE_PREVIEW.kind(file.file || file.name, file.contentKind);
    const viewName = {markdown: '阅读', html: '预览', table: '表格', json: '格式化'}[format];
    return <div className="home-files">
      <header className="home-resource__bar"><R.Icons.FileText /><div className="grow"><strong>{file.name}</strong><div className="home-resource__meta">{file.attachment ? ({image: '图片', audio: '音频', video: '视频', pdf: 'PDF', text: '文档'}[file.contentKind] || '文件') : file.contentKind === 'binary' || file.contentKind === 'archive' ? '文件' : window.BC_SPACE.KINDS[file.kind]?.label}{file.bytes != null ? ` · ${window.BC_SPACE.formatBytes(file.bytes)}` : ''}{file.ver ? ` · v${file.ver}` : ''}</div></div>
        {file.kind === 'doc' && viewName && <R.SegmentedControl aria-label="文档视图" selectedKey={source ? 'source' : 'read'} onSelectionChange={k => setSource(k === 'source')}>
          <R.SegmentedControlItem id="read">{viewName}</R.SegmentedControlItem><R.SegmentedControlItem id="source">源码</R.SegmentedControlItem>
        </R.SegmentedControl>}
        {file.externalOpen !== 'folder' && <R.ActionButton isQuiet onPress={() => app.toast(`原型演示：用系统默认应用打开 ${file.file || file.name}`)}>用默认应用打开</R.ActionButton>}
        {file.externalOpen === 'folder' && <R.ActionButton isQuiet onPress={() => app.toast(`原型演示：在文件夹中显示 ${file.file || file.name}`)}>在文件夹中显示</R.ActionButton>}
        {file.attachment ? <R.ActionButton isQuiet isDisabled={!file.previewSrc} onPress={() => window.savePreviewMedia(file)}>下载副本</R.ActionButton>
          : <R.ActionButton isQuiet onPress={() => app.go({r: 'projects', id: file.dir})}>在 Space 中显示</R.ActionButton>}
      </header>
      <div className="home-files__content bc-scroll">
        {file.status === 'missing' || (file.attachment && !file.previewSrc) ? <Empty icon="alert" title="找不到这个文件" />
          : file.previewSrc && (file.contentKind === 'image' || window.BC_MEDIA_PREVIEW.kind(file.file) === 'image') ? <window.MediaImagePreview file={file} files={images} onSelect={selectImage} active={active} />
          : file.previewSrc && (file.contentKind === 'audio' || window.BC_MEDIA_PREVIEW.kind(file.file) === 'audio') ? <window.MediaAudioPreview file={file} active={active} />
          : file.previewSrc && (file.contentKind === 'video' || window.BC_MEDIA_PREVIEW.kind(file.file) === 'video') ? <window.MediaVideoPreview file={file} active={active} />
          : file.kind === 'doc' && (file.text != null || format === 'pdf' || file.contentKind != null) ? <window.FileTabPreview key={file.id} file={file} source={source} />
          : file.text ? <pre className="spv__text">{file.text}</pre>
          : <window.SpaceItemPreview it={file} big />}
      </div>
      <footer className="home-resource__path">{/^[/~]/.test(file.file || '') ? '' : app.dirById(file.dir)?.path}{file.file || file.name}</footer>
    </div>;
  }

  // Keep this handle mounted for the entire gesture, including while the pane is
  // hidden, so reversing the same drag can reopen it. Pointer capture crosses iframes.
  function WorkspaceSeam() {
    const app = useApp();
    const start = useRef(null);
    const [dragging, setDragging] = useState(false);
    const enabled = app.workspaceVisible && !app.workspaceSingle;
    const resize = x => {
      const from = start.current;
      if (from) app.resizeWorkspace(from.width + x - from.x, from.available);
    };
    const finish = e => {
      if (!start.current || start.current.id !== e.pointerId) return;
      start.current = null;
      setDragging(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    };
    if (!enabled && !dragging) return null;
    return <div className={cx('seam seam--v seam--dock home-workspace__seam', dragging && 'is-drag')}
      role="separator" aria-label="调整会话与功能区宽度" aria-orientation="vertical" tabIndex={0}
      aria-valuemin={320} aria-valuemax={Math.max(320, app.workspaceWidth - W.PANE_MIN_WIDTH)}
      aria-valuenow={W.resizeSplit(app.workspaceDockW, app.workspaceWidth).width}
      onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault();
        const container = e.currentTarget.closest('.home-workspace');
        start.current = {id: e.pointerId, x: e.clientX,
          width: container.querySelector('.home-workspace__conversation').getBoundingClientRect().width,
          available: container.getBoundingClientRect().width};
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={e => { if (start.current?.id === e.pointerId) resize(e.clientX); }}
      onPointerUp={e => { if (start.current?.id === e.pointerId) resize(e.clientX); finish(e); }}
      onPointerCancel={finish} onLostPointerCapture={finish}
      onKeyDown={e => {
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        e.preventDefault();
        const container = e.currentTarget.closest('.home-workspace');
        const width = container.querySelector('.home-workspace__conversation').getBoundingClientRect().width;
        app.resizeWorkspace(width + (e.key === 'ArrowRight' ? 10 : -10), container.getBoundingClientRect().width);
      }}><div className="seam__bar" /></div>;
  }

  function HomeWorkspace() {
    const app = useApp();
    const {tabs, active} = app.workspace;
    const visible = app.workspaceVisible;
    const narrow = app.workspaceSingle;
    const sid = app.workspaceSessionId;
    // Narrow and full view: one column; the hidden side stays mounted (CSS for the
    // conversation, Activity for editors) so drafts and selections survive (product-design §3.3).
    // Home without a session or project is the start page; it keeps its own layout.
    return <div ref={app.workspaceRef} className={cx('home-workspace', visible && 'has-pane', app.workspaceFull && 'is-full',
      app.workspaceNarrow && 'is-narrow', narrow && 'is-single', app.workspaceConversation && 'is-conversation')}>
      <div className="home-workspace__conversation" style={visible && !narrow ? {width: app.workspaceDockW} : undefined}
        {...(narrow ? {id: panelId(CONVERSATION), role: 'tabpanel', 'aria-labelledby': tabId(CONVERSATION)} : {})}>
        {narrow ? <window.HomeSessionHead sess={app.sessionById(sid)} dir={app.route.dir} /> : null}
        {!sid && !app.route.dir ? <window.HomePage /> : <window.AgentPage id={sid} dir={app.route.dir} />}
      </div>
      <WorkspaceSeam />
      <div className="home-workspace__panes" hidden={!visible}>
        {tabs.map(item => <div key={item.key} id={panelId(item.key)} role="tabpanel" aria-labelledby={tabId(item.key)}
          className="home-workspace__pane movie-workspace__editor" hidden={active !== item.key} tabIndex={0}>
          {item.kind === 'movie' ? <WorkspaceMovie item={item} active={visible && active === item.key} />
            : item.kind === 'web' ? <window.WorkspaceBrowser item={item} active={visible && active === item.key} /> : <WorkspaceFiles item={item} active={visible && active === item.key} />}
        </div>)}
      </div>
    </div>;
  }
  Object.assign(window, {HomeWorkspace, WorkspaceTabs, WorkspaceMovieFrame, WorkspaceViewControls, workspaceTabName, workspaceTabIcon});
})();
