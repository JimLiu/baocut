/* 简洁会话头与消息产物卡（product-design §3.2–§3.3 的用户修订）。
   顶部保留标题与会话菜单（产物改在标题栏的「会话摘要」里看）；视频在消息中出现，点击在 Home 右侧打开。
   视频卡（§3.2.7、§4.2）：视频记录一存在就出现（转录开始、下载完成、导入完成），「打开编辑器」始终可用；
   头上一枚状态（BADGE 词表），下面是这部视频上的活（agent-cards.jsx 的 MovieJobRows）：只摊开正在进行的，
   都结束了只摊开最后一件，其余收进「之前的 N 项」展开才看到，里面有失败待处理的那一行写「N 项待处理」（BC_AGENT_CARDS.foldRows，§3.2.2）。
   线程里一条会话一部视频一张卡（锚点见 BC_AGENT_PROJECTS.sessionArtifacts），与「会话摘要」弹层里那张一样算整条会话的活。
   内容从视频记录与任务记录算（BC_AGENT_CARDS.movieCard）。 */
(function () {
  const {useState} = React;
  const AP = window.BC_AGENT_PROJECTS;

  // product-design §3.2.7: a visual delivery card opens the movie in the right pane.
  function SessionMoviePreview({movie, duration}) {
    const [failedPoster, setFailedPoster] = useState(null);
    const poster = movie?.preview?.poster;
    const hasPoster = poster && failedPoster !== poster;
    const missing = movie?.src?.state === 'missing';
    const demo = !hasPoster && !missing && movie?.sample && movie?.bare && !movie?.preview;
    const sample = window.BC_DATA.subtitle.sample;
    const sourceLang = movie?.lang === '英语' ? 'en' : 'zh';
    const targetLang = sourceLang === 'en' ? 'zh' : 'en';
    return <span className="chat-movie__preview" aria-hidden="true">
      {hasPoster && !missing ? <img src={poster} alt="" onError={() => setFailedPoster(poster)} />
        : demo ? <span className="chat-movie__demo" style={{background: window.BC_DATA.sources.video[0].grad}}>
          <span className="chat-movie__sample">示例画面</span>
          <span className="chat-movie__captions">
            {movie.entry === 'trans' && <span>{sample[targetLang].line}</span>}
            <span>{sample[sourceLang].line}</span>
          </span>
        </span> : <span className="chat-movie__empty"><Ic n={missing ? 'alert' : 'film'} />{missing ? '找不到源文件' : '暂无缩略图'}</span>}
      {(hasPoster || demo) && !missing && <span className="chat-movie__open"><Ic n="play" className="ic--20" /></span>}
      {duration > 0 && <span className="chat-movie__duration">{window.BC_TIME.timecode(duration, {decimals: 0})}</span>}
    </span>;
  }

  function SessionArtifactCard({item, sess, onOpen}) {
    const app = useApp();
    const R = window.RSP;
    const kind = window.BC_SPACE.KINDS[item.kind];
    const Icon = R.Icons[kind?.icon || 'FileText'];
    const movie = item.kind === 'movie';
    const project = movie ? app.projects.find(p => p.id === item.id) : null;
    /* 线程里的卡与「会话摘要」弹层里的同一张卡都列整条会话在这部视频上的活 */
    const card = movie ? window.BC_AGENT_CARDS.movieCard(project, sess, app.tasks) : null;
    const open = () => {
      if (movie) { onOpen?.(); app.openMovie(item.id, {sid: sess.id, via: 'home'}); }
      else { onOpen?.(); app.openWorkspaceFile(item.id, sess.id); }
    };
    const dur = project ? project.duration : item.dur;
    return <>
      {movie ? <div className="chat-output chat-output--movie">
        <BCAction className="chat-movie__preview-action" aria-label={`打开视频「${item.name}」`} onClick={open}>
          <SessionMoviePreview movie={project} duration={dur} />
        </BCAction>
        <div className="chat-movie__footer"><div className="chat-output__body"><strong title={item.name}>{item.name}</strong>
          <span className="chat-movie__meta"><Chip tone={card.badge.tone}>{card.badge.text}</Chip>
            <span>视频{dur ? ` · ${window.BC_TIME.duration(dur)}` : ''}</span></span></div>
          <div className="chat-movie__actions"><R.ActionButton size="S" onPress={open}><R.Text>打开编辑器</R.Text></R.ActionButton></div>
        </div>
        {window.MovieJobRows ? <window.MovieJobRows shown={card.shown} earlier={card.earlier} pending={card.pending} /> : null}
      </div> : <BCAction className="chat-output" aria-label={`预览「${item.name}」`} onClick={open}>
        <span className="chat-output__icon"><Icon /></span>
        <span className="chat-output__body"><strong title={item.name}>{item.name}</strong>
          <span>{kind?.label || '文件'}{item.dur ? ` · ${window.BC_TIME.duration(item.dur)}` : ''}</span>
        </span>
        <Ic n="eye" className="ic--16" />
      </BCAction>}

    </>;
  }

  function HomeSessionHead({sess, dir}) {
    const app = useApp();
    const R = window.RSP;
    const dirId = sess ? AP.dirOf(sess, app.projects) : dir || null;
    const d = dirId ? app.dirById(dirId) : null;
    const title = sess?.title || '新会话';
    const onAction = k => {
      if (k === 'pin') app.toggleSessionPin(sess.id);
      else if (k === 'space') app.go({r: 'projects', id: d.id});
      else if (k === 'new') app.go(d ? {r: 'agent', dir: d.id} : {r: 'home'});
      else if (k === 'reveal') app.toast(`已在文件夹中显示 ${d.path}（演示）`);
    };
    return <div className="hhd">
      <R.Heading level={1} UNSAFE_className="hhd__title" title={title}>{title}</R.Heading>
      {sess && ['running', 'waiting'].includes(sess.status) ? <span className="hhd__status" role="status">
        {sess.status === 'running' ? '进行中' : '待允许'}</span> : null}
      <R.ActionMenu aria-label="会话操作" isQuiet onAction={onAction}>
        <R.MenuItem id="new" textValue="新建会话"><R.Icons.Add /><R.Text>{d ? '在此项目中新建会话' : '新建会话'}</R.Text></R.MenuItem>
        {sess ? <R.MenuItem id="pin" textValue={sess.pinned ? '取消置顶' : '置顶'}><R.Icons.PinOn /><R.Text>{sess.pinned ? '取消置顶' : '置顶'}</R.Text></R.MenuItem> : null}
        {d ? <R.MenuItem id="space" textValue={`在 Space 中查看 ${d.name}`}><R.Icons.Asset /><R.Text>{d.name}</R.Text></R.MenuItem> : null}
        {d ? <R.MenuItem id="reveal" textValue="在文件夹中显示项目"><R.Icons.OpenIn /><R.Text>在文件夹中显示项目</R.Text></R.MenuItem> : null}
      </R.ActionMenu>
    </div>;
  }

  Object.assign(window, {HomeSessionHead, SessionArtifactCard});
})();
