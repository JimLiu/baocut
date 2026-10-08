import { useEffect, useState } from 'react';
import { ActionButton, CustomDialog, DialogContainer } from '@react-spectrum/s2';
import type { MediaHandle } from '@baocut/protocol';
import type { ImageCandidate } from '../../model/image-preview.ts';
import type { DraftImage } from '../../state/draft-images-store.ts';
import { ImageLightbox } from './image-lightbox.tsx';
import { FilePreview } from '../file-preview.tsx';
import { IMAGE as M } from '../image-preview-copy.ts';
import { mediaTheme } from './theme.tsx';
export function DraftAttachmentPreview({
  entry,
  entries,
  draftKey,
  conversationId,
  onClose,
}: {
  entry: DraftImage;
  entries: DraftImage[];
  draftKey: string;
  conversationId?: string | null;
  onClose: () => void;
}) {
  // Own URLs keep an open viewer valid if a queued send clears the composer.
  const [resources, setResources] = useState<(ImageCandidate & { handle: MediaHandle })[]>([]);
  useEffect(() => {
    const owned = entries.map((e) => ({
      target: { conversationId: draftKey, attachmentId: e.id },
      name: e.file.name,
      temporary: true,
      handle: {
        url: URL.createObjectURL(e.file),
        mimeType: e.file.type,
        size: e.file.size,
        fileName: e.file.name,
        expiresAt: '9999-01-01T00:00:00Z',
      } satisfies MediaHandle,
    }));
    setResources(owned);
    return () => owned.forEach((r) => URL.revokeObjectURL(r.handle.url));
  }, []);
  const current = resources.find((r) => 'attachmentId' in r.target && r.target.attachmentId === entry.id)!;
  if (!current) return null;
  const image = (name: string, mime: string) => mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(name);
  if (image(entry.file.name, entry.file.type))
    return (
      <ImageLightbox
        initial={current}
        files={resources.filter((r) => image(r.name, r.handle.mimeType))}
        onClose={onClose}
        conversationId={conversationId}
      />
    );
  return (
    <DialogContainer onDismiss={onClose}>
      <CustomDialog size="fullscreen" padding="none" aria-label={entry.file.name} UNSAFE_className={`${mediaTheme} bc-media-dialog`}>
        <header>
          <strong>{entry.file.name}</strong>
          <ActionButton onPress={onClose}>{M.cancel}</ActionButton>
        </header>
        <FilePreview target={current.target} fileName={entry.file.name} resolvedHandle={current.handle} />
      </CustomDialog>
    </DialogContainer>
  );
}
