/* Space 的查看框与导入框（2026-10-01，product-design §4.5–§4.8）—— 只在 App 入口加载，控件用 react-spectrum S2。

   查看框是轻量的：预览、事实（类型 / 来源 / 位置 / 文件 / 时长 / 规格 / 状态 / 最近活动 / 来源会话）、版本，
   动作是 在会话中继续 · 用工具处理… · 查看来源会话或任务（工具的结果可以再做一次）· 在文件夹中显示 · 二次编辑 · 收藏（§4.5）。
   去工具页、任务页与会话的入口按 BC_SURFACE.pages / .agent 收（这个文件只在 App 入口加载，收法照共享组件的规矩写）。
   二次编辑**不覆盖原条目**（§4.6）：字幕与文档就地改字、另存为新版本；图片 / 音频 / 模板另存一份新版本；
   成片回到来源视频（或以它为素材新建视频）；视频就是打开编辑器。
   一部视频在 Space 里只有一张卡：它导出、生成的文件列在这部视频的查看框里（BC_SPACE.filesOf），点一个换成那个文件；
   文件的查看框里「查看视频」换回来。源文件是视频的一条事实，不另成条目。
   切出的短视频各是一部视频（§4.3），父视频的查看框里在「文件」之前一起列（BC_SPACE.shortsOf），点一支换成它的查看框；
   短视频的查看框里「查看来源视频」换回父视频。 */
