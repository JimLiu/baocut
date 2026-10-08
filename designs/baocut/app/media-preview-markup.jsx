/* 图片标记与移除蒙版；只导出附图，不修改原图。产品设计 §3.3。 */
(function () {
  const R = window.RSP,
    M = window.BC_MEDIA_PREVIEW;
  function draw(ctx, strokes, width, height, mask) {
    for (const stroke of strokes) {
      const a = stroke.points[0],
        b = stroke.points.at(-1);
      if (!a || !b) continue;
      /* @ds-allow: 黑白蒙版与彩色笔迹是模型输入图像的像素，不是 chrome。 */
      ctx.strokeStyle = mask ? '#ffffff' : stroke.color;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = stroke.width * width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (stroke.tool === 'text') {
        ctx.font = `${Math.max(16, stroke.width * width * 4)}px sans-serif`;
        ctx.fillText(stroke.text || '', a.x * width, a.y * height);
        continue;
      }
      if (stroke.tool === 'rect') ctx.rect(a.x * width, a.y * height, (b.x - a.x) * width, (b.y - a.y) * height);
      else {
        ctx.moveTo(a.x * width, a.y * height);
        for (const p of stroke.points) ctx.lineTo(p.x * width, p.y * height);
        if (stroke.points.length === 1) ctx.lineTo(a.x * width + 0.01, a.y * height);
      }
      ctx.stroke();
      if (stroke.tool === 'arrow') {
        const angle = Math.atan2((b.y - a.y) * height, (b.x - a.x) * width),
          size = Math.max(12, stroke.width * width * 3);
        ctx.beginPath();
        ctx.moveTo(b.x * width - size * Math.cos(angle - 0.5), b.y * height - size * Math.sin(angle - 0.5));
        ctx.lineTo(b.x * width, b.y * height);
        ctx.lineTo(b.x * width - size * Math.cos(angle + 0.5), b.y * height - size * Math.sin(angle + 0.5));
        ctx.stroke();
      }
    }
  }
  function MediaMarkup({ file, mode, active, onCancel, onReady }) {
    const app = useApp(),
      canvas = React.useRef(null),
      image = React.useRef(null),
      drawing = React.useRef(null);
    const saved = app.workspaceMediaState.marks?.[file.id]?.[mode] || { strokes: [], redo: [] };
    const [pending, setPending] = React.useState(null),
      [tool, setTool] = React.useState('brush'),
      [width, setWidth] = React.useState(3),
      [text, setText] = React.useState('');
    /* @ds-allow: 这些颜色只用于输出标记图的笔迹。 */
    const colors = { 红色: '#f04438', 蓝色: '#1570ef', 黄色: '#fdb022', 白色: '#ffffff' };
    const [color, setColor] = React.useState('红色'),
      [size, setSize] = React.useState({ width: 960, height: 600 }),
      [failed, setFailed] = React.useState(false);
    const save = (value) =>
      app.updateWorkspaceMediaState((old) => ({ ...old, marks: { ...old.marks, [file.id]: { ...old.marks?.[file.id], [mode]: value } } }));
    React.useEffect(() => {
      const ctx = canvas.current?.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, size.width, size.height);
      draw(ctx, [...saved.strokes, ...(pending ? [pending] : [])], size.width, size.height, false);
    }, [saved, pending, size]);
    React.useEffect(() => {
      if (!active) {
        drawing.current = null;
        setPending(null);
      }
    }, [active]);
    const locate = (e) => M.point({ x: e.clientX, y: e.clientY }, canvas.current.getBoundingClientRect());
    const down = (e) => {
      if (e.button !== 0 || failed) return;
      const p = locate(e);
      if (!p) return;
      const stroke = { tool: mode === 'remove' ? 'brush' : tool, points: [p], width: width / 100, color: colors[color], text };
      if (stroke.tool === 'text' && !text.trim()) return;
      drawing.current = stroke;
      setPending(stroke);
      e.currentTarget.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (!drawing.current) return;
      const p = locate(e);
      if (!p) return;
      const value = {
        ...drawing.current,
        points: drawing.current.tool === 'brush' ? [...drawing.current.points, p] : [drawing.current.points[0], p]
      };
      drawing.current = value;
      setPending(value);
    };
    const finish = (e) => {
      if (!drawing.current) return;
      save({ strokes: [...saved.strokes, drawing.current], redo: [] });
      drawing.current = null;
      setPending(null);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    };
    const exportImage = () => {
      const output = document.createElement('canvas');
      output.width = size.width;
      output.height = size.height;
      const ctx = output.getContext('2d');
      if (mode === 'remove') {
        /* @ds-allow: 输出黑白蒙版，白色表示待移除区域。 */
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, size.width, size.height);
      } else ctx.drawImage(image.current, 0, 0, size.width, size.height);
      draw(ctx, saved.strokes, size.width, size.height, mode === 'remove');
      onReady({ name: mode === 'remove' ? '移除蒙版.png' : '图片标记.png', url: output.toDataURL('image/png') });
    };
    return (
      <section className="media-markup" aria-label={mode === 'remove' ? '涂抹移除' : '图片标记'}>
        <div className="media-preview__toolbar">
          {mode === 'markup' && (
            <R.Picker aria-label="标记工具" selectedKey={tool} onSelectionChange={setTool}>
              {[
                ['brush', '画笔'],
                ['rect', '矩形'],
                ['arrow', '箭头'],
                ['text', '文字']
              ].map(([id, name]) => (
                <R.PickerItem key={id} id={id}>
                  {name}
                </R.PickerItem>
              ))}
            </R.Picker>
          )}
          {mode === 'markup' && (
            <R.Picker aria-label="笔迹颜色" selectedKey={color} onSelectionChange={setColor}>
              {Object.keys(colors).map((name) => (
                <R.PickerItem id={name} key={name}>
                  {name}
                </R.PickerItem>
              ))}
            </R.Picker>
          )}
          <R.Slider label="画笔大小" minValue={1} maxValue={12} value={width} onChange={setWidth} />
          {tool === 'text' && mode === 'markup' && <R.TextField label="标记文字" value={text} onChange={setText} />}
          <R.ActionButton
            isDisabled={!saved.strokes.length}
            onPress={() => save({ strokes: saved.strokes.slice(0, -1), redo: [...saved.redo, saved.strokes.at(-1)] })}
          >
            撤销
          </R.ActionButton>
          <R.ActionButton
            isDisabled={!saved.redo.length}
            onPress={() => save({ strokes: [...saved.strokes, saved.redo.at(-1)], redo: saved.redo.slice(0, -1) })}
          >
            重做
          </R.ActionButton>
          <R.Button variant="accent" isDisabled={!saved.strokes.length || failed} onPress={exportImage}>
            加入对话草稿
          </R.Button>
          <R.ActionButton onPress={onCancel}>返回图片</R.ActionButton>
        </div>
        <p className="media-preview__hint">
          {mode === 'remove'
            ? '涂抹要移除的区域；原图与黑白蒙版将一起加入草稿。'
            : '在图片上画笔迹、形状或文字；原图与标记图将一起加入草稿。'}
        </p>
        <div className="media-markup__stage">
          <div className="media-markup__canvas">
            <img
              ref={image}
              src={file.previewSrc}
              alt={file.name}
              draggable="false"
              onLoad={(e) => {
                const image = e.currentTarget,
                  scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
                setSize({ width: Math.round(image.naturalWidth * scale), height: Math.round(image.naturalHeight * scale) });
              }}
              onError={() => setFailed(true)}
            />
            <canvas
              ref={canvas}
              width={size.width}
              height={size.height}
              aria-label="图片标记画布"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={() => {
                drawing.current = null;
                setPending(null);
              }}
            />
          </div>
        </div>
        {failed && <p role="alert">图片未能加载，请返回图片后重试。</p>}
      </section>
    );
  }
  window.MediaMarkup = MediaMarkup;
})();
