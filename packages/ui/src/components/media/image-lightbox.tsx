import { useEffect, useRef, useState } from 'react';
import { ActionButton, CustomDialog, DialogContainer, ProgressCircle } from '@react-spectrum/s2';
import type { MediaHandle } from '@baocut/protocol';
import { ImagePreview } from '../image-preview.tsx';
import { IMAGE as M } from '../image-preview-copy.ts';
import type { ImageCandidate } from '../../model/image-preview.ts';
import { pauseOtherPreviews } from '../../model/image-preview.ts';
import { targetKey } from '../../model/media.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useShell } from '../../state/shell-store.ts';
import { useImagePreview } from '../../state/image-preview-store.ts';
import { mediaTheme } from './theme.tsx';
import { ImageRail } from './image-chrome.tsx';
const EMPTY: ImageCandidate[] = [];
export function ImageLightbox({
  files,
  initial,
  onClose,
  onSelect,
  conversationId,
}: {
  files: ImageCandidate[];
  initial: ImageCandidate;
  onClose: () => void;
  onSelect?: (c: ImageCandidate) => void;
  conversationId?: string | null;
}) {
  const groups = useImagePreview((s) => s.groups);
  const [selected, setSelected] = useState(initial);
  const current = files.find((f) => targetKey(f.target) === targetKey(selected.target)) ?? selected;
  useEffect(() => {
    pauseOtherPreviews(null);
    if (files.length > 1 && !files.some((f) => f.temporary)) {
      const group = 'viewer:' + files.map((f) => targetKey(f.target)).join('|');
      for (const file of files) useImagePreview.getState().register(group, file);
      useImagePreview.getState().activate(group);
    }
  }, []);
  return (
    <DialogContainer onDismiss={onClose}>
      <CustomDialog size="fullscreenTakeover" padding="none" aria-label={current.name} UNSAFE_className={`${mediaTheme} bc-image-lightbox`}>
        <ResolvedImage
          candidate={current}
          files={
            files.some((f) => targetKey(f.target) === targetKey(current.target))
              ? files
              : (Object.values(groups).find((g) => g.some((f) => targetKey(f.target) === targetKey(current.target))) ?? [current])
          }
          conversationId={conversationId}
          onClose={onClose}
          onSelect={(c) => {
            setSelected(c);
            onSelect?.(c);
          }}
        />
      </CustomDialog>
    </DialogContainer>
  );
}
function ResolvedImage({
  candidate,
  files,
  conversationId,
  onSelect,
  onClose,
}: {
  candidate: ImageCandidate;
  files: ImageCandidate[];
  conversationId?: string | null;
  onSelect: (c: ImageCandidate) => void;
  onClose: () => void;
}) {
  const runtime = useRuntime(),
    key = targetKey(candidate.target),
    [resolved, setResolved] = useState<{ key: string; handle: MediaHandle | null }>({ key, handle: candidate.handle ?? null }),
    [error, setError] = useState(false);
  const handle = resolved.key === key ? resolved.handle : (candidate.handle ?? null);
  useEffect(() => {
    setError(false);
    if (candidate.temporary) {
      setResolved({ key, handle: candidate.handle ?? null });
      return;
    }
    let cancelled = false;
    void runtime
      .resolveMedia(candidate.target)
      .then((h) => {
        if (!cancelled) setResolved({ key, handle: h });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, key, candidate.handle]);
  if (error || !handle)
    return (
      <div className="bc-media-error">
        {error ? M.unavailable : <ProgressCircle isIndeterminate aria-label={M.image} />}
        <ActionButton onPress={onClose}>{M.cancel}</ActionButton>
      </div>
    );
  return (
    <ImagePreview
      target={candidate.target}
      handle={handle}
      fileName={candidate.name}
      gallery={files}
      onSelect={onSelect}
      conversationId={conversationId}
      immersive
      onClose={onClose}
      onQueued={onClose}
      onOpenTab={
        candidate.temporary
          ? undefined
          : () => {
              useShell.getState().openPane({ kind: 'file', target: candidate.target, name: candidate.name });
              onClose();
            }
      }
    />
  );
}
export function InlineImageGallery({
  candidate,
  group,
  conversationId,
}: {
  candidate: ImageCandidate;
  group: string;
  conversationId: string;
}) {
  const registered = useImagePreview((s) => s.groups[group] ?? EMPTY),
    files = registered.length ? registered : [candidate];
  const [selected, setSelected] = useState(candidate),
    [opened, setOpened] = useState(false),
    [height, setHeight] = useState(300),
    ref = useRef<HTMLSpanElement>(null);
  const current = files.find((f) => targetKey(f.target) === targetKey(selected.target)) ?? candidate;
  useEffect(() => {
    const e = ref.current;
    if (!e) return;
    const observer = new ResizeObserver(([r]) => {
      if (r) setHeight(r.contentRect.height);
    });
    observer.observe(e);
    return () => observer.disconnect();
  }, [files.length]);
  if (files[0] && targetKey(files[0].target) !== targetKey(candidate.target)) return null;
  const open = (view: 'focused' | 'canvas') => {
    useImagePreview.getState().activate(group);
    useImagePreview.getState().view(targetKey(current.target), { view, zoom: 'fit' });
    setOpened(true);
  };
  return (
    <>
      <span className={`${mediaTheme} bc-inline-images`} style={{ '--inline-image-height': `${height}px` } as React.CSSProperties}>
        <span ref={ref} className="bc-inline-image-main">
          <ActionButton aria-label={`${M.image}: ${current.name}`} onPress={() => open('focused')}>
            <img src={current.handle?.url} alt={current.name} />
          </ActionButton>
          {files.length > 1 && (
            <ActionButton size="XS" UNSAFE_className="bc-inline-canvas" onPress={() => open('canvas')}>
              {M.canvasView}
            </ActionButton>
          )}
        </span>
        {files.length > 1 && <ImageRail files={files} selected={targetKey(current.target)} onSelect={setSelected} />}
      </span>
      {opened && <ImageLightbox {...{ files, conversationId }} initial={current} onClose={() => setOpened(false)} onSelect={setSelected} />}
    </>
  );
}