(function () {
  const {useState, useEffect} = React;
  const SP = window.BC_SPACE;
  const AP = window.BC_AGENT_PROJECTS;
  const SURF = window.BC_SURFACE;
  const ST = () => window.BC_SPACE_TOOLS;

  function Fact({k, children}) {
    return <><dt className="spv__k">{k}</dt><dd className="spv__v">{children}</dd></>;
  }

  function DocumentReading({text, onMoment}) {
    /* 存下来的回答与写作里「视频某一刻」的出处（`/videos/<id>?t=<秒>`）点了打开那部视频、跳到那一刻（同会话里的回答） */
    const inline = (s) => SP.documentMoments(s).map((x, k) => x.text != null ? x.text
      : <BCAction key={k} className="spv__moment" aria-label={`跳到 ${x.label}`} onClick={() => onMoment && onMoment(x.video, x.t)}>{x.label}</BCAction>);
    return <article className="spv__reading" aria-label="文档正文">{SP.documentBlocks(text).map((b, i) => {
      if (b.type === 'heading') { const Tag = `h${b.level}`; return <Tag key={i}>{inline(b.text)}</Tag>; }
      if (b.type === 'list') { const Tag = b.ordered ? 'ol' : 'ul'; return <Tag key={i} start={b.ordered ? b.start : undefined}>{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</Tag>; }
      if (b.type === 'code') return <pre key={i}><code>{b.text}</code></pre>;
      return <p key={i}>{inline(b.text)}</p>;
    })}</article>;
  }

  /** 视频名下的文件：一行一个，点开换成那个文件的查看框。 */
  function MovieFiles({files, onSwitch}) {
    const R = window.RSP;
    return (
      <section className="spv__files" aria-label="这部视频的文件">
        <h3 className="spv__files-h">文件<span className="spv__files-n">{files.length}</span></h3>
        <R.GridList aria-label="这部视频的文件" items={files} className="spv__files-list" onAction={(k) => onSwitch(String(k))}>
          {(f) => (
            <R.GridListItem id={f.id} textValue={f.name} className="spv__file">
              <window.SpaceItemPreview it={f} small />
              <span className="spv__file-body">
                <span className="spv__file-t">{f.name}</span>
                <span className="spv__file-d">{[SP.KINDS[f.kind].label, SP.durationText(f), SP.specText(f)].filter(Boolean).join(' · ')}</span>
              </span>
              <window.SpaceItemStatus it={f} />
            </R.GridListItem>
          )}
        </R.GridList>
      </section>
    );
  }

  /** 这部视频切出的短视频（product-design §4.5）：一行一支，写原片上的区间与时长，点开换成那一支的查看框。
      最多露出 6 支；「在列表中查看」把 Space 筛成这部视频切出的全部（§4.3）。 */
  const SHORTS_SHOWN = 6;
  function MovieShorts({shorts, movies, onSwitch, onList}) {
    const R = window.RSP;
    const shown = shorts.slice(0, SHORTS_SHOWN);
    return (
      <section className="spv__files" aria-label="切出的短视频">
        <div className="spv__files-bar">
          <h3 className="spv__files-h">切出的短视频<span className="spv__files-n">{shorts.length}</span></h3>
          <R.ActionButton size="S" isQuiet onPress={onList}>在列表中查看</R.ActionButton>
        </div>
        <R.GridList aria-label="切出的短视频" items={shown} className="spv__files-list" onAction={(k) => onSwitch(String(k))}>
          {(s) => (
            <R.GridListItem id={s.id} textValue={s.name} className="spv__file">
              <window.SpaceItemPreview it={s} movie={movies[s.id]} small />
              <span className="spv__file-body">
                <span className="spv__file-t">{s.name}</span>
                <span className="spv__file-d">{[SP.spanText(s), SP.durationText(s)].filter(Boolean).join(' · ')}</span>
              </span>
              <window.SpaceItemStatus it={s} />
            </R.GridListItem>
          )}
        </R.GridList>
        {shorts.length > shown.length ? <p className="spv__hint">还有 {shorts.length - shown.length} 支，在列表中查看全部</p> : null}
      </section>
    );
  }

  /* S2 的 Dialog 会把 children 在标题区、正文区、底栏各渲染一遍（每处只露自己那个 slot），
     所以这里不能有自己的 state——编辑态放在外面的 SpaceViewer 里，三处共用。 */
  /** 讲相近内容的视频（embedding-integration-design §2.4 P2）：打开查看框时才算，只列用户自己的视频；一行一部，
      下面一行灰字是那部视频里最接近的一句与时间（同搜索结果卡的写法）。不给分数。没装模型或这部视频还没建好索引时
      退回名字相近，顶上写明（§2.13）；点一行换成那部视频的查看框。纯逻辑在 model-space-search.js `related`。 */
  function MovieRelated({it, movies, onSwitch}) {
    const R = window.RSP;
    const Q = window.BC_SPACE_SEARCH;
    const D = window.BC_DATA;
    const app = useApp();
    const [, sem] = window.BC_SEMSTATE.useSemantic();
    const r = Q.related(it.id, {items: app.spaceItems, corpus: D.semantic.corpus, concepts: D.semantic.concepts, status: sem});
    const note = Q.relatedNote(r);
    const mmss = (t) => window.BC_WRCITES.mmss(t);
    const line = (x) => (x.why ? `${mmss(x.why.t)} · ${x.why.text}` : `名字里都有「${x.shared}」`);
    return (
      <section className="spv__files" aria-label="讲相近内容的视频">
        <h3 className="spv__files-h">讲相近内容的视频{r.rows.length ? <span className="spv__files-n">{r.rows.length + r.more}</span> : null}</h3>
        {note ? (
          <div className={cx('semnote', note.tone === 'notice' && 'semnote--notice')}>
            <Ic n={note.tone === 'notice' ? 'refresh' : 'info'} className="ic--14" /><span className="semnote__x">{note.text}</span>
            {note.settings && window.BC_SURFACE.ai ? <BCAction className="tsetup__lnk" onClick={() => app.go({r: 'settings', sec: 'semantic'})}>去设置</BCAction> : null}
          </div>
        ) : null}
        {r.rows.length ? (
          <R.GridList aria-label="讲相近内容的视频" items={r.rows.map((x) => Object.assign({id: x.video}, x))} className="spv__files-list" onAction={(k) => onSwitch(String(k))}>
            {(x) => {
              const target = app.spaceItems.find((i) => i.id === x.video);
              return (
                <R.GridListItem id={x.video} textValue={x.name} className="spv__file">
                  {target ? <window.SpaceItemPreview it={target} movie={movies[x.video]} small /> : null}
                  <span className="spv__file-body">
                    <span className="spv__file-t">{x.name}</span>
                    <span className="spv__file-d" title={line(x)}>{line(x)}</span>
                  </span>
                </R.GridListItem>
              );
            }}
          </R.GridList>
        ) : <p className="spv__hint">{r.by === 'name' ? '没有名字相近的视频' : '没找到讲相近内容的视频'}</p>}
      </section>
    );
  }

  function ViewerBody({it, movies, dirs, close, onSwitch, editing, setEditing, text, setText, source, setSource}) {
    const app = useApp();
    const R = window.RSP;
    const d = it.dir ? dirs[it.dir] : null;
    const mv = it.kind === 'movie' ? movies[it.id] : it.movie ? movies[it.movie] : null;
    const sess = it.session ? app.sessionById(it.session) : null;
    const route = SP.editRoute(it);
    const document = it.kind === 'doc' && /\.md$/i.test(it.file || it.name) && !!it.text;
    const versions = it.kind === 'movie' ? [] : SP.versionsOf(it, app.spaceItems);
    const files = it.kind === 'movie' ? SP.filesOf(app.spaceItems, it.id) : [];
    const shorts = it.kind === 'movie' ? SP.shortsOf(app.spaceItems, it.id) : [];
    /* 切出的短视频：「查看来源视频」换回还在的父视频 */
    const parent = it.kind === 'movie' && it.origin ? app.spaceItems.find((x) => x.id === it.origin && x.kind === 'movie' && !x.trashed) : null;
    /* 文件属于一部还在的视频：「查看视频」换回那部视频的查看框（它的文件都列在那里） */
    const host = it.kind !== 'movie' && it.movie ? app.spaceItems.find((x) => x.id === it.movie && x.kind === 'movie' && !x.trashed) : null;
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
      // docs/design/slides §8.1：在做它的那条会话里开幻灯片标签页；找不到会话就开在 Home
      else if (route === 'slides') { close(); app.go(sess ? {r: 'agent', id: sess.id, slides: it.id} : {r: 'home', slides: it.id}); }
      // docs/design/canvas §8.1：设计稿同一种做法
      else if (route === 'design') { close(); app.go(sess ? {r: 'agent', id: sess.id, design: it.id} : {r: 'home', design: it.id}); }
      // docs/design/canvas §10.6：设计系统也一样，开设计系统标签页
      else if (route === 'design-system') { close(); app.go(sess ? {r: 'agent', id: sess.id, system: it.id} : {r: 'home', system: it.id}); }
      else save();
    };
    const editLabel = {editor: '打开视频', source: '回到来源视频编辑', 'new-movie': '以它为素材新建视频', text: '编辑文字', version: '另存一份再改', slides: '打开幻灯片', design: '打开设计稿', 'design-system': '打开设计系统'}[route];
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
                  {source ? <pre className="spv__text" aria-label="文档源码">{it.text}</pre> : <DocumentReading text={it.text} onMoment={(v, t) => { close(); app.openMovie(v, {via: 'space', t}); }} />}
                </> : it.kind === 'audio' && it.sourceUrl ? <audio controls src={it.sourceUrl} aria-label={it.name} /> : it.text ? <pre className="spv__text">{it.text}</pre>
                  : <window.SpaceItemPreview it={it} movie={mv && it.kind === 'movie' ? mv : null} big />}
              </div>
            )}
            {shorts.length ? <MovieShorts shorts={shorts} movies={movies} onSwitch={onSwitch}
              onList={() => { close(); app.go({r: 'projects', from: it.id}); }} /> : null}
            {it.kind === 'movie' ? <MovieRelated it={it} movies={movies} onSwitch={onSwitch} /> : null}
            {files.length ? <MovieFiles files={files} onSwitch={onSwitch} /> : null}
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
                  {host ? <R.ActionButton size="S" isQuiet onPress={() => onSwitch(host.id)}>查看视频</R.ActionButton> : null}
                  {parent ? <R.ActionButton size="S" isQuiet onPress={() => onSwitch(parent.id)}>查看来源视频</R.ActionButton> : null}
                </span>
              </Fact>
              {loc && (org || loc.isSaveDir) ? <Fact k="位置">{loc.label}{loc.isSaveDir ? '（默认保存位置）' : ''}</Fact> : null}
              <Fact k={it.kind === 'movie' ? '目录' : '文件'}><span className="spv__path">{path}</span></Fact>
              {it.kind === 'movie' && mv && mv.src && mv.src.name ? (
                <Fact k="源文件">
                  <span className="spv__path">{mv.src.path || mv.src.name}</span>
                  {mv.src.state === 'missing' ? <span className="sp-muted">（找不到）</span> : null}
                </Fact>
              ) : null}
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
              {it.trashed || route === 'editor' ? null : <R.Button variant="secondary" onPress={edit} isDisabled={it.status === 'missing' || it.status === 'generating'}>{editLabel}</R.Button>}
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
