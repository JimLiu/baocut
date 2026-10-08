/* 第 134 轮：按用户目标组织的帮助中心。S2 CustomDialog 保留编辑器，提供焦点圈定与归还。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const H = window.BC_HELP;
  const sections = [
    {id: 'start', label: '快速上手', icon: 'play'},
    {id: 'guide', label: '操作指南', icon: 'transcript'},
    {id: 'keys', label: '快捷键', icon: 'list'},
    {id: 'faq', label: '常见问题', icon: 'help'},
  ];
  function HelpCenter({onClose, editor, returnFocus}) {
    const app = useApp();
    const dialog = useRef(null);
    const content = useRef(null);
    const [section, setSection] = useState('start');
    const [query, setQuery] = useState('');
    const [article, setArticle] = useState(null);
    const [platform, setPlatform] = useState(/Mac|iPhone|iPad/.test(navigator.platform) ? 'mac' : 'win');
    useEffect(() => { if (content.current) content.current.scrollTop = 0; }, [article, section, query]);
    const choose = (id) => { setSection(id); setQuery(''); setArticle(null); };
    const read = (g) => setArticle(g);
    const navigate = (g) => {
      const a = g.action;
      onClose();
      if (a === 'new') app.newProject({entry: 'media'});
      else if (a === 'agent') app.go({r: 'settings', sec: 'agent'});
      else if (a === 'models') app.go({r: 'settings', sec: 'local'});
      else if (!editor) app.go({r: 'projects'});
      else if (a === 'export') editor.onExport();
      else if (a !== 'return') {
        // 第 152 轮起翻译并入字幕 Tab：'translate' 落到字幕 Tab 并选中译文轨
        editor.ctx.setTab(a === 'style' || a === 'translate' ? 'subtitle' : a);
        if (a === 'translate') editor.ctx.pickSub(D.dstLang.code);
        editor.ctx.setPaneHidden(false);
        editor.ctx.setPaneView(a === 'style' ? 'subgallery' : a === 'subtitle' || a === 'translate' ? 'subedit' : null);
      }
    };
    const cta = g => !editor && ['subtitle', 'translate', 'style', 'export', 'return'].includes(g.action) ? '选择一部视频' : g.cta;
    const listing = query.trim() ? H.search(query) : H.guides.filter(g => g.group === section);
    const quick = H.guides.filter(g => g.group === 'start');
    const keyLabel = keys => platform === 'mac' ? keys : keys.replaceAll('⌘', 'Ctrl+').replaceAll('⇧ 走', 'Shift 走').replaceAll('⇧', 'Shift+').replaceAll('⌥', 'Alt+');
    const rows = items => <div className="help-list">{items.map(g => <BCAction key={g.id} className="help-row" onClick={() => read(g)}>
      <span className="help-icon"><Ic n={g.icon} /></span><span className="grow"><strong>{g.title}</strong><small>{g.summary}</small></span>
      <span className="help-readtime">{g.minutes} 分钟</span><NavChevron />
    </BCAction>)}</div>;
    return <BCModal onClose={onClose} labelledBy="help-title" size="L" className="bc-help-dialog"><div className="help-center">
      <header className="help-header">
        <div className="row"><Ic n="help" /><h1 id="help-title">帮助中心</h1></div>
        <span className="grow" />
        <span className="t-detail">随时查阅，轻松上手</span>
        <IconBtn icon="close" tip="关闭帮助" onClick={onClose} />
      </header>
      <div className="help-layout">
        <nav className="help-nav" aria-label="帮助分类">
          <div className="t-section">使用 BaoCut</div>
          {sections.map(s => <BCAction key={s.id} className={cx('siderow', !query.trim() && section === s.id && 'is-on')}
            aria-current={!query.trim() && section === s.id ? 'page' : undefined} onClick={() => choose(s.id)}><Ic n={s.icon} className="ic--16" />{s.label}</BCAction>)}
          <div className="spacer" />
          <div className="help-nav-note"><Ic n="info" className="ic--16" /><span>按需阅读就好。<br />关闭后回到原来的工作。</span></div>
        </nav>
        <div className="help-main">
          <div className="help-search">
            <Ic n="search" className="ic--16" />
            <Field size="l" aria-label="搜索帮助" placeholder="搜索你想做的事，例如：双语字幕" value={query}
              onChange={e => {setQuery(e.target.value); setArticle(null);}} />
            {query ? <IconBtn icon="close" size="s" tip="清空搜索" onClick={() => {setQuery(''); setArticle(null);}} /> : null}
          </div>
          <main className="help-content bc-scroll" ref={content}>
            {article ? <article>
              <Btn variant="quiet" size="s" icon="chevleft" onClick={() => setArticle(null)}>{query.trim() ? '返回搜索结果' : '返回' + sections.find(s => s.id === section).label}</Btn>
              <div className="help-article-heading"><span className="help-eyebrow"><Ic n={article.icon} className="ic--16" />约 {article.minutes} 分钟阅读</span><h2>{article.title}</h2><p>{article.summary}</p></div>
              <ol className="help-instructions">{article.steps.map(([title, body], i) => <li key={title}><span className="help-number">{i + 1}</span><div><h3>{title}</h3><p>{body}</p></div></li>)}</ol>
              <div className="help-note"><Ic n="info" className="ic--16" /><p>{article.tip}</p></div>
              <div className="help-article-action"><Btn variant="accent" iconRight="chevright" onClick={() => navigate(article)}>{cta(article)}</Btn>
                <span className="t-detail">{!editor && cta(article) === '选择一部视频' ? '先打开视频，再按指南操作。' : '打开对应功能，由你开始操作。'}</span></div>
              {quick.includes(article) && quick.indexOf(article) < quick.length - 1 ? <BCAction className="help-next" onClick={() => read(quick[quick.indexOf(article) + 1])}>继续阅读：{quick[quick.indexOf(article) + 1].title}<NavChevron /></BCAction> : null}
            </article> : query.trim() ? <>
              <div className="help-section-heading"><h2>搜索结果</h2><span role="status" className="t-detail">找到 {listing.length} 篇指南</span></div>
              {listing.length ? rows(listing) : <div className="help-empty"><Ic n="search" className="ic--26" /><h3>没有找到相关指南</h3><p>试试「字幕」「配音」「导出」或「模型」，也可以从快速上手开始。</p><Btn onClick={() => choose('start')}>查看快速上手</Btn></div>}
            </> : section === 'start' ? <>
              <div className="help-welcome"><span className="help-eyebrow">第一次使用？从这里开始</span><h2>做出你的第一条字幕视频</h2><p>从一段素材到带字幕的成片，跟着这四步走。</p>
                <Btn variant="accent" iconRight="chevright" onClick={() => read(quick[0])}>开始入门指南</Btn><span className="help-duration">4 步 · 约 7 分钟阅读</span>
              </div>
              <div className="help-path" aria-label="入门四步">{quick.map((g, i) => <BCAction key={g.id} onClick={() => read(g)}><div className="row"><Ic n={g.icon} /><span className="spacer" /><span className="t-detail">0{i + 1}</span></div><strong>{g.short}</strong><span className="t-detail">{g.minutes} 分钟阅读 <span aria-hidden="true">→</span></span></BCAction>)}</div>
              <div className="help-section-heading"><h3>你可能还想了解</h3><BCAction className="help-link" onClick={() => choose('guide')}>全部指南 <NavChevron /></BCAction></div>
              {rows(H.guides.filter(g => ['workspace', 'agent'].includes(g.id)))}
              <div className="help-bottom-tip"><span>找不到某个操作？</span><BCAction className="help-link" onClick={() => choose('keys')}>查看快捷键</BCAction><span className="kbd">?</span><span className="t-detail">在编辑器中打开清单</span></div>
            </> : section === 'keys' ? <>
              <div className="help-section-heading"><h2>少点几次，更快一点</h2><Segmented items={[{k: 'mac', label: 'macOS'}, {k: 'win', label: 'Windows / Linux'}]} value={platform} onChange={setPlatform} size="s" /></div>
              <p className="help-intro">以下快捷键在编辑器中使用。正在输入文字时，按键优先用于文本编辑。</p>
              <div className="help-keys">{(window.BC_EDITOR_SHORTCUTS || []).map(([label, keys]) => <div key={label}><span>{label}</span><kbd className="kbd">{keyLabel(keys)}</kbd></div>)}</div>
            </> : <><div className="help-section-heading"><h2>{section === 'guide' ? '想做什么，就从这里找' : '遇到问题，先看看这里'}</h2></div><p className="help-intro">{section === 'guide' ? '每篇只讲一件事，读完就能回到视频里试一试。' : '从最常见的原因开始，一步步检查。'}</p>{rows(listing)}</>}
          </main>
          <footer className="help-footer"><span className="t-detail">内置指南 · 可离线阅读</span><span className="spacer" /><span className="kbd">Esc</span><span className="t-detail">关闭帮助</span></footer>
        </div>
      </div>
    </div></BCModal>;
  }
  window.HelpCenter = HelpCenter;
})();
