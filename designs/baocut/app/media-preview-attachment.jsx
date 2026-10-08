/* Uploaded and queued attachments enter the same image/file viewers without becoming Space outputs. */
(function () {
  const R = window.RSP, A = window.BC_ATTACHMENTS, ids = new Map();
  function resolve(item) {
    const key = item.url || item.name;
    if (!ids.has(key)) ids.set(key, `attachment:${crypto.randomUUID()}`);
    return A.record({...item, id: item.id || ids.get(key)});
  }
  function MediaAttachmentPreview({item, items = [item], onClose}) {
    const app = useApp(), [selected, setSelected] = React.useState(null), [source, setSource] = React.useState(false);
    const records = items.map(resolve), original = resolve(item),
      file = records.find(file => file.id === selected) || original,
      images = records.filter(file => file.contentKind === 'image' && file.previewSrc),
      canOpenTab = app?.route.r === 'agent' && !!app.openWorkspaceAttachment;
    const openTab = () => {app.openWorkspaceAttachment(file); onClose();};
    React.useEffect(() => {
      if (original.contentKind !== 'image' && canOpenTab) {app.openWorkspaceAttachment(original); onClose();}
    }, []);
    if (original.contentKind !== 'image' && canOpenTab) return null;
    return <BCModal size={file.contentKind === 'image' ? 'fullscreenTakeover' : 'L'} title={`附件预览：${file.name}`}
      onClose={onClose} className={file.contentKind === 'image' ? 'media-image-lightbox' : 'bc-attachment-preview'}>
      {file.contentKind === 'image' && file.previewSrc ? <window.MediaImagePreview file={file} files={images} active immersive
        editable={!!app?.sessionById(app.route.id)} onSelect={next => setSelected(next.id)} onClose={onClose}
        onQueued={onClose} onOpenTab={canOpenTab ? openTab : undefined} /> : <>
        <header><strong>{file.name}</strong><R.ActionButton aria-label="关闭附件预览" onPress={onClose}><R.Icons.Close /></R.ActionButton></header>
        {!file.previewSrc ? <p role="status">没有可预览的文件内容，请重新选择文件。</p>
          : file.contentKind === 'audio' ? <window.MediaAudioPreview file={file} active />
          : file.contentKind === 'video' ? <window.MediaVideoPreview file={file} active />
          : <window.FileTabPreview file={file} source={source} />}
        {file.previewSrc && <div className="media-preview__actions"><R.ActionButton onPress={() => window.savePreviewMedia(file)}>下载副本</R.ActionButton>
          {file.text != null && <R.ToggleButton isSelected={source} onChange={setSource}>源码</R.ToggleButton>}</div>}
      </>}
    </BCModal>;
  }
  window.MediaAttachmentPreview = MediaAttachmentPreview;
})();
