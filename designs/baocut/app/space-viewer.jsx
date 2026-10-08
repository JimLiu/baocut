/* Space 的查看框与导入框（2026-10-01，product-design §4.5–§4.8）—— 只在 App 入口加载，控件用 react-spectrum S2。

   查看框是轻量的：预览、事实（类型 / 来源 / 位置 / 文件 / 时长 / 规格 / 状态 / 最近活动 / 来源会话）、版本，
   动作是 在会话中继续 · 用工具处理… · 查看来源会话或任务（工具的结果可以再做一次）· 在文件夹中显示 · 二次编辑 · 收藏（§4.5）。
   去工具页、任务页与会话的入口按 BC_SURFACE.pages / .agent 收（这个文件只在 App 入口加载，收法照共享组件的规矩写）。
   二次编辑**不覆盖原条目**（§4.6）：字幕与文档就地改字、另存为新版本；图片 / 音频 / 模板另存一份新版本；
   成片回到来源视频（或以它为素材新建视频）；视频就是打开编辑器。 */
(function () {
  const {useState, useEffect} = React;
  const SP = window.BC_SPACE;
  const AP = window.BC_AGENT_PROJECTS;
  const SURF = window.BC_SURFACE;
  const ST = () => window.BC_SPACE_TOOLS;

  function Fact({k, children}) {
    return <><dt className="spv__k">{k}</dt><dd className="spv__v">{children}</dd></>;
  }

  function DocumentReading({text}) {
    return <article className="spv__reading" aria-label="文档正文">{SP.documentBlocks(text).map((b, i) => {
      if (b.type === 'heading') { const Tag = `h${b.level}`; return <Tag key={i}>{b.text}</Tag>; }
      if (b.type === 'list') { const Tag = b.ordered ? 'ol' : 'ul'; return <Tag key={i} start={b.ordered ? b.start : undefined}>{b.items.map((t, j) => <li key={j}>{t}</li>)}</Tag>; }
      if (b.type === 'code') return <pre key={i}><code>{b.text}</code></pre>;
      return <p key={i}>{b.text}</p>;
    })}</article>;
  }

  /* S2 的 Dialog 会把 children 在标题区、正文区、底栏各渲染一遍（每处只露自己那个 slot），
     所以这里不能有自己的 state——编辑态放在外面的 SpaceViewer 里，三处共用。 */
  function ViewerBody({it, movies, dirs, close, onSwitch, editing, setEditing, text, setText, source, setSource}) {
    const app = useApp();
    const R = window.RSP;
    const d = it.dir ? dirs[it.dir] : null;
    const mv = it.kind === 'movie' ? movies[it.id] : it.movie ? movies[it.movie] : null;
    const sess = it.session ? app.sessionById(it.session) : null;
    const route = SP.editRoute(it);
    const document = it.kind === 'doc' && /\.md$/i.test(it.file || it.name) && !!it.text;
    const versions = it.kind === 'movie' ? [] : SP.versionsOf(it, app.spaceItems);
    // 产物的文件路径相对它的项目目录；已经是绝对路径（外接盘、未归类）的照写
    const abs = /^[/~]/.test(it.file || '');
    const path = it.kind === 'movie' ? (d ? AP.moviePath(d, mv) : '')
      : abs ? it.file : `${d ? d.path : '~/BaoCut/未归类/'}${it.file || it.name}`;

    const save = () => {
      const rec = app.saveVersion(it, route === 'text' ? {text, lines: text.split('\n').filter(Boolean).length} : null);
      if (!rec) return;
      app.toast(`已另存为新版本 · ${rec.name}（原条目没动）`, 'positive');
      onSwitch(rec.id);
    };
    const edit = () => {
      if (route === 'editor') { close(); app.openMovie(it.id, {via: 'space'}); }
      else if (route === 'source') { close(); app.openMovie(it.movie, {via: 'space'}); }
      else if (route === 'new-movie') { close(); app.newProject({entry: 'media', file: it.name, dir: it.dir || undefined}); }
      else if (route === 'text') setEditing(true);
      else save();
    };
    const editLabel = {editor: '打开视频', source: '回到来源视频编辑', 'new-movie': '以它为素材新建视频', text: '编辑文字', version: '另存一份再改'}[route];
    /* 在会话中继续（§4.7）：条目作为引用标签带进输入框，预填一句可改写的草稿，不自动发送；落到哪条会话由 handoverToAgent 决定 */
    const cont = () => {
      close();
      if (it.kind === 'movie') { app.openMovie(it.id, {via: 'space'}); return; }
      app.handoverToAgent(it);
    };
    /* 用工具处理…（§4.5、§2.7「页面」第 1 条）：进工具页时输入已经选好 */
    const tools = SURF.pages ? ST().toolsFor(it) : [];
    const pickTool = (id) => { close(); app.openToolWith(id, {entry: it}); };
    /* 工具生成的条目：来源处给出工具与任务，「再做一次」回到参数已填好的工具页 */
    const org = ST().origin(it, app.tasks);
    const orgTask = org && org.taskId ? app.tasks.find((t) => t.id === org.taskId) : null;
    const loc = ST().location(it, app.prefs);

    return (
      <>
        <R.Heading slot="title">{it.name}</R.Heading>
        <R.Header>
          <span className="spv__hd">
            <R.Badge variant="neutral" size="S">{SP.KINDS[it.kind].label}{it.ver ? ` · v${it.ver}` : ''}</R.Badge>
            <window.SpaceItemStatus it={it} />
          </span>
        </R.Header>
        <R.Content>
          <div className={`spv${document && !editing ? ' spv--document' : ''}`}>
            {editing ? (
              <R.TextArea label={`编辑 ${it.name}（保存为新版本，原条目不动）`} value={text} onChange={setText}
                UNSAFE_className="spv__edit" />
            ) : (
              <div className="spv__media">
                {document ? <>
                  <div className="spv__toolbar">
                    <span className="spv__path" title={path}>{it.file || it.name}</span>
                    <R.SegmentedControl aria-label="文档视图" selectedKey={source ? 'source' : 'read'} onSelectionChange={(k) => setSource(k === 'source')}>
                      <R.SegmentedControlItem id="read">阅读</R.SegmentedControlItem>
                      <R.SegmentedControlItem id="source">源码</R.SegmentedControlItem>
                    </R.SegmentedControl>
                  </div>
                  {source ? <pre className="spv__text" aria-label="文档源码">{it.text}</pre> : <DocumentReading text={it.text} />}
                </> : it.kind === 'audio' && it.sourceUrl ? <audio controls src={it.sourceUrl} aria-label={it.name} /> : it.text ? <pre className="spv__text">{it.text}</pre>
                  : <window.SpaceItemPreview it={it} movie={mv && it.kind === 'movie' ? mv : null} big />}
              </div>
            )}
            <dl className="spv__facts">
              <Fact k="来源">
                <span className="spv__src">
                  <span>{SP.sourceText(it, dirs, movies)}{orgTask ? ` · ${orgTask.title || '任务'}` : ''}</span>
                  {org && SURF.pages && org.rerun ? (
                    <R.ActionButton size="S" isQuiet onPress={() => { close(); app.openToolWith(org.toolId, org.rerun); }}>
                      <R.Icons.Refresh /><R.Text>再做一次</R.Text>
                    </R.ActionButton>
                  ) : null}
                  {org && SURF.pages && orgTask ? (
                    <R.ActionButton size="S" isQuiet onPress={() => { close(); app.go({r: 'task', id: orgTask.id}); }}>查看任务</R.ActionButton>
                  ) : null}
                </span>
              </Fact>
              {loc && (org || loc.isSaveDir) ? <Fact k="位置">{loc.label}{loc.isSaveDir ? '（默认保存位置）' : ''}</Fact> : null}
              <Fact k="文件"><span className="spv__path">{path}</span></Fact>
              {SP.durationText(it) ? <Fact k="时长">{SP.durationText(it)}</Fact> : null}
              {SP.specText(it) ? <Fact k="规格">{SP.specText(it)}</Fact> : null}
              <Fact k="最近活动">{SP.agoText(it.mtime) || '—'}</Fact>
              {sess ? <Fact k="来源会话">{sess.title || '新会话'}</Fact> : null}
              {it.note ? <Fact k="说明">{it.note}</Fact> : null}
              {versions.length > 1 ? (
                <Fact k="版本">
                  <span className="spv__vers">
                    {versions.map((v) => (
                      <R.ActionButton key={v.id} size="S" isQuiet={v.id !== it.id} onPress={() => onSwitch(v.id)}>
                        {v.ver ? `v${v.ver}` : '原条目'}
                      </R.ActionButton>
                    ))}
                  </span>
                </Fact>
              ) : null}
            </dl>
            {it.status === 'missing' ? (
              <R.InlineAlert variant="negative">
                <R.Heading>找不到这个文件</R.Heading>
                <R.Content>{it.note || '文件被移走或删掉了。'}条目还在，接回文件后状态会自己恢复。</R.Content>
              </R.InlineAlert>
            ) : null}
          </div>
        </R.Content>
        {/* S2 的可关闭对话框（isDismissible）会藏掉 ButtonGroup，所以这里不用右上角的 ×：
            左边 Footer 放轻动作（收藏 / 文件夹 / 来源会话），右边 ButtonGroup 放 关闭 · 二次编辑 · 主动作 */}
        {editing ? null : (
          <R.Footer>
            <span className="spv__foot">
              <R.ActionButton isQuiet onPress={() => app.toggleFav(it)} aria-label={it.fav ? '取消收藏' : '收藏'}>
                {it.fav ? <R.Icons.StarFilled /> : <R.Icons.Star />}
              </R.ActionButton>
              <R.ActionButton isQuiet onPress={() => app.toast(`已在文件夹中显示 ${path}（演示）`)}>
                <R.Icons.Folder /><R.Text>在文件夹中显示</R.Text>
              </R.ActionButton>
              {sess && SURF.agent ? (
                <R.ActionButton isQuiet onPress={() => { close(); app.go({r: 'agent', id: sess.id}); }}>
                  <R.Icons.Comment /><R.Text>查看来源会话</R.Text>
                </R.ActionButton>
              ) : null}
              {SURF.pages && !it.trashed ? (
                <R.MenuTrigger>
                  <R.ActionButton isQuiet isDisabled={!tools.length}><R.Icons.Tools /><R.Text>用工具处理…</R.Text></R.ActionButton>
                  <R.Menu aria-label={`用工具处理「${it.name}」`} onAction={(k) => pickTool(String(k))}>
                    {tools.map((t) => <R.MenuItem key={t.id} id={t.id} textValue={t.name}><R.Text slot="label">{t.name}</R.Text></R.MenuItem>)}
                  </R.Menu>
                </R.MenuTrigger>
              ) : null}
            </span>
          </R.Footer>
        )}
        <R.ButtonGroup>
          {editing ? (
            <>
              <R.Button variant="secondary" onPress={() => { setEditing(false); setText(it.text || ''); }}>取消</R.Button>
              <R.Button variant="accent" onPress={save} isDisabled={text === (it.text || '')}>另存为新版本</R.Button>
            </>
          ) : (
            <>
              <R.Button variant="secondary" onPress={close}>关闭</R.Button>
              {!it.trashed && it.tool && window.BC_HOME_TOOLS.moviePatch(it) && <R.Button variant="secondary" onPress={() => { close(); app.createMovieFromOutput(it); }}>创建视频</R.Button>}
              {it.trashed ? null : <R.Button variant="secondary" onPress={edit} isDisabled={it.status === 'missing' || it.status === 'generating'}>{editLabel}</R.Button>}
              {it.kind === 'movie' || SURF.agent
                ? <R.Button variant="accent" onPress={cont} isDisabled={it.kind !== 'movie' && !!it.trashed}>{it.kind === 'movie' ? '打开视频' : '在会话中继续'}</R.Button>
                : null}
            </>
          )}
        </R.ButtonGroup>
      </>
    );
  }

  function SpaceViewer({id, onClose, onSwitch, movies, dirs}) {
    const app = useApp();
    const R = window.RSP;
    const it = id ? app.spaceItems.find((x) => x.id === id) : null;
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState('');
    const [source, setSource] = useState(false);
    useEffect(() => { setEditing(false); setSource(false); setText(it ? it.text || '' : ''); }, [id]);
    const ed = {editing, setEditing, text, setText, source, setSource};
    return (
      <R.DialogContainer onDismiss={onClose}>
        {it ? (
          <R.Dialog size={it.kind === 'doc' ? 'XL' : 'L'}>
            {({close}) => <ViewerBody it={it} movies={movies} dirs={dirs} close={close} onSwitch={onSwitch} {...ed} />}
          </R.Dialog>
        ) : null}
      </R.DialogContainer>
    );
  }

  /** 导入素材：选项目 → 选文件。视频不在这里收（走「从文件新建视频」）。 */
  function SpaceImport({open, dir, onClose}) {
    const app = useApp();
    const R = window.RSP;
    const [target, setTarget] = useState(dir || (app.dirs[0] && app.dirs[0].id));
    useEffect(() => { if (open) setTarget(dir || (app.dirs[0] && app.dirs[0].id)); }, [open]);
    const d = app.dirById(target);
    const take = (files, close) => {
      const recs = app.importAssets(files, target);
      const skipped = Array.from(files || []).length - recs.length;
      if (recs.length) app.toast(`已导入 ${recs.length} 个素材到「${d ? d.name : ''}」${skipped ? ` · ${skipped} 个类型不支持` : ''}`, 'positive');
      else app.toast('没有可导入的文件：视频请用「从文件新建视频」', 'negative');
      close();
    };
    return (
      <R.DialogContainer onDismiss={onClose}>
        {open ? (
          <R.Dialog size="S">
            {({close}) => (
              <>
                <R.Heading slot="title">导入素材</R.Heading>
                <R.Content>
                  <div className="spv">
                    <R.Picker label="导入到项目" selectedKey={target} onSelectionChange={(k) => setTarget(String(k))}>
                      {app.dirs.map((x) => <R.PickerItem key={x.id} id={x.id} textValue={x.name}>{x.name}</R.PickerItem>)}
                    </R.Picker>
                    <p className="spv__hint">文件会拷进 <span className="spv__path">{d ? d.path : ''}素材/</span>，原文件不动。图片、音频、字幕、文档都行；视频请用「从文件新建视频」。</p>
                  </div>
                </R.Content>
                <R.ButtonGroup>
                  <R.Button variant="secondary" onPress={close}>取消</R.Button>
                  <R.FileTrigger allowsMultiple acceptedFileTypes={SP.IMPORT_ACCEPT} onSelect={(files) => take(files, close)}>
                    <R.Button variant="accent"><R.Icons.Import /><R.Text>选择文件…</R.Text></R.Button>
                  </R.FileTrigger>
                </R.ButtonGroup>
              </>
            )}
          </R.Dialog>
        ) : null}
      </R.DialogContainer>
    );
  }

  Object.assign(window, {SpaceViewer, SpaceImport, DocumentReading});
})();
