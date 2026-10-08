/* 图片查看、画布与编辑请求。产品设计 §3.3；智能操作只进入会话草稿。 */
(function () {
  const { useState, useRef, useEffect } = React,
    R = window.RSP,
    M = window.BC_MEDIA_PREVIEW;
  function useNotes(app, file) {
    const comments = app.workspaceMediaState.comments[file.id] || [],
      draft = app.workspaceMediaState.drafts[file.id] || { pending: null, text: '', editing: null };
    const patch = (value) =>
      app.updateWorkspaceMediaState((old) => ({ ...old, drafts: { ...old.drafts, [file.id]: { ...old.drafts[file.id], ...value } } }));
    const setComments = (value) => app.updateWorkspaceMediaState((old) => ({ ...old, comments: { ...old.comments, [file.id]: value } }));
    const cancel = () => patch({ pending: null, text: '', editing: null });
    const save = () => {
      if (!draft.pending || !draft.text.trim()) return;
      const next = { id: draft.editing || crypto.randomUUID(), region: draft.pending, text: draft.text.trim() };
      setComments(draft.editing ? comments.map((c) => (c.id === draft.editing ? next : c)) : [...comments, next]);
      cancel();
    };
    const edit = (comment) => patch({ pending: comment.region, text: comment.text, editing: comment.id });
    const remove = (id) => {
      setComments(comments.filter((c) => c.id !== id));
      if (draft.editing === id) cancel();
    };
    return { comments, draft, patch, cancel, save, edit, remove };
  }
  function ImageSurface({ file, commenting, onPick, onNatural, canvasRef, onDown, onMove, onUp, isPinching, onNavigate }) {
    const app = useApp(),
      notes = useNotes(app, file),
      own = useRef(null),
      ref = canvasRef || own,
      drag = useRef(null),
      [error, setError] = useState(false);
    useEffect(() => setError(false), [file.previewSrc]);
    const locate = (e) => M.point({ x: e.clientX, y: e.clientY }, ref.current.getBoundingClientRect());
    const down = (e) => {
      if (e.button !== 0 || e.target.closest('button') || error || isPinching?.()) return;
      if (!commenting) {
        onDown?.(e);
        return;
      }
      const point = locate(e);
      if (!point) return;
      onPick?.();
      drag.current = point;
      notes.patch({ pending: M.region(point, point), text: '', editing: null });
      e.currentTarget.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (isPinching?.()) {
        drag.current = null;
        return;
      }
      if (commenting && drag.current) {
        const end = locate(e);
        if (end) notes.patch({ pending: M.region(drag.current, end) });
      } else onMove?.(e);
    };
    const up = (e) => {
      drag.current = null;
      onUp?.(e);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    };
    const overlay = (region, key) => (
      <div
        key={key}
        className="media-preview__box"
        style={{
          left: `${region.x * 100}%`,
          top: `${region.y * 100}%`,
          width: `${region.width * 100}%`,
          height: `${region.height * 100}%`
        }}
      />
    );
    if (file.previewPending)
      return (
        <div className="media-preview__notice" role="status">
          <R.ProgressCircle isIndeterminate aria-label="正在生成图片" />
          正在生成图片…
        </div>
      );
    return (
      <div
        ref={ref}
        className="media-preview__canvas"
        tabIndex={0}
        role="group"
        aria-label={commenting ? `批注 ${file.name}，点击或拖选；按 Enter 在中心添加` : `查看 ${file.name}，可拖动平移`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          drag.current = null;
          onUp?.();
        }}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && commenting && e.key === 'Enter') {
            e.preventDefault();
            onPick?.();
            notes.patch({ pending: { x: 0.5, y: 0.5, width: 0, height: 0 }, text: '', editing: null });
          } else if (e.target === e.currentTarget && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault();
            onNavigate?.(e.key === 'ArrowLeft' ? -1 : 1);
          }
        }}
      >
        {error ? (
          <div role="status" className="media-preview__notice">
            图片未能加载。<R.ActionButton onPress={() => setError(false)}>重试</R.ActionButton>
          </div>
        ) : (
          <img
            src={file.previewSrc}
            data-media-image={file.id}
            alt={file.name}
            draggable="false"
            onLoad={(e) => onNatural?.({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
            onError={() => setError(true)}
          />
        )}
        {commenting && notes.comments.map((c) => overlay(c.region, c.id))}
        {commenting && notes.draft.pending && overlay(notes.draft.pending, 'pending')}
        {commenting &&
          notes.comments.map((comment, i) => (
            <div
              key={comment.id}
              className="media-preview__pin"
              style={{ left: `${comment.region.x * 100}%`, top: `${comment.region.y * 100}%` }}
            >
              <R.ActionButton
                size="XS"
                aria-label={`编辑批注 ${i + 1}：${comment.text}`}
                onPress={() => {
                  onPick?.();
                  notes.edit(comment);
                }}
              >
                {i + 1}
              </R.ActionButton>
            </div>
          ))}
      </div>
    );
  }
  function Comments({ file, notes, onQueue, isGif }) {
    return (
      <aside className="media-preview__comments bc-scroll" aria-label="图片批注">
        <h3>
          {file.name} · {notes.comments.length} 条批注
        </h3>
        <p className="media-preview__hint">点击或拖选图片标记区域；切换图片后批注与草稿仍保留。</p>
        {notes.draft.pending && (
          <div>
            <R.TextArea
              label={notes.draft.editing ? '编辑批注' : '添加批注'}
              value={notes.draft.text}
              onChange={(text) => notes.patch({ text })}
              autoFocus
            />
            <div className="media-preview__actions">
              <R.Button variant="accent" isDisabled={!notes.draft.text.trim()} onPress={notes.save}>
                保存批注
              </R.Button>
              <R.ActionButton onPress={notes.cancel}>取消</R.ActionButton>
            </div>
          </div>
        )}
        {notes.comments.map((comment, i) => (
          <div key={comment.id} className="media-preview__comment">
            <p>
              {i + 1}. {comment.text}
            </p>
            <div className="media-preview__actions">
              <R.ActionButton isQuiet onPress={() => notes.edit(comment)}>
                编辑
              </R.ActionButton>
              <R.ActionButton isQuiet onPress={() => notes.remove(comment.id)}>
                删除
              </R.ActionButton>
            </div>
          </div>
        ))}
        {!isGif && (
          <R.Button variant="primary" isDisabled={!notes.comments.length} onPress={onQueue}>
            当前图片批注加入草稿
          </R.Button>
        )}
      </aside>
    );
  }
  function MediaImagePreview({ file, files: candidates, onSelect, active, immersive = false, editable = true, onClose, onOpenTab, onQueued }) {
    const files = candidates.filter((file) => !file.previewPending);
    const app = useApp(),
      stage = useRef(null),
      canvas = useRef(null),
      drag = useRef(null);
    const book = file.previewGroup ? `generated:${file.session}` : file.id;
    const saved = app.workspaceMediaState.views?.[book] || {};
    const view = saved.view || 'focused',
      zoom = saved.zoom || 'fit',
      selected = saved.selected || [];
    const update = (value) =>
      app.updateWorkspaceMediaState((old) => ({ ...old, views: { ...old.views, [book]: { ...old.views?.[book], ...value } } }));
    const [natural, setNatural] = useState({ width: 960, height: 600 }),
      [viewport, setViewport] = useState({ width: 600, height: 400 }),
      [mode, setMode] = useState('navigate'),
      [panorama, setPanorama] = useState(false);
    const gif = window.useMediaGif(file, active),
      frame = gif.data?.frames[gif.frame];
    const display = frame
      ? { ...file, id: `${file.id}:frame:${gif.frame}`, name: `${file.name} · 第 ${gif.frame + 1} 帧`, previewSrc: frame.url }
      : file;
    const notes = useNotes(app, display),
      index = files.findIndex((it) => it.id === file.id),
      scale = zoom === 'fit' ? M.fit(natural, viewport) : Number(zoom) / 100;
    const { around, isPinching } = window.useMediaZoom(
      stage,
      canvas,
      scale * 100,
      (zoom) => update({ zoom }),
      `${view}:${mode}:${panorama}:${gif.view}`
    );
    const canvasFiles = file.previewGroup
      ? app.spaceItems.filter(
          (it) => !it.trashed && it.dir === file.dir && it.session === file.session && it.previewGroup && M.kind(it.file) === 'image'
        )
      : files;
    const groups = [...new Set(canvasFiles.map((it) => it.previewGroup || it.id))];
    const queue = (images, text) => {
      const done = window.queueMediaRequest(app, images, text);
      if (done) onQueued?.();
      return done;
    };
    const original = { name: file.name, url: file.previewSrc };
    const comments = app.workspaceMediaState.comments;
    const batch = canvasFiles.filter((it) => selected.includes(it.id) && !it.previewPending);
    const batchCommented = canvasFiles.filter((it) => comments[it.id]?.length && !it.previewPending);
    useEffect(() => {
      setPanorama(false);
      drag.current = null;
    }, [file.id]);
    useEffect(() => {
      if (!stage.current) return;
      const observer = new ResizeObserver(([e]) => {
        if (e.contentRect.width && e.contentRect.height) setViewport({ width: e.contentRect.width, height: e.contentRect.height });
      });
      observer.observe(stage.current);
      return () => observer.disconnect();
    }, [view, mode, panorama]);
    useEffect(() => {
      if (!active) drag.current = null;
    }, [active]);
    const setTool = (value) => {
      setMode(value);
      if (gif.isGif && value === 'comment') gif.update({ playing: false, view: 'single' });
    };
    const step = (delta) => {
      const next = files[index + delta];
      if (next && !next.previewPending) onSelect(next);
    };
    const down = (e) => {
      if (!stage.current || isPinching()) return;
      drag.current = { x: e.clientX, y: e.clientY, left: stage.current.scrollLeft, top: stage.current.scrollTop };
      e.currentTarget.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (!drag.current || isPinching()) return;
      stage.current.scrollLeft = drag.current.left + drag.current.x - e.clientX;
      stage.current.scrollTop = drag.current.top + drag.current.y - e.clientY;
    };
    const pending = mode === 'markup' || mode === 'remove';
    if (panorama) return <window.MediaPanorama key={file.id} file={file} active={active} onClose={() => setPanorama(false)} />;
    if (pending)
      return (
        <window.MediaMarkup
          key={`${file.id}:${mode}`}
          file={file}
          mode={mode}
          active={active}
          onCancel={() => setMode('navigate')}
          onReady={(attachment) => {
            if (
              queue(
                [original, attachment],
                mode === 'remove'
                  ? `请从第一张图片「${file.file}」中移除第二张黑白蒙版标白的区域，保持其余内容不变。生成新文件并保留原图。`
                  : `请根据第二张标记图修改第一张原图「${file.file}」。标记是修改指示，不要保留在成品里；生成新文件并保留原图。`
              )
            )
              setMode('navigate');
          }}
        />
      );
    return (
      <section className={cx("media-preview media-preview--image", immersive && "media-preview--immersive")} aria-label={`图片预览：${file.name}`}>
        <window.MediaImageHeader file={file} view={view} setView={view => update({view})} zoom={zoom} scale={scale}
          setZoom={key => key === 'fit' ? update({zoom: 'fit'}) : around(Number(key))} onClose={onClose} onOpenTab={onOpenTab}
          gif={gif.isGif} onPanorama={() => setPanorama(true)}
          onCopy={() => window.copyMediaImage(display.previewSrc).then(() => app.toast('图片已复制。')).catch(e => app.toast(e.message, 'negative'))} />
        {view === 'canvas' && !gif.isGif && (
          <div className="media-preview__toolbar">
            <span>{mode === 'comment' ? `${batchCommented.length} 张图片有批注` : `已选择 ${batch.length} 张`}</span>
            {window.BC_SURFACE.ai && (
              <>
                <R.ActionButton onPress={() => update({ selected: canvasFiles.filter((it) => !it.previewPending).map((it) => it.id) })}>
                  全选
                </R.ActionButton>
                <R.ActionButton onPress={() => update({ selected: [] })}>清除选择</R.ActionButton>
                <R.Button
                  variant="primary"
                  isDisabled={!batch.length}
                  onPress={() =>
                    queue(
                      batch.map((it) => ({ name: it.name, url: it.previewSrc })),
                      `请一起修改这 ${batch.length} 张图片，保持视觉风格一致。生成新文件并保留原图。`
                    )
                  }
                >
                  所选图片加入草稿
                </R.Button>
                <R.Button
                  variant="primary"
                  isDisabled={!batchCommented.length}
                  onPress={() =>
                    queue(
                      batchCommented.map((it) => ({ name: it.name, url: it.previewSrc })),
                      M.batchPrompt(batchCommented, comments)
                    )
                  }
                >
                  批量批注加入草稿
                </R.Button>
              </>
            )}
          </div>
        )}
        {gif.isGif && <window.MediaGifControls file={file} gif={gif} comments={comments} onQueue={queue} />}
        {gif.isGif && gif.data && gif.view === 'sheet' ? (
          <window.MediaGifSheet gif={gif} />
        ) : (
          <div className="media-preview__layout">
            {view === 'focused' && files.length > 1 && <window.MediaImageRail files={files} file={file} onSelect={onSelect} />}
            <div ref={stage} className={cx('media-preview__stage bc-scroll', mode === 'comment' && 'is-commenting')}>
              {view === 'canvas' && !gif.isGif ? (
                <div ref={canvas} className="media-gallery">
                  {groups.map((group) => (
                    <section className="media-gallery__group" key={group}>
                      <h3>{canvasFiles.find((it) => (it.previewGroup || it.id) === group)?.previewGroupLabel || '本轮候选'}</h3>
                      <div className="media-gallery__grid">
                        {canvasFiles
                          .filter((it) => (it.previewGroup || it.id) === group)
                          .map((item) => (
                            <div
                              className="media-gallery__card"
                              key={item.id}
                              style={{ width: 240 * (zoom === 'fit' ? 1 : Number(zoom) / 100) }}
                            >
                              <ImageSurface file={item} commenting={mode === 'comment'} onPick={() => onSelect(item)} />
                              <div className="media-gallery__caption">
                                <R.ToggleButton
                                  isDisabled={item.previewPending}
                                  isSelected={selected.includes(item.id)}
                                  onChange={(on) =>
                                    update({ selected: on ? [...selected, item.id] : selected.filter((id) => id !== item.id) })
                                  }
                                >
                                  {item.name}
                                </R.ToggleButton>
                                <R.ActionButton
                                  size="XS"
                                  isDisabled={item.previewPending}
                                  onPress={() => {
                                    onSelect(item);
                                    update({ view: 'focused' });
                                  }}
                                >
                                  单图查看
                                </R.ActionButton>
                              </div>
                            </div>
                          ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="media-preview__sized" style={{ width: natural.width * scale }}>
                  <ImageSurface
                    key={display.id}
                    file={display}
                    canvasRef={canvas}
                    commenting={mode === 'comment'}
                    onNatural={setNatural}
                    onDown={down}
                    onMove={move}
                    onUp={() => {
                      drag.current = null;
                    }}
                    isPinching={isPinching}
                    onNavigate={step}
                  />
                </div>
              )}
            </div>
            {mode === 'comment' && (
              <Comments
                file={display}
                notes={notes}
                isGif={gif.isGif}
                onQueue={() => queue([original], M.commentPrompt(file, notes.comments))}
              />
            )}
          </div>
        )}
        {editable && <window.MediaImageTools mode={mode} setTool={setTool} setView={view => update({view})} gif={gif.isGif}
          onRemoveBackground={() => queue([original], `请移除图片「${file.file}」的背景，保留完整前景主体、平滑边缘，并使用透明背景。生成新文件并保留原图。`)}
          onResize={ratio => queue([original], M.resizePrompt(file, String(ratio)))} />}
        <div className="media-preview__notice">
          {file.name} · {natural.width} × {natural.height} · Ctrl / ⌘＋滚轮或双指缩放
        </div>
      </section>
    );
  }
  Object.assign(window, { MediaImagePreview });
})();
