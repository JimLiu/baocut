import { useSpace } from '../state/space-store.ts';
import { entryOfTarget } from '../model/workspace.ts';
import { entryPath } from '../model/space.ts';
import { markdownAbsolutePath } from '../model/markdown-file-link.ts';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { MediaTarget, MediaHandle } from '@baocut/protocol';
import { ActionButton, Button, TextArea, ToastQueue, ToggleButton } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { IMAGE as M } from './image-preview-copy.ts';
import { S } from './shell-copy.ts';
import { P } from './player/player-copy.ts';
import { useRuntime } from '../runtime/context.tsx';
import { targetKey } from '../model/media.ts';
import {
  canvasImageCandidates,
  imageFit,
  imagePoint,
  imageRegion,
  type ImageCandidate,
  type ImagePoint,
  type ImageRegion,
} from '../model/image-preview.ts';
import { EMPTY_IMAGE_NOTES, EMPTY_IMAGE_VIEW, useImagePreview } from '../state/image-preview-store.ts';
import { useConnection } from '../state/connection-store.ts';
import { useDirectory } from '../state/directory-store.ts';
import { COMPOSER_MENU, AGENT_PICKER } from '../copy.ts';
import { addImageRequest, addImageBatch } from '../state/image-request.ts';

import { ImageChrome, ImageTools, ImageRail } from './media/image-chrome.tsx';
import { ImageMarkup } from './media/image-markup.tsx';
import { ImagePanorama } from './media/image-panorama.tsx';
import { useImageZoom } from './media/use-image-zoom.ts';
import { useGif, loadPreviewImage, copyPreviewImage, gifContactSheet } from './media/gif.ts';
import { downloadPreview } from './media/compact-player.tsx';
import { mediaTheme } from './media/theme.tsx';
import { ImageEditPrompt } from './media/image-edit-prompt.tsx';
import { GifControls } from './media/gif-controls.tsx';
import './media/media.css';

const root = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: '[480px]', minWidth: 0 });
const layout = style({ display: 'flex', flexWrap: 'wrap', flexGrow: 1, minHeight: 0, minWidth: 0 });
const stageStyle = style({
  display: 'flex',
  flexGrow: 1,
  flexBasis: '[240px]',
  minWidth: 0,
  minHeight: '[320px]',
  overflow: 'auto',
  padding: 24,
  backgroundColor: 'gray-75',
  touchAction: 'none',
});
const canvasStyle = style({
  position: 'relative',
  flexShrink: 0,
  margin: 'auto',
  lineHeight: '[0]',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineWidth: 2,
  outlineOffset: 4,
  outlineColor: 'focus-ring',
});
const imgStyle = style({ display: 'block', width: 'full', height: 'auto', userSelect: 'none', pointerEvents: 'none' });
const boxStyle = style({
  position: 'absolute',
  borderWidth: 2,
  borderStyle: 'solid',
  borderColor: 'blue-900',
  backgroundColor: 'blue-100',
  opacity: '[0.3]',
  pointerEvents: 'none',
  boxSizing: 'border-box',
});
const pinStyle = style({ position: 'absolute', transform: 'translate(-50%, -50%)', lineHeight: '[normal]' });
const commentsStyle = style({
  flexBasis: '[240px]',
  flexGrow: 1,
  maxWidth: '[320px]',
  maxHeight: '[480px]',
  overflowY: 'auto',
  padding: 16,
  boxSizing: 'border-box',
  font: 'ui-sm',
});
const commentStyle = style({
  paddingY: 12,
  borderBottomWidth: 1,
  borderBottomStyle: 'solid',
  borderColor: 'gray-100',
  overflowWrap: 'anywhere',
  whiteSpace: 'pre-wrap',
});
const notice = style({ padding: 12, font: 'ui-sm', color: 'gray-600' });
const actions = style({ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 });

