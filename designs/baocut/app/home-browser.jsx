/* Browser chrome, product-design §3.3. Reference: open-codex browser toolbar.
   Keep the sandboxed iframe: native webview-only features need the desktop host. */
(function () {
  const {useState, useRef, useEffect} = React;
  const R = window.RSP, B = window.BC_HOME_BROWSER, W = window.BC_HOME_WORKSPACE;
  function WorkspaceBrowser({item, active}) {
    const app = useApp();
    const root = useRef(null), field = useRef(null);
    const [address, setAddress] = useState(item.url || '');
    const [editing, setEditing] = useState(false);
    const [invalid, setInvalid] = useState(false);
    const [history, setHistory] = useState(() => B.history(item.url));
    const [reload, setReload] = useState(0);
    const [status, setStatus] = useState(item.url ? 'loading' : 'idle');
    const [zoom, setZoom] = useState(100);
    const [findOpen, setFindOpen] = useState(false), [query, setQuery] = useState(''), [match, setMatch] = useState(0);
    const [device, setDevice] = useState(null);
    const [notice, setNotice] = useState('');
    const demo = B.demoPage(item.url);
    const found = B.matches(demo?.body || '', query);
    const findStep = delta => setMatch(n => B.nextMatch(n, delta, found.length));
    useEffect(() => {
      setAddress(item.url || ''); setInvalid(false); setEditing(false);
      setHistory(h => B.visit(h, item.url || ''));
      setStatus(B.demoPage(item.url) ? 'ready' : item.url ? 'loading' : 'idle');
      setMatch(0); setNotice('');
    }, [item.url, reload]);
    useEffect(() => {
      if (status !== 'loading') return;
      const timer = setTimeout(() => setStatus('slow'), 15000);
      return () => clearTimeout(timer);
    }, [status]);
    const navigate = raw => {
      const url = B.resolveAddress(raw);
      if (!url) { setInvalid(true); return; }
      setInvalid(false); setEditing(false);
      if (url === item.url) setReload(n => n + 1);
      else app.replace(W.route(app.workspaceKey, {...item, url}));
      field.current?.getInputElement()?.blur();
    };
    const step = delta => {
      const next = B.step(history, delta);
      if (next === history) return;
      setHistory(next);
      app.replace(W.route(app.workspaceKey, {...item, url: next.urls[next.pos]}));
    };
    const focusAddress = () => { setEditing(true); setAddress(item.url || ''); requestAnimationFrame(() => { field.current?.getInputElement()?.focus(); field.current?.getInputElement()?.select(); }); };
    const loading = status === 'loading' || status === 'slow';
    useEffect(() => {
      if (!active) return;
      const keys = e => {
        if (!(e.metaKey || e.ctrlKey)) return;
        if (e.key.toLowerCase() === 'l') { e.preventDefault(); e.stopPropagation(); focusAddress(); }
        else if (root.current?.contains(e.target) && e.key.toLowerCase() === 'f') { e.preventDefault(); setFindOpen(true); }
        else if (root.current?.contains(e.target) && e.key.toLowerCase() === 'r') { e.preventDefault(); if (item.url) setReload(n => n + 1); }
      };
      document.addEventListener('keydown', keys, true);
      return () => document.removeEventListener('keydown', keys, true);
    }, [active, item.url]);
    return <div className="home-browser" ref={root}>
      <form className="home-resource__bar home-browser__toolbar" onSubmit={e => { e.preventDefault(); navigate(address); }}>
        <IconBtn icon="back" tip="后退" disabled={history.pos <= 0} onClick={() => step(-1)} />
        <IconBtn icon="fwd" tip="前进" disabled={history.pos >= history.urls.length - 1} onClick={() => step(1)} />
        <R.ActionButton isQuiet aria-label={loading ? '停止加载' : '重新加载网页'} isDisabled={!item.url} onPress={() => loading ? setStatus('stopped') : setReload(n => n + 1)}>
          {loading ? <R.Icons.StopProcessing /> : <R.Icons.Refresh />}
        </R.ActionButton>
        <R.TextField ref={field} aria-label="网页地址" placeholder="搜索或输入网址" value={address} onChange={value => { setAddress(value); setInvalid(false); }}
          onFocus={e => { setEditing(true); e.target.select(); }}
          onBlur={() => setEditing(false)}
          onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setInvalid(false); setAddress(item.url || ''); e.target.blur(); } }}
          isInvalid={invalid} UNSAFE_className={cx('home-browser__address', !editing && 'is-resting')} />
        <R.ActionButton type="submit" isDisabled={!address.trim()}>前往</R.ActionButton>
        <R.ActionButton isQuiet aria-label="在网页中查找" isDisabled={!item.url} onPress={() => setFindOpen(v => !v)}><R.Icons.Search /></R.ActionButton>
        <R.ActionButton isQuiet aria-label="设备预览" onPress={() => setDevice(d => d ? null : B.devices.phone)}><R.Icons.DeviceMultiscreen /></R.ActionButton>
        <R.MenuTrigger><R.ActionButton isQuiet aria-label="网页选项"><R.Icons.More /></R.ActionButton>
          <R.Menu onAction={key => {
            if (key === 'copy') { copyToClipboard(item.url); app.toast('已复制网页地址'); }
            if (key === 'reload') setReload(n => n + 1);
            if (key === 'force-reload') { setReload(n => n + 1); setNotice('已请求重新加载并跳过缓存。'); }
            if (key === 'duplicate') app.go(W.route(app.workspaceKey, {kind: 'web', id: crypto.randomUUID(), url: item.url}));
            if (key === 'find') setFindOpen(true);
            if (key === 'zoom-in') setZoom(z => B.zoom(z, 1));
            if (key === 'zoom-out') setZoom(z => B.zoom(z, -1));
            if (key === 'zoom-reset') setZoom(100);
          }} disabledKeys={[...(!item.url ? ['copy','reload','external'] : []), ...(zoom === 200 ? ['zoom-in'] : []), ...(zoom === 50 ? ['zoom-out'] : [])]}>
            <R.MenuItem id="copy">复制网页地址</R.MenuItem>
            <R.MenuItem id="external" href={item.url || undefined} target="_blank" rel="noopener noreferrer">在外部浏览器打开</R.MenuItem>
            <R.MenuItem id="reload">重新加载网页</R.MenuItem>
            <R.MenuItem id="force-reload">忽略缓存重新加载</R.MenuItem>
            <R.MenuItem id="find">在网页中查找</R.MenuItem>
            <R.MenuItem id="duplicate">在新标签页打开</R.MenuItem>
            <R.MenuItem id="zoom-in">放大</R.MenuItem><R.MenuItem id="zoom-out">缩小</R.MenuItem><R.MenuItem id="zoom-reset">恢复 100% 缩放</R.MenuItem>
          </R.Menu>
        </R.MenuTrigger>
      </form>
      {device && <div className="home-browser__device">
        <R.Picker aria-label="设备尺寸" selectedKey={Object.keys(B.devices).find(k => B.devices[k].width === device.width && B.devices[k].height === device.height) || 'custom'} onSelectionChange={key => B.devices[key] && setDevice(B.devices[key])}>
          <R.PickerItem id="custom">自定义</R.PickerItem><R.PickerItem id="phone">手机</R.PickerItem><R.PickerItem id="tablet">平板</R.PickerItem><R.PickerItem id="laptop">笔记本</R.PickerItem>
        </R.Picker>
        <R.NumberField aria-label="视口宽度" value={device.width} minValue={240} maxValue={4096} onChange={width => setDevice(d => ({...d, width: B.clampSize(width)}))} />
        <span>×</span><R.NumberField aria-label="视口高度" value={device.height} minValue={240} maxValue={4096} onChange={height => setDevice(d => ({...d, height: B.clampSize(height)}))} />
        <R.ActionButton isQuiet aria-label="旋转设备" onPress={() => setDevice(B.rotate(device))}><R.Icons.Refresh /></R.ActionButton>
        <R.ActionButton isQuiet aria-label="关闭设备预览" onPress={() => setDevice(null)}><R.Icons.Close /></R.ActionButton>
      </div>}
      {findOpen && <div className="home-browser__find">
        <R.SearchField autoFocus aria-label="查找网页内容" placeholder="在网页中查找" value={query} onChange={q => { setQuery(q); setMatch(0); }} onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
          if (e.key === 'Escape') { e.preventDefault(); setFindOpen(false); }
        }} />
        <span aria-live="polite">{demo ? `${found.length ? match + 1 : 0} / ${found.length}` : '外部网页查找需桌面宿主'}</span>
        <R.ActionButton isQuiet aria-label="上一个匹配" isDisabled={!found.length} onPress={() => findStep(-1)}><R.Icons.ChevronLeft /></R.ActionButton>
        <R.ActionButton isQuiet aria-label="下一个匹配" isDisabled={!found.length} onPress={() => findStep(1)}><R.Icons.ChevronRight /></R.ActionButton>
        <R.ActionButton isQuiet aria-label="关闭网页查找" onPress={() => setFindOpen(false)}><R.Icons.Close /></R.ActionButton>
      </div>}
      {notice && <div className="home-browser__notice" role="status"><span className="grow">{notice}</span><R.ActionButton isQuiet aria-label="关闭提示" onPress={() => setNotice('')}><R.Icons.Close /></R.ActionButton></div>}
      {invalid && <p className="home-browser__error" role="alert">请输入 http / https 网址或搜索词；网址不能包含账号密码。</p>}
      {loading && <div className="home-browser__loading" role="status"><R.ProgressCircle aria-label="正在加载网页" isIndeterminate size="S" /><span>{status === 'slow' ? '网页加载较慢，可重试或在外部浏览器打开。' : '正在加载网页…'}</span></div>}
      <div className={cx('home-browser__viewport', device && 'home-browser__viewport--device')}>
        <div className="home-browser__surface" style={device ? {width: `${device.width}px`, height: `${device.height}px`} : undefined}>
        {demo && !['stopped', 'error'].includes(status) ? <div className="home-browser__demo bc-scroll" style={{zoom: zoom / 100}}>
          <p className="home-browser__demo-label">制作指南 · 浏览器交互演示</p><h1>{demo.title}</h1>
          <div className="home-browser__demo-text">{highlight(demo.body, findOpen ? query : '', match)}</div>
          <R.Link onPress={() => navigate('https://guide.example' + demo.next)}>{demo.nextLabel}</R.Link>
          <div className="home-browser__demo-actions">
            <R.ActionButton onPress={() => setNotice('下载由系统浏览器处理；演示不会保存文件。')}>下载制作清单</R.ActionButton>
            <R.ActionButton onPress={() => setNotice('已拦截网页弹窗。可复制地址或在外部浏览器打开。')}>查看弹窗处理</R.ActionButton>
            <R.ActionButton onPress={() => setStatus('error')}>查看加载失败</R.ActionButton>
          </div>
        </div> : item.url && !['stopped', 'error'].includes(status) ? <iframe key={item.url + ':' + reload} src={item.url} title={`网页：${item.url}`}
          style={{width: `${10000 / zoom}%`, height: `${10000 / zoom}%`, transform: `scale(${zoom / 100})`}}
          sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer" onLoad={() => setStatus('ready')} onError={() => setStatus('error')} />
          : !item.url && status === 'idle' ? <NewTabStart onAddress={focusAddress} onCreatePage={() => app.createWorkspacePage(item.key)} onBrowseFiles={() => app.browseWorkspaceFiles(item.key)} />
          : <div className="home-browser__start"><R.Icons.GlobeGrid /><h2>{status === 'stopped' ? '已停止加载' : status === 'error' ? '网页未能加载' : '搜索或打开网页'}</h2>
            <p>{item.url ? B.displayUrl(item.url) : '输入网址或搜索词，在这里查看资料并继续对话。'}</p>
            {item.url ? <><R.ActionButton onPress={() => setReload(n => n + 1)}>重新加载</R.ActionButton><R.LinkButton href={item.url} target="_blank" rel="noopener noreferrer">在外部浏览器打开</R.LinkButton></> : <R.ActionButton onPress={focusAddress}>输入网址</R.ActionButton>}
          </div>}
        </div>
      </div>
      {item.url && <footer className="home-resource__path home-browser__footer"><span className="grow">部分网站限制内嵌浏览；前进和后退记录从地址栏打开的页面。</span>
        {zoom !== 100 && <R.ActionButton size="XS" isQuiet aria-label="恢复 100% 缩放" onPress={() => setZoom(100)}>{zoom}%</R.ActionButton>}
        <R.LinkButton variant="secondary" size="S" href={item.url} target="_blank" rel="noopener noreferrer">外部打开</R.LinkButton></footer>}
    </div>;
  }
  /* New tab start page (product-design §3.3 user revision).
     The address bar above stays; the demo pages remain reachable from it (guide.example). */
  function NewTabStart({onAddress, onCreatePage, onBrowseFiles}) {
    return <div className="home-browser__newtab">
      <div className="home-browser__newtab-hint"><R.Icons.GlobeGrid /><h2>搜索或打开网页</h2>
        <p>在上方地址栏输入网址或搜索词，在这里查看资料并继续对话。</p>
        <R.ActionButton onPress={onAddress}>输入网址</R.ActionButton>
      </div>
      <section className="home-browser__tools" aria-labelledby="home-browser-tools">
        <h3 id="home-browser-tools">工具</h3>
        <div className="home-browser__tool-grid">
          <BCAction className="home-browser__tool" onClick={onCreatePage}>
            <span className="home-browser__tool-icon"><R.Icons.Code /></span>
            <span className="home-browser__tool-text"><strong>新建网页</strong><small>在项目里新建一个 HTML 文件并预览</small></span>
          </BCAction>
          <BCAction className="home-browser__tool" onClick={onBrowseFiles}>
            <span className="home-browser__tool-icon"><R.Icons.Folder /></span>
            <span className="home-browser__tool-text"><strong>浏览项目文件</strong><small>在这个标签页里查看项目目录</small></span>
          </BCAction>
        </div>
      </section>
    </div>;
  }
  function highlight(text, query, active) {
    if (!query) return text;
    const positions = B.matches(text, query), nodes = []; let from = 0;
    positions.forEach((at, i) => { nodes.push(text.slice(from, at), <mark key={at} className={i === active ? 'is-active' : undefined}>{text.slice(at, at + query.length)}</mark>); from = at + query.length; });
    nodes.push(text.slice(from)); return nodes;
  }
  Object.assign(window, {WorkspaceBrowser});
})();
