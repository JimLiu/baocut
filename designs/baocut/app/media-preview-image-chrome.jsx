/* 图片查看器的 S2 控件与缩略图导航。布局参考 Codex ref；产品设计 §3.3。 */
(function () {
  const R = window.RSP, M = window.BC_MEDIA_PREVIEW;
  function MediaImageRail({files, file, onSelect, className = ''}) {
    const rail = React.useRef(null);
    React.useEffect(() => {
      const element = rail.current, item = element?.querySelector('[aria-current="true"]');
      if (!element || !item) return;
      const box = element.getBoundingClientRect(), rect = item.getBoundingClientRect();
      const top = rect.top - box.top + element.scrollTop, left = rect.left - box.left + element.scrollLeft;
      if (top < element.scrollTop || top + item.offsetHeight > element.scrollTop + element.clientHeight)
        element.scrollTop = top - (element.clientHeight - item.offsetHeight) / 2;
      if (left < element.scrollLeft || left + item.offsetWidth > element.scrollLeft + element.clientWidth)
        element.scrollLeft = left - (element.clientWidth - item.offsetWidth) / 2;
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
  /* 全屏查看器底部的缩略图条：平时隐藏，指针移到底边、键盘焦点进入或刚换图时显示；没有悬停的设备一直显示。 */
  function MediaImageDock({files, file, onSelect}) {
    const [peek, setPeek] = React.useState(true);
    React.useEffect(() => {
      setPeek(true);
      const timer = setTimeout(() => setPeek(false), 1500);
      return () => clearTimeout(timer);
    }, [file.id]);
    return <div className={`media-image-dock${peek ? ' is-peek' : ''}`}><MediaImageRail files={files} file={file} onSelect={onSelect} /></div>;
  }
  /* 查看器里只有图标的按钮都配说明提示；表头的朝下弹，底部工具条的朝上弹。 */
  function MediaTip({label, placement = 'bottom', children}) {
    return <R.TooltipTrigger placement={placement}>{children}<R.Tooltip>{label}</R.Tooltip></R.TooltipTrigger>;
  }
  function MediaImageHeader({file, view, setView, zoom, scale, setZoom, onClose, onOpenTab, onCopy, gif, onPanorama}) {
    const app = useApp();
    const zooms = [...new Set([...M.ZOOM, ...(zoom !== 'fit' ? [Number(zoom)] : [])])].sort((a, b) => a - b);
    return <header className="media-image-header">
      <R.SegmentedControl aria-label="视图" selectedKey={view} onSelectionChange={key => setView(String(key))}>
        <R.SegmentedControlItem id="focused"><R.Icons.Image /><R.Text>图片</R.Text></R.SegmentedControlItem>
        <R.SegmentedControlItem id="canvas" isDisabled={gif}><R.Icons.ViewGrid /><R.Text>画布</R.Text></R.SegmentedControlItem>
      </R.SegmentedControl>
      <span className="media-image-header__name" title={file.name}>{file.name}</span>
      <R.Picker aria-label="缩放" isQuiet align="end" value={String(zoom)} onChange={key => key != null && setZoom(String(key))}
        renderValue={() => `${Math.round(scale * 100)}%`}>
        <R.PickerItem id="fit">适合窗口</R.PickerItem>
        {zooms.map(n => <R.PickerItem key={n} id={String(n)}>{`${Math.round(n)}%`}</R.PickerItem>)}
      </R.Picker>
      {/* ActionMenu 套不上提示，拆成 MenuTrigger 里包 TooltipTrigger 的按钮。 */}
      <R.MenuTrigger align="end">
        <MediaTip label="更多选项"><R.ActionButton isQuiet aria-label="更多选项"><R.Icons.More /></R.ActionButton></MediaTip>
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
      <MediaTip label={gif ? '下载原始 GIF' : '下载图片'}>
        <R.ActionButton isQuiet aria-label={gif ? '下载原始 GIF' : '下载图片'} onPress={() => window.savePreviewMedia(file)}><R.Icons.Download /></R.ActionButton>
      </MediaTip>
      {onClose && <MediaTip label="关闭图片预览">
        <R.ActionButton isQuiet aria-label="关闭图片预览" onPress={onClose}><R.Icons.Close /></R.ActionButton>
      </MediaTip>}
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
      {!gif && <MediaTip label="多选图片" placement="top">
        <R.ActionButton size="S" isQuiet aria-label="多选图片" onPress={() => {setView('canvas'); setTool('select');}}><R.Icons.Images /></R.ActionButton>
      </MediaTip>}
    </div>;
  }
  Object.assign(window, {MediaTip, MediaImageRail, MediaImageDock, MediaImageHeader, MediaImageTools});
})();
