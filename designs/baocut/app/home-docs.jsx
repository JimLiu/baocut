/* 会话里的协作文档（docs/design/docs §6、§7.3、§8）：线程里的协作文档卡片、Space 的预览、功能区的协作文档标签页。
   正式版的编辑器是 Claude Docs 风格的活文档（iframe），排版、评论、请求都在它里面；原型只用静态画面占位，画的是协作文档的演示内容
   （data.js `spaceOutputs` 里 kind 为 docs 的条目）：左边是标签页，中间是正文（标题、段落、列表、表格、空行上的请求），右边是评论线程。
   发给智能体：线程上的「发给智能体」把这条评论（`comment`）、请求上的「发给智能体」把这条请求（`ask`）放进当前会话的草稿
   （`draftDocsAnnotations`），composer 上方的「协作文档标注 · N 条」见 home-docs-notes.jsx。没有「标注」开关：评论本身已经在文档里。
   顶上的「版本记录」打开这个标签页的版本（home-docs-versions.jsx，版本记录设计 §13.2）；回到版本之后，正文是回到的那一版。 */
(function () {
  const {useRef, useEffect, useState} = React;
  const D = window.BC_HOME_DOCS;
  const V = window.BC_HOME_DOCS_VERSIONS;
  const W = window.BC_HOME_WORKSPACE;

  /* docs/design/docs §7.3 的卡片：一行，图标、标题、「协作文档 · N 个标签页」，与设计系统卡同一家 */
  function DocsCard({item, sess, onOpen}) {
    const app = useApp();
    const R = window.RSP;
    const open = () => { onOpen?.(); app.openWorkspaceDocs(item.id, sess.id); };
    return <BCAction className="chat-output" aria-label={`打开协作文档「${item.name}」`} onClick={open}>
      <span className="chat-output__icon"><R.Icons.TextParagraph /></span>
      <span className="chat-output__body"><strong title={item.name}>{item.name}</strong><span>{D.meta(item)}</span></span>
      <Ic n="eye" className="ic--16" />
    </BCAction>;
  }

  /** Space 网格与查看框里纸面上印的那一段：标签页名，再是第一个标签页开头几块（请求不印）。 */
  function DocsFace({doc}) {
    const first = doc.tabs[0];
    const blocks = (first?.blocks || []).filter(b => b.type !== 'ask').slice(0, 4);
    return <div className="home-docs__face">
      <span className="home-docs__face-tabs">{doc.tabs.map(t => <i key={t.id}>{t.name}</i>)}</span>
      {blocks.map(b => /^h\d$/.test(b.type) ? <b key={b.id}>{D.blockText(b)}</b> : <span key={b.id}>{D.blockText(b)}</span>)}
    </div>;
  }

  /** 一段原文里挂着评论的那几处：每个线程的原文第一次出现的地方包成 <mark>，跳转时与线程卡片一起闪一下。 */
  function marked(text, threads) {
    let parts = [String(text || '')];
    for (const th of threads) {
      if (!th.quote) continue;
      let done = false;
      parts = parts.flatMap(p => {
        const i = typeof p === 'string' && !done ? p.indexOf(th.quote) : -1;
        if (i < 0) return [p];
        done = true;
        return [p.slice(0, i), <mark key={th.id} className="home-docs__mark" data-thread-id={th.id}>{th.quote}</mark>, p.slice(i + th.quote.length)];
      });
    }
    return parts;
  }

  /* 空行上写给智能体的请求：标成「请求」，带「发给智能体」；看旧版本时只读（没有 `onSend`） */
  function AskBlock({block, sent, onSend}) {
    const R = window.RSP;
    return <div className="home-docs__ask" data-block-id={block.id}>
      <span className="home-docs__ask-mark" aria-hidden="true"><R.Icons.AIMark /></span>
      <div className="home-docs__ask-body">
        <span className="home-docs__tag">请求</span>
        <p>{block.text}</p>
        {sent ? <span className="home-docs__sent"><Ic n="check" className="ic--16" />已在对话草稿里</span> : null}
      </div>
      {onSend ? <R.ActionButton size="S" aria-label={`把这条请求发给智能体：${block.text}`} onPress={onSend}><R.Icons.Send /><R.Text>发给智能体</R.Text></R.ActionButton> : null}
    </div>;
  }

  /* 正文里的一块。`threads` 是挂在这一块上的评论线程 */
  function DocBlock({block: b, threads, ask}) {
    const m = t => marked(t, threads);
    switch (b.type) {
      case 'h1': return <h1 className="home-docs__h1" data-block-id={b.id}>{m(b.text)}</h1>;
      case 'h2': return <h2 className="home-docs__h2" data-block-id={b.id}>{m(b.text)}</h2>;
      case 'h3': return <h3 className="home-docs__h3" data-block-id={b.id}>{m(b.text)}</h3>;
      case 'list': return <ul className="home-docs__list" data-block-id={b.id}>{b.items.map((x, i) => <li key={i}>{m(x)}</li>)}</ul>;
      case 'table': return <div className="home-docs__table bc-scroll" data-block-id={b.id}><table>
        <thead><tr>{b.head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{m(c)}</td>)}</tr>)}</tbody>
      </table></div>;
      case 'ask': return ask(b);
      default: return <p className="home-docs__p" data-block-id={b.id}>{m(b.text)}</p>;
    }
  }

  /* 一个评论线程：引用的原文、几条评论、「发给智能体」。发过（在草稿里）时旁边写一句，再发一次换成新的那条 */
  function ThreadCard({thread, sent, onSend}) {
    const R = window.RSP;
    return <article className="home-docs__thread" data-thread-id={thread.id} aria-label={`评论：${thread.quote}`}>
      <p className="home-docs__quote">{thread.quote}</p>
      <ol className="home-docs__comments">
        {thread.comments.map(c => <li key={c.id} className="home-docs__comment">
          <div className="home-docs__who">{c.agent ? <R.Icons.AIMark /> : null}<strong>{c.author}</strong><span>{c.time}</span></div>
          <p>{c.text}</p>
        </li>)}
      </ol>
      <div className="home-docs__send">
        {sent ? <span className="home-docs__sent"><Ic n="check" className="ic--16" />已在对话草稿里</span> : null}
        <R.ActionButton size="S" aria-label={`把这条评论发给智能体：${thread.quote}`} onPress={onSend}><R.Icons.Send /><R.Text>发给智能体</R.Text></R.ActionButton>
      </div>
    </article>;
  }

  /** 从一条标注跳回来（`item.at` 是那条标注的元素路径）：切到它所在的标签页，找到线程（没有就找那一块），滚到中间闪一下，
      再把 `at` 从路由里去掉。找不到线程或块时只切标签页（尽力而为）。 */
  function useJump({doc, item, page}) {
    const app = useApp();
    const frame = useRef(0);
    useEffect(() => () => cancelAnimationFrame(frame.current), []);
    useEffect(() => {
      if (!item.at || !doc) return;
      const to = D.reveal(doc, item.at);
      app.replace(W.route(app.workspaceKey, {...item, ...(to ? {dtab: to.tab} : {}), at: undefined}));
      if (!to || (!to.thread && !to.block)) return;
      const selector = to.thread ? `[data-thread-id="${to.thread}"]` : `[data-block-id="${to.block}"]`;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      let tries = 0;
      const look = () => {
        const found = page.current ? [...page.current.querySelectorAll(selector)] : [];
        if (!found.length) { if (++tries < 60) frame.current = requestAnimationFrame(look); return; }
        found[0].scrollIntoView({block: 'center', behavior: reduce ? 'auto' : 'smooth'});
        for (const el of found) { el.classList.remove('is-flash'); void el.offsetWidth; el.classList.add('is-flash'); }
      };
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(look);
    }, [item.at]);
  }

  /** 功能区的协作文档标签页（docs/design/docs §8）。`item.dtab` 是停在哪个标签页，不给就是第一个。 */
  function WorkspaceDocs({item}) {
    const app = useApp();
    const R = window.RSP;
    const doc = app.spaceItems.find(it => it.id === item.id && it.kind === 'docs');
    const sid = app.workspaceSessionId;
    const sess = sid ? app.sessionById(sid) : null;
    const notes = sess?.draftDocsAnnotations || [];
    const page = useRef(null);
    const [extra] = window.useDocVersions(doc);
    const [history, setHistory] = useState(false);
    /* 从一条标注跳回来时回到编辑：标注指的是现在的正文 */
    useEffect(() => { if (item.at) setHistory(false); }, [item.at]);
    useJump({doc, item, page});
    if (!doc) return <Empty icon="alert" title="协作文档已移走或删除" />;
    const tab = D.tabOf(doc, item.dtab) || doc.tabs[0];
    const blocks = V.current(doc, tab.id, extra);
    const threads = D.threadsIn(doc, tab.id);
    const go = id => app.replace(W.route(app.workspaceKey, {...item, dtab: id, at: undefined}));
    const send = note => {
      if (!note) return;
      if (!sess) { app.toast('这个标签页还没有会话。先发一句话开始会话，再把评论发给智能体。', 'negative'); return; }
      const next = D.add(notes, {id: crypto.randomUUID(), ...note});
      if (next.error) { app.toast(next.error, 'negative'); return; }
      app.patchSession(sess.id, {draftDocsAnnotations: next.notes});
      app.toast(`已添加到对话 · ${D.tokenLabel(next.notes)}`);
    };
    const inDraft = (kind, path) => D.has(notes, doc.id, kind, path);
    const askNode = b => {
      const note = D.askNote(doc, tab.id, b.id);
      return <AskBlock key={b.id} block={b} sent={!!note && inDraft('ask', note.path)} onSend={() => send(note)} />;
    };
    const dir = app.dirById(doc.dir);
    return <div className="home-docs">
      <header className="home-resource__bar">
        <R.Icons.TextParagraph />
        <div className="grow"><strong>{doc.name}</strong><div className="home-resource__meta">{D.meta(doc)}</div></div>
        <R.ToggleButton isQuiet isSelected={history} onChange={setHistory}><R.Icons.History /><R.Text>版本记录</R.Text></R.ToggleButton>
        <R.ActionButton isQuiet onPress={() => app.go({r: 'projects', id: doc.dir})}>在 Space 中显示</R.ActionButton>
      </header>
      <div className="home-docs__body">
        <nav className="home-docs__tabs bc-scroll" aria-label="标签页">
          {doc.tabs.map(t => {
            const n = D.threadsIn(doc, t.id).length;
            return <BCAction key={t.id} className={cx('home-docs__tab', t.id === tab.id && 'is-active')} aria-current={t.id === tab.id ? 'page' : undefined}
              aria-label={n ? `${t.name}，${n} 个评论线程` : t.name} onClick={() => go(t.id)}>
              <span className="grow">{t.name}</span>{n ? <span className="home-docs__count" aria-hidden="true">{n}</span> : null}
            </BCAction>;
          })}
        </nav>
        <div ref={page} className="home-docs__scroll bc-scroll">
          {history ? <window.DocsVersions key={tab.id} doc={doc} tab={tab} onExit={() => setHistory(false)}
            renderBlock={b => <DocBlock block={b} threads={[]} ask={a => <AskBlock block={a} />} />} /> : <div className="home-docs__sheet">
            <article className="home-docs__page" aria-label={tab.name}>
              {blocks.map(b => <DocBlock key={b.id} block={b} threads={threads.filter(th => th.block === b.id)} ask={askNode} />)}
            </article>
            <aside className="home-docs__aside" aria-label="评论">
              <h2 className="home-docs__aside-title">评论<span>{threads.length}</span></h2>
              {threads.length ? threads.map(th => {
                const note = D.threadNote(doc, th.id);
                return <ThreadCard key={th.id} thread={th} sent={!!note && inDraft('comment', note.path)} onSend={() => send(note)} />;
              }) : <p className="home-docs__none">这个标签页还没有评论。</p>}
            </aside>
          </div>}
        </div>
      </div>
      <footer className="home-resource__path">{dir ? dir.path : ''}{doc.file}</footer>
    </div>;
  }

  Object.assign(window, {DocsCard, DocsFace, WorkspaceDocs});
})();
