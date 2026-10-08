/* 图片查看器的 S2 控件与缩略图导航。布局参考 Codex ref；产品设计 §3.3。 */
(function () {
  const R = window.RSP, M = window.BC_MEDIA_PREVIEW;
  function MediaImageRail({files, file, onSelect, className = ''}) {
    const rail = React.useRef(null);
    React.useEffect(() => {
      const element = rail.current, item = element?.querySelector('[aria-current="true"]');
      if (!element || !item) return;
      const top = item.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
      if (top < element.scrollTop || top + item.offsetHeight > element.scrollTop + element.clientHeight)
        element.scrollTop = top - (element.clientHeight - item.offsetHeight) / 2;
    }, [file.id]);
    return <span ref={rail} className={`media-image-rail ${className}`} role="group" aria-label="图片列表">
      {files.map((image, index) => <BCAction key={image.id} className="media-image-rail__item"
        aria-current={image.id === file.id ? 'true' : undefined} aria-label={`查看图片 ${index + 1}：${image.name}`}
        onClick={() => onSelect(image)} onKeyDown={e => {
          const next = M.galleryKey(index, files.length, e.key);
          if (next === null) return;
          e.preventDefault(); onSelect(files[next]);
          rail.current?.querySelectorAll('button')[next]?.focus();
        }}>
        <img src={image.previewSrc} alt="" loading="lazy" />
      </BCAction>)}
    </span>;
  }
  function MediaImageHeader({file, view, setView, zoom, scale, setZoom, onClose, onOpenTab, onCopy, gif, onPanorama}) {
    const app = useApp();
    return <header className="media-image-header">
      <R.MenuTrigger><R.ActionButton size="M" aria-label="图片视图"><R.Text><span className="media-image-header__label"><R.Icons.Image /><span>{view === 'canvas' ? '画布' : '图片'}</span><R.Icons.ChevronDown /></span></R.Text></R.ActionButton>
        <R.Menu selectionMode="single" selectedKeys={[view]} onAction={key => setView(String(key))}>
          <R.MenuItem id="focused">单图</R.MenuItem><R.MenuItem id="canvas" isDisabled={gif}>画布</R.MenuItem>
        </R.Menu>
      </R.MenuTrigger>
      <span className="media-image-header__name" title={file.name}>{file.name}</span>
      <R.MenuTrigger align="end"><R.ActionButton size="M" aria-label="图片缩放"><R.Text><span className="media-image-header__label"><span>{Math.round(scale * 100)}%</span><R.Icons.ChevronDown /></span></R.Text></R.ActionButton>
        <R.Menu selectionMode="single" selectedKeys={[String(zoom)]} onAction={setZoom}>
          <R.MenuItem id="fit">适合窗口</R.MenuItem>
          {[...new Set([...M.ZOOM, ...(zoom !== 'fit' ? [Number(zoom)] : [])])].sort((a,b) => a-b).map(n => <R.MenuItem key={n} id={String(n)}>{Math.round(n)}%</R.MenuItem>)}
        </R.Menu>
      </R.MenuTrigger>
      <R.MenuTrigger align="end"><R.ActionButton size="M"><R.Text><span className="media-image-header__label"><span>打开</span><R.Icons.ChevronDown /></span></R.Text></R.ActionButton>
        <R.Menu onAction={key => {
          if (key === 'tab') onOpenTab?.();
          if (key === 'copy') onCopy();
          if (key === 'system') app.toast(`原型演示：用系统默认应用打开 ${file.file || file.name}`);
          if (key === 'panorama') onPanorama();
        }}>
          {onOpenTab && <R.MenuItem id="tab">在标签页打开</R.MenuItem>}
          <R.MenuItem id="system">用默认应用打开</R.MenuItem>
          <R.MenuItem id="copy">复制图片</R.MenuItem>
          {file.panorama && <R.MenuItem id="panorama">360° 全景</R.MenuItem>}
        </R.Menu>
      </R.MenuTrigger>
      <R.ActionButton size="M" aria-label={gif ? '下载原始 GIF' : '下载图片'} onPress={() => window.savePreviewMedia(file)}><R.Icons.Download /></R.ActionButton>
      {onClose && <R.ActionButton size="M" aria-label="关闭图片预览" onPress={onClose}><R.Icons.Close /></R.ActionButton>}
    </header>;
  }
  function MediaImageTools({mode, setTool, setView, gif, onRemoveBackground, onResize}) {
    if (!window.BC_SURFACE.ai) return null;
    return <div className="media-image-tools" role="toolbar" aria-label="图片编辑工具">
      {!gif && <R.ActionButton size="S" isQuiet onPress={() => setTool('markup')}><R.Icons.Edit /><R.Text>标记</R.Text></R.ActionButton>}
      <R.ToggleButton size="S" isQuiet isSelected={mode === 'comment'} onChange={on => setTool(on ? 'comment' : 'navigate')}><R.Icons.Comment /><R.Text>批注</R.Text></R.ToggleButton>
      {!gif && <>
        <R.ActionButton size="S" isQuiet onPress={onRemoveBackground}><R.Icons.Image /><R.Text>移除背景</R.Text></R.ActionButton>
        <R.ActionButton size="S" isQuiet onPress={() => setTool('remove')}><R.Icons.Edit /><R.Text>涂抹移除</R.Text></R.ActionButton>
      </>}
      <R.MenuTrigger direction="top"><R.ActionButton size="S" isQuiet><R.Icons.Crop /><R.Text>调整比例</R.Text></R.ActionButton>
        <R.Menu onAction={onResize}>{M.RATIOS.map(ratio => <R.MenuItem id={ratio} key={ratio}>{ratio}</R.MenuItem>)}</R.Menu>
      </R.MenuTrigger>
      {!gif && <R.ActionButton size="S" isQuiet aria-label="多选图片" onPress={() => {setView('canvas'); setTool('select');}}><R.Icons.Images /></R.ActionButton>}
    </div>;
  }
  Object.assign(window, {MediaImageRail, MediaImageHeader, MediaImageTools});
})();