/** 原型 media-preview.jsx 的图片面板；作用域与媒体句柄仍由 Runtime 校验。 */
export function ImagePreview({
  target,
  handle,
  fileName,
  gallery,
  onSelect,
  conversationId,
  immersive = false,
  active = true,
  onClose,
  onOpenTab,
  onQueued,
}: {
  target: MediaTarget;
  handle: MediaHandle;
  fileName: string;
  gallery?: ImageCandidate[];
  onSelect?: (image: ImageCandidate) => void;
  conversationId?: string | null;
  immersive?: boolean;
  active?: boolean;
  onClose?: () => void;
  onOpenTab?: () => void;
  onQueued?: () => void;
}) {
  const runtime = useRuntime();
  const entries = useSpace((s) => s.entries),
    projects = useDirectory((s) => s.projects),
    conversations = useDirectory((s) => s.conversations);
  const entry = entryOfTarget(entries, target);
  const absolute = entry
    ? entryPath(entry, { projects, conversations })
    : 'path' in target
      ? markdownAbsolutePath(
          target.path,
          'projectId' in target
            ? (projects.find((p) => p.id === target.projectId)?.path ?? null)
            : (conversations.find((c) => c.id === target.conversationId)?.cwd ?? null),
        )
      : null;
  const defaultOpen =
    absolute && runtime.host.openFile
      ? () => {
          void runtime.host.openFile!(absolute)
            .then((error) => {
              if (error === null) void runtime.host.revealPath(absolute);
              else if (error) ToastQueue.negative(error);
            })
            .catch((e) => ToastQueue.negative((e as Error).message));
        }
      : undefined;
  const driverId = useDirectory((s) => s.conversations.find((c) => c.id === conversationId)?.driverId);
  const driver = useConnection((s) => s.drivers?.find((d) => d.id === driverId));
  const queueBlocked =
    runtime.host.supportsImageAttachments === false
      ? COMPOSER_MENU.webFilesUnsupported
      : !driver
        ? AGENT_PICKER.detecting
        : !driver.capabilities.images
          ? COMPOSER_MENU.imagesUnsupported(driver.name)
          : null;
  const stage = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLDivElement>(null),
    image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ start: ImagePoint } | { x: number; y: number; left: number; top: number } | null>(null);
  const [viewport, setViewport] = useState({ width: 600, height: 400 });
  const [natural, setNatural] = useState({ width: 960, height: 600 });
  const resourceKey = targetKey(target);
  const view = useImagePreview((s) => s.views[resourceKey] ?? EMPTY_IMAGE_VIEW);
  const update = (patch: Partial<typeof view>) => useImagePreview.getState().view(resourceKey, patch);
  const zoom = view.zoom,
    setZoom = (zoom: string) => update({ zoom });
  const [commenting, setCommenting] = useState(false),
    [tool, setTool] = useState<'markup' | 'erase' | null>(null),
    [panorama, setPanorama] = useState(false);
  const isGif = handle.mimeType === 'image/gif' || /\.gif$/i.test(fileName),
    gif = useGif(handle.url, isGif);
  useEffect(() => {
    if (gif.data && view.frame >= gif.data.frames.length) update({ frame: Math.max(0, gif.data.frames.length - 1) });
  }, [gif.data, view.frame]);
  const frame = gif.data?.frames[Math.min(view.frame, gif.data.frames.length - 1)];
  const displayUrl = frame && !view.sheet ? frame.url : handle.url;
  const [error, setError] = useState(false),
    [imageReady, setImageReady] = useState(false),
    [adding, setAdding] = useState(false);
  const key = resourceKey + (frame ? `:frame:${view.frame}` : '');
  useEffect(() => {
    setError(false);
    setImageReady(!!image.current?.complete && !!image.current?.naturalWidth);
  }, [resourceKey, handle.url]);
  const notes = useImagePreview((s) => s.notes[key] ?? EMPTY_IMAGE_NOTES);
  const { comments, draft } = notes;
  const patch = (value: Partial<typeof draft>) => useImagePreview.getState().patch(key, value);
  const files = gallery?.length ? gallery : [{ target, name: fileName }];
  const groups = useImagePreview((s) => s.groups);
  const canvasFiles = canvasImageCandidates(files, groups, conversationId);
  const selectionKey = conversationId ? 'canvas:' + conversationId : resourceKey;
  const canvasSelection = useImagePreview((s) => s.views[selectionKey]?.selected ?? EMPTY_IMAGE_VIEW.selected);
  const setSelection = (selected: string[]) => useImagePreview.getState().view(selectionKey, { selected });
  const index = files.findIndex((f) => targetKey(f.target) === resourceKey);
  const scale = zoom === 'fit' ? imageFit(natural, viewport) : Number(zoom) / 100;
  const { around, isPinching } = useImageZoom(
    stage,
    canvas,
    scale * 100,
    setZoom,
    `${view.view}:${commenting}:${tool}:${panorama}:${view.sheet}`,
  );
  useEffect(() => {
    if (!active) update({ playing: false });
  }, [active, resourceKey]);
  useEffect(() => {
    if (!active || !gif.data || !view.playing || document.hidden) return;
    const next = setTimeout(
      () => update({ frame: (view.frame + 1) % gif.data!.frames.length }),
      gif.data.frames[view.frame]?.duration! / view.speed,
    );
    return () => clearTimeout(next);
  }, [active, gif.data, view.playing, view.frame, view.speed]);
  useEffect(() => {
    const stop = () => {
      if (document.hidden) update({ playing: false });
    };
    document.addEventListener('visibilitychange', stop);
    return () => document.removeEventListener('visibilitychange', stop);
  }, [resourceKey]);
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width && entry.contentRect.height)
        setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [view.view, tool, panorama, view.sheet]);
  const select = (delta: number) => {
    const next = files[index + delta];
    if (next) onSelect?.(next);
  };
  const locate = (event: PointerEvent) =>
    canvas.current && imagePoint({ x: event.clientX, y: event.clientY }, canvas.current.getBoundingClientRect());
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button') || !stage.current || isPinching()) return;
    if (commenting) {
      const start = locate(event);
      if (!start) return;
      drag.current = { start };
      patch({ region: imageRegion(start, start), text: '', editing: null });
    } else drag.current = { x: event.clientX, y: event.clientY, left: stage.current.scrollLeft, top: stage.current.scrollTop };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || !stage.current || isPinching()) return;
    if ('start' in current) {
      const end = locate(event);
      if (end) patch({ region: imageRegion(current.start, end) });
    } else {
      stage.current.scrollLeft = current.left + current.x - event.clientX;
      stage.current.scrollTop = current.top + current.y - event.clientY;
    }
  };
  const queue = async (request: string) => {
    if (!conversationId || !image.current || !imageReady || adding || queueBlocked) return false;
    setAdding(true);
    try {
      await addImageRequest(conversationId, target, handle, fileName, image.current, request);
      ToastQueue.positive(M.queued);
      onQueued?.();
      return true;
    } catch (error) {
      ToastQueue.negative(S.filePreview.failed((error as Error).message));
      return false;
    } finally {
      setAdding(false);
    }
  };
  const overlay = (region: ImageRegion, id: string) => (
    <div
      key={id}
      className={boxStyle}
      style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}
    />
  );
  const batchQueue = async (candidates: ImageCandidate[], request: string, extras: File[] = []) => {
    if (!conversationId || queueBlocked || adding) return false;
    setAdding(true);
    try {
      const inputs = await Promise.all(
        candidates.map(async (c) => {
          const h = c.handle ?? (await runtime.resolveMedia(c.target));
          return { target: c.target, handle: h, name: c.name, image: await loadPreviewImage(h.url) };
        }),
      );
      await addImageBatch(conversationId, inputs, request, extras);
      ToastQueue.positive(M.queued);
      onQueued?.();
      return true;
    } catch (e) {
      ToastQueue.negative(S.filePreview.failed((e as Error).message));
      return false;
    } finally {
      setAdding(false);
    }
  };
  const currentCandidate = { target, handle, name: fileName };
  if (panorama) return <ImagePanorama url={handle.url} onClose={() => setPanorama(false)} />;
  if (tool)
    return (
      <ImageMarkup
        key={`${resourceKey}:${tool}`}
        url={handle.url}
        name={fileName}
        resourceKey={resourceKey}
        mask={tool === 'erase'}
        onCancel={() => setTool(null)}
        onReady={async (extra) => {
          // i18n-ignore: instruction to the image model, not interface copy.
          const done = await batchQueue(
            [currentCandidate],
            tool === 'erase'
              ? 'Remove the region marked white in the mask; preserve everything else. Create a new image.'
              : 'Apply the markup instructions in the second image to the original. Do not include the marks in the result. Create a new image.',
            [extra],
          );
          if (done) setTool(null);
        }}
      />
    );
  return (
    <section className={`${root} ${mediaTheme} bc-image-preview ${immersive ? 'bc-image-immersive' : ''}`} aria-label={fileName}>
      <ImageChrome
        gif={isGif}
        name={fileName}
        zoom={zoom}
        percent={scale * 100}
        view={view.view}
        onView={(v) => update({ view: v })}
        onZoom={(v) => (v === 'fit' ? setZoom(v) : around(Number(v)))}
        onClose={onClose}
        onDefaultOpen={defaultOpen}
        onOpenTab={onOpenTab}
        onDownload={() => downloadPreview(handle, fileName)}
        onCopy={() => void copyPreviewImage(displayUrl).catch(() => ToastQueue.negative(M.unavailable))}
        onPanorama={() => setPanorama(true)}
      />
      {isGif && (
        <GifControls
          canQueue={!!conversationId && !queueBlocked && !adding}
          {...{ gif, view, update, fileName }}
          onQueue={async () => {
            if (!gif.data) return;
            const notes = useImagePreview.getState().notes;
            const request = gif.data.frames.map((_, i) => ({ frame: i + 1, comments: notes[`${resourceKey}:frame:${i}`]?.comments ?? [] }));
            await batchQueue([currentCandidate], M.changeRequest + '\n' + JSON.stringify(request), [await gifContactSheet(gif.data)]);
          }}
        />
      )}
      {view.view === 'canvas' && (
        <div className="bc-image-batch">
          <ActionButton onPress={() => setSelection(canvasFiles.map((f) => targetKey(f.target)))}>{M.all}</ActionButton>
          <ActionButton onPress={() => setSelection([])}>{M.clear}</ActionButton>
          <Button
            variant="primary"
            isDisabled={!canvasSelection.length || !conversationId || !!queueBlocked || adding}
            onPress={() =>
              void batchQueue(
                canvasFiles.filter((f) => canvasSelection.includes(targetKey(f.target))),
                M.changeRequest +
                  '\n' +
                  JSON.stringify(
                    Object.fromEntries(
                      canvasFiles.map((f) => [f.name, useImagePreview.getState().notes[targetKey(f.target)]?.comments ?? []]),
                    ),
                  ),
              )
            }
          >
            {M.queueSelected}
          </Button>
        </div>
      )}
      <div className={`${layout} bc-image-layout`}>
        {view.view === 'focused' && files.length > 1 && (
          <ImageRail files={files} selected={targetKey(target)} onSelect={(f) => onSelect?.(f)} />
        )}
        <div ref={stage} className={`${stageStyle} bc-scroll bc-image-stage`} style={{ cursor: commenting ? 'crosshair' : 'grab' }}>
          {view.view === 'canvas' ? (
            <div className="bc-image-grid">
              {canvasFiles.map((f) => (
                <div key={targetKey(f.target)}>
                  <ImageRail
                    files={[f]}
                    selected=""
                    onSelect={(c) => {
                      onSelect?.(c);
                      useImagePreview.getState().view(targetKey(c.target), { view: 'focused' });
                    }}
                  />
                  <ToggleButton
                    isSelected={canvasSelection.includes(targetKey(f.target))}
                    onChange={(on) =>
                      setSelection(
                        on ? [...canvasSelection, targetKey(f.target)] : canvasSelection.filter((k) => k !== targetKey(f.target)),
                      )
                    }
                  >
                    {f.name}
                  </ToggleButton>
                </div>
              ))}
            </div>
          ) : view.sheet && gif.data ? (
            <div className="bc-gif-grid">
              {gif.data.frames.map((f, i) => (
                <ActionButton key={i} aria-label={`${M.frame} ${i + 1}`} onPress={() => update({ frame: i, sheet: false, playing: false })}>
                  <img src={f.url} alt={`${M.frame} ${i + 1}`} />
                </ActionButton>
              ))}
            </div>
          ) : error ? (
            <div className={notice} role="status">
              {P.mediaError.decode}
              <ActionButton onPress={() => setError(false)}>{M.retry}</ActionButton>
            </div>
          ) : (
            <div
              ref={canvas}
              className={canvasStyle}
              style={{ width: natural.width * scale }}
              tabIndex={0}
              role="group"
              aria-label={M.canvas}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={(event) => {
                drag.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onLostPointerCapture={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (commenting && event.key === 'Enter') {
                  event.preventDefault();
                  patch({ region: { x: 0.5, y: 0.5, width: 0, height: 0 }, text: '', editing: null });
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  select(event.key === 'ArrowLeft' ? -1 : 1);
                }
              }}
            >
              <img
                ref={image}
                className={imgStyle}
                src={displayUrl}
                crossOrigin="anonymous"
                alt={fileName}
                draggable={false}
                onLoad={(event) => {
                  setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
                  setImageReady(true);
                }}
                onError={() => setError(true)}
              />
              {commenting && comments.map((c) => overlay(c.region, c.id))}
              {commenting && draft.region && overlay(draft.region, 'pending')}
              {commenting &&
                comments.map((c, i) => (
                  <div key={c.id} className={pinStyle} style={{ left: `${c.region.x * 100}%`, top: `${c.region.y * 100}%` }}>
                    <ActionButton
                      size="XS"
                      aria-label={`${M.edit} ${i + 1}`}
                      onPress={() => patch({ region: c.region, text: c.text, editing: c.id })}
                    >
                      {i + 1}
                    </ActionButton>
                  </div>
                ))}
            </div>
          )}
        </div>
        {commenting && (
          <aside className={`${commentsStyle} bc-scroll`} aria-label={M.annotations}>
            <h3>
              {M.annotations} · {comments.length}
            </h3>
            <p>{M.hint}</p>
            {queueBlocked && <p role="status">{queueBlocked}</p>}
            {draft.region && (
              <div>
                <TextArea label={draft.editing ? M.edit : M.add} value={draft.text} onChange={(text) => patch({ text })} autoFocus />
                <div className={actions}>
                  <Button variant="accent" isDisabled={!draft.text.trim()} onPress={() => useImagePreview.getState().save(key)}>
                    {M.save}
                  </Button>
                  <ActionButton onPress={() => patch(EMPTY_IMAGE_NOTES.draft)}>{M.cancel}</ActionButton>
                </div>
              </div>
            )}
            {comments.map((c, i) => (
              <div className={commentStyle} key={c.id}>
                <p>
                  {i + 1}. {c.text}
                </p>
                <div className={actions}>
                  <ActionButton size="XS" isQuiet onPress={() => patch({ region: c.region, text: c.text, editing: c.id })}>
                    {M.edit}
                  </ActionButton>
                  <ActionButton size="XS" isQuiet onPress={() => useImagePreview.getState().remove(key, c.id)}>
                    {M.remove}
                  </ActionButton>
                </div>
              </div>
            ))}
            <div className={actions}>
              <Button
                variant="primary"
                isDisabled={!imageReady || !comments.length || adding || error || !!queueBlocked}
                onPress={() =>
                  void queue(
                    `${M.changeRequest}\n${fileName}\n` +
                      comments
                        .map(
                          (c, i) =>
                            `${i + 1}. [${Object.entries(c.region)
                              .map(([key, n]) => `${key}=${Math.round(n * 100)}%`)
                              .join(', ')}] ${c.text}`,
                        )
                        .join('\n'),
                  )
                }
              >
                {M.queue}
              </Button>
            </div>
          </aside>
        )}
      </div>
      {conversationId && (
        <ImageTools
          gif={isGif}
          commenting={commenting}
          disabled={!imageReady || adding || !!queueBlocked || error}
          onComment={() => {
            setCommenting(!commenting);
            update({ playing: false, sheet: false, view: 'focused' });
          }}
          onMarkup={() => setTool('markup')}
          onErase={() => setTool('erase')}
          onBackground={() => void queue('Remove the background, preserve the foreground, and save a new image with transparency.')}
          onRatio={(r) => void queue(`${M.ratioRequest}\n${fileName}: ${r}`)}
          onSelect={() => update({ view: 'canvas' })}
        />
      )}
      {immersive && conversationId && (
        <ImageEditPrompt
          text={view.prompt}
          onText={(prompt) => update({ prompt })}
          disabled={!imageReady || !view.prompt.trim() || adding || !!queueBlocked}
          onQueue={() => {
            const requested = view.prompt;
            void queue(requested).then((done) => {
              if (done && useImagePreview.getState().views[resourceKey]?.prompt === requested) update({ prompt: '' });
            });
          }}
        />
      )}
      <div className={notice}>
        {fileName} · {natural.width} × {natural.height}
      </div>
    </section>
  );
}
