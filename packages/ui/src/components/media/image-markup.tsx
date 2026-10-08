import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ActionButton, Button, Picker, PickerItem, Slider, TextField, ToastQueue } from '@react-spectrum/s2';
import { IMAGE as M } from '../image-preview-copy.ts';
import { imagePoint, type ImagePoint } from '../../model/image-preview.ts';
import { mediaTheme } from './theme.tsx';
type Tool = 'brush' | 'rect' | 'arrow' | 'text';
interface Stroke {
  tool: Tool;
  points: ImagePoint[];
  width: number;
  color: string;
  text: string;
}
const history = new Map<string, { strokes: Stroke[]; redo: Stroke[] }>();
export function drawMarkup(ctx: CanvasRenderingContext2D, strokes: Stroke[], w: number, h: number, mask: boolean) {
  for (const s of strokes) {
    const a = s.points[0],
      b = s.points.at(-1);
    if (!a || !b) continue;
    // The colors below are output pixels, not UI colors.
    ctx.strokeStyle = mask ? '#fff' : s.color;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = s.width * w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (s.tool === 'text') {
      ctx.font = `${Math.max(16, s.width * w * 4)}px sans-serif`;
      ctx.fillText(s.text, a.x * w, a.y * h);
      continue;
    }
    if (s.tool === 'rect') ctx.rect(a.x * w, a.y * h, (b.x - a.x) * w, (b.y - a.y) * h);
    else {
      ctx.moveTo(a.x * w, a.y * h);
      for (const p of s.points) ctx.lineTo(p.x * w, p.y * h);
      if (s.points.length === 1) ctx.lineTo(a.x * w + 0.01, a.y * h);
    }
    ctx.stroke();
    if (s.tool === 'arrow') {
      const angle = Math.atan2((b.y - a.y) * h, (b.x - a.x) * w),
        size = Math.max(12, s.width * w * 3);
      ctx.beginPath();
      ctx.moveTo(b.x * w - size * Math.cos(angle - 0.5), b.y * h - size * Math.sin(angle - 0.5));
      ctx.lineTo(b.x * w, b.y * h);
      ctx.lineTo(b.x * w - size * Math.cos(angle + 0.5), b.y * h - size * Math.sin(angle + 0.5));
      ctx.stroke();
    }
  }
}
export function ImageMarkup({
  url,
  name,
  resourceKey,
  mask,
  onCancel,
  onReady,
}: {
  url: string;
  name: string;
  resourceKey: string;
  mask: boolean;
  onCancel: () => void;
  onReady: (file: File) => Promise<void>;
}) {
  const key = `${resourceKey}:${mask}`,
    canvas = useRef<HTMLCanvasElement>(null),
    image = useRef<HTMLImageElement>(null),
    drawing = useRef<Stroke | null>(null);
  const [saved, setSaved] = useState(() => history.get(key) || { strokes: [], redo: [] }),
    [pending, setPending] = useState<Stroke | null>(null);
  const [tool, setTool] = useState<Tool>('brush'),
    [width, setWidth] = useState(3),
    [color, setColor] = useState('#f04438'),
    [text, setText] = useState(''),
    [size, setSize] = useState({ width: 960, height: 600 }),
    [failed, setFailed] = useState(false),
    [busy, setBusy] = useState(false);
  const save = (value: typeof saved) => {
    history.set(key, value);
    setSaved(value);
  };
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, size.width, size.height);
      drawMarkup(ctx, [...saved.strokes, ...(pending ? [pending] : [])], size.width, size.height, false);
    }
  }, [saved, pending, size]);
  const locate = (e: PointerEvent) => canvas.current && imagePoint({ x: e.clientX, y: e.clientY }, canvas.current.getBoundingClientRect());
  const end = () => {
    if (drawing.current) save({ strokes: [...saved.strokes, drawing.current], redo: [] });
    drawing.current = null;
    setPending(null);
  };
  const exportFile = async () => {
    if (!image.current || busy) return;
    setBusy(true);
    try {
      const output = document.createElement('canvas');
      output.width = size.width;
      output.height = size.height;
      const ctx = output.getContext('2d')!;
      if (mask) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, size.width, size.height);
      } else ctx.drawImage(image.current, 0, 0, size.width, size.height);
      drawMarkup(ctx, saved.strokes, size.width, size.height, mask);
      const blob = await new Promise<Blob>((resolve, reject) =>
        output.toBlob((b) => (b ? resolve(b) : reject(new Error(M.unavailable))), 'image/png'),
      );
      await onReady(new File([blob], `${name}.${mask ? 'mask' : 'markup'}.png`, { type: 'image/png' }));
    } catch (e) {
      ToastQueue.negative(e instanceof Error ? e.message : M.unavailable);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`${mediaTheme} bc-image-markup`}>
      <header className="bc-image-header">
        <strong>{mask ? M.erase : M.markup}</strong>
        <ActionButton onPress={onCancel}>{M.cancel}</ActionButton>
        {!mask && (
          <>
            <Picker aria-label={M.markup} value={tool} onChange={(k) => setTool(k as Tool)}>
              {(['brush', 'rect', 'arrow', 'text'] as const).map((k) => (
                <PickerItem key={k} id={k}>
                  {k === 'rect' ? M.rectangle : M[k]}
                </PickerItem>
              ))}
            </Picker>
            <Picker aria-label={M.color} value={color} onChange={(k) => setColor(String(k))}>
              {['#f04438', '#1570ef', '#fdb022', '#ffffff'].map((c) => (
                <PickerItem key={c} id={c}>
                  {c}
                </PickerItem>
              ))}
            </Picker>
          </>
        )}
        <Slider label={M.stroke} minValue={1} maxValue={12} value={width} onChange={setWidth} />
        {tool === 'text' && !mask && <TextField label={M.text} value={text} onChange={setText} />}
        <ActionButton
          isDisabled={!saved.strokes.length}
          onPress={() => save({ strokes: saved.strokes.slice(0, -1), redo: [...saved.redo, saved.strokes.at(-1)!] })}
        >
          {M.undo}
        </ActionButton>
        <ActionButton
          isDisabled={!saved.redo.length}
          onPress={() => save({ strokes: [...saved.strokes, saved.redo.at(-1)!], redo: saved.redo.slice(0, -1) })}
        >
          {M.redo}
        </ActionButton>
        <Button variant="primary" isDisabled={!saved.strokes.length || failed || busy} onPress={() => void exportFile()}>
          {M.queue}
        </Button>
      </header>
      <div className="bc-image-stage">
        <div className="bc-image-markup-canvas">
          <img
            ref={image}
            src={url}
            crossOrigin="anonymous"
            alt={name}
            onError={() => setFailed(true)}
            onLoad={(e) => {
              const n = e.currentTarget,
                f = Math.min(1, 4096 / Math.max(n.naturalWidth, n.naturalHeight));
              setSize({ width: Math.max(1, Math.round(n.naturalWidth * f)), height: Math.max(1, Math.round(n.naturalHeight * f)) });
            }}
          />
          <canvas
            ref={canvas}
            width={size.width}
            height={size.height}
            onPointerDown={(e) => {
              if (e.button || failed || busy) return;
              const p = locate(e);
              if (!p || (tool === 'text' && !mask && !text.trim())) return;
              const s: Stroke = { tool: mask ? 'brush' : tool, points: [p], width: width / 100, color, text };
              drawing.current = s;
              setPending(s);
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const p = locate(e),
                s = drawing.current;
              if (!p || !s) return;
              const next = { ...s, points: s.tool === 'brush' ? [...s.points, p] : [s.points[0]!, p] };
              drawing.current = next;
              setPending(next);
            }}
            onPointerUp={end}
            onLostPointerCapture={() => {
              drawing.current = null;
              setPending(null);
            }}
            onPointerCancel={() => {
              drawing.current = null;
              setPending(null);
            }}
          />
          {failed && <p role="status">{M.unavailable}</p>}
        </div>
      </div>
    </section>
  );
}
