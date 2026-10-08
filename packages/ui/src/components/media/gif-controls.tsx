import { ActionButton, Picker, PickerItem, ToggleButton, ToastQueue } from '@react-spectrum/s2';
import { IMAGE as M } from '../image-preview-copy.ts';
import { P } from '../player/player-copy.ts';
import type { ImageView } from '../../state/image-preview-store.ts';
import { useGif, downloadBlob, copyPreviewImage } from './gif.ts';
import { retimeGif } from '../../model/media-gif.ts';
export function GifControls({
  gif,
  view,
  update,
  fileName,
  onQueue,
  canQueue,
}: {
  gif: ReturnType<typeof useGif>;
  view: ImageView;
  update: (p: Partial<ImageView>) => void;
  fileName: string;
  canQueue: boolean;
  onQueue: () => Promise<void>;
}) {
  if (gif.failed)
    return (
      <div className="bc-media-error" role="status">
        {M.unavailable}
        <ActionButton onPress={gif.retry}>{M.retry}</ActionButton>
      </div>
    );
  if (!gif.data) return <div role="status">{P.loading}</div>;
  const frame = gif.data.frames[view.frame] ?? gif.data.frames[0]!;
  return (
    <div className="bc-gif-controls">
      <ActionButton onPress={() => update({ playing: !view.playing, sheet: false })}>{view.playing ? P.pause : P.play}</ActionButton>
      <ActionButton isDisabled={view.frame === 0} onPress={() => update({ frame: view.frame - 1, playing: false })}>
        {M.previous}
      </ActionButton>
      <span>
        {M.frame} {view.frame + 1}/{gif.data.frames.length}
      </span>
      <ActionButton
        isDisabled={view.frame === gif.data.frames.length - 1}
        onPress={() => update({ frame: view.frame + 1, playing: false })}
      >
        {M.next}
      </ActionButton>
      <ToggleButton isSelected={view.sheet} onChange={(sheet) => update({ sheet, playing: false })}>
        {M.sheet}
      </ToggleButton>
      <Picker aria-label={P.rate} value={String(view.speed)} onChange={(k) => update({ speed: Number(k) })}>
        {[0.25, 0.5, 1, 1.5, 2].map((n) => (
          <PickerItem key={n} id={String(n)}>
            {n}×
          </PickerItem>
        ))}
      </Picker>
      <ActionButton onPress={() => void copyPreviewImage(frame.url).catch(() => ToastQueue.negative(M.unavailable))}>
        {M.frame} · {M.copy}
      </ActionButton>
      <ActionButton onPress={() => downloadBlob(frame.blob, `frame-${view.frame + 1}.png`)}>
        {M.frame} · {M.download}
      </ActionButton>
      <ActionButton
        onPress={() => {
          try {
            downloadBlob(new Blob([retimeGif(gif.data!.bytes, view.speed)], { type: 'image/gif' }), fileName);
          } catch {
            ToastQueue.negative(M.unavailable);
          }
        }}
      >
        {M.retime}
      </ActionButton>
      <ActionButton isDisabled={!canQueue} onPress={() => void onQueue().catch(() => ToastQueue.negative(M.unavailable))}>
        {M.queue}
      </ActionButton>
    </div>
  );
}
