/* 正文大图与沉浸式查看器共享当前图片；缩略图不改变工作区路由。产品设计 §3.3。 */
(function () {
  const R = window.RSP, M = window.BC_MEDIA_PREVIEW;
  function ThreadImageGallery({file}) {
    const app = useApp(), main = React.useRef(null),
      [selected, setSelected] = React.useState(file.id),
      [opened, setOpened] = React.useState(false),
      [failed, setFailed] = React.useState(false),
      [height, setHeight] = React.useState(300);
    const files = M.gallery(file, app.spaceItems).filter(it => !it.previewPending);
    const current = files.find(it => it.id === selected) || file;
    const viewed = file.previewGroup ? app.spaceItems.find(it => it.id === selected && !it.trashed &&
      it.dir === file.dir && it.session === file.session && it.previewGroup && M.kind(it.file) === 'image') || current : current;
    const viewerFiles = M.gallery(viewed, app.spaceItems);
    const book = file.previewGroup ? `generated:${file.session}` : file.id;
    const request = app.workspaceMediaState.requests?.[viewed.id] || '';
    const setRequest = text => app.updateWorkspaceMediaState(old => ({...old, requests: {...old.requests, [viewed.id]: text}}));
    React.useEffect(() => {setSelected(file.id); setOpened(false);}, [file.id]);
    React.useEffect(() => setFailed(false), [current.previewSrc]);
    React.useEffect(() => {
      if (!main.current) return;
      const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
      observer.observe(main.current);
      return () => observer.disconnect();
    }, []);
    const open = view => {
      window.pausePreviewMediaExcept(null);
      if (view === 'focused') setSelected(current.id);
      app.updateWorkspaceMediaState(old => ({...old, views: {...old.views, [book]: {...old.views?.[book], view, zoom: 'fit'}}}));
      setOpened(true);
    };
    const close = () => setOpened(false);
    const openTab = () => {close(); app.openWorkspaceFile(viewed.id);};
    const addRequest = () => {
      if (window.queueMediaRequest(app, [{name: viewed.name, url: viewed.previewSrc}], `请修改图片「${viewed.file}」：\n${request.trim()}\n生成新文件并保留原图。`)) {
        setRequest(''); close();
      }
    };
    return <>
      <span className="amd-media media-image-inline" style={{'--media-image-height': `${height}px`}}>
        <span ref={main} className="media-image-inline__main">
          {failed ? <span className="media-image-inline__error" role="status">图片未能加载。<R.ActionButton size="S" onPress={() => setFailed(false)}>重试</R.ActionButton></span>
            : <BCAction className="media-image-inline__open" aria-label={`放大查看图片：${current.name}`} onClick={() => open('focused')}>
              <img src={current.previewSrc} alt={current.name} onError={() => setFailed(true)} />
            </BCAction>}
          {files.length > 1 && <span className="media-image-inline__canvas"><R.ActionButton size="XS" onPress={() => open('canvas')}><R.Icons.ViewGrid /><R.Text>画布</R.Text></R.ActionButton></span>}
        </span>
        {files.length > 1 && <window.MediaImageRail files={files} file={current} onSelect={it => setSelected(it.id)} />}
      </span>
      {opened && <BCModal size="fullscreenTakeover" title={`图片查看器：${viewed.name}`} onClose={close} className="media-image-lightbox">
        <window.MediaImagePreview file={viewed} files={viewerFiles.length ? viewerFiles : [viewed]} active immersive
          onSelect={it => setSelected(it.id)} onClose={close} onOpenTab={openTab} onQueued={close} />
        {window.BC_SURFACE.ai && <div className="media-image-lightbox__prompt" onKeyDownCapture={e => {
          // The S2 token editor has no line boundary in an empty document.
          if (!request && (e.key === 'Home' || e.key === 'End') && e.target.closest('[contenteditable="true"]')) {
            e.preventDefault(); e.stopPropagation();
          }
        }}>
          <PromptField inputProps={{value: request, placeholder: '描述你想怎样修改这张图片…', 'aria-label': '图片修改要求', onChange: e => setRequest(e.target.value)}}
            toolbar={<><span className="media-image-lightbox__target" title={viewed.name}>{viewed.name}</span><span className="spacer" />
              <R.Button size="S" variant="primary" isDisabled={!request.trim()} onPress={addRequest}>加入对话草稿</R.Button></>} />
        </div>}
      </BCModal>}
    </>;
  }
  function ThreadMediaPreview({src, alt}) {
    const app = useApp(), session = app.sessionById(app.route.id);
    const file = window.BC_FILE_PREVIEW.linkedFile(src, app.spaceItems, session && app.dirOfSession(session));
    if (!file?.previewSrc) return <img className="amd-img" src={src} alt={alt || ''} />;
    const active = !app.workspaceSingle || app.workspaceConversation;
    if (M.kind(file.file) === 'audio') return <window.MediaAudioPreview file={file} inline active={active} />;
    if (M.kind(file.file) === 'video') return <window.MediaVideoPreview file={file} inline active={active} />;
    return <ThreadImageGallery key={file.id} file={file} />;
  }
  window.ThreadMediaPreview = ThreadMediaPreview;
})();
