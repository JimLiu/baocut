import {
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  type MediaTarget,
  type MediaHandle,
} from '@baocut/protocol';
import { ATTACHMENT_COPY } from '../copy.ts';
import { appendImageRequest } from '../model/image-preview.ts';
import { targetKey } from '../model/media.ts';
import { useDraftImages } from './draft-images-store.ts';
import { useShell } from './shell-store.ts';

/** 只读取已授权的媒体句柄；较大的或非常规图片转成有界 PNG 附件，原文件不变。 */
export async function previewImageFile(handle: MediaHandle, name: string, image: HTMLImageElement): Promise<File> {
  if (handle.size > MAX_ATTACHMENT_BYTES) throw new Error(ATTACHMENT_COPY.tooLarge);
  if ((ATTACHMENT_MIME_TYPES as readonly string[]).includes(handle.mimeType)) {
    const response = await fetch(handle.url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error(ATTACHMENT_COPY.tooLarge);
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_ATTACHMENT_BYTES) {
          await reader.cancel();
          throw new Error(ATTACHMENT_COPY.tooLarge);
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    return new File(chunks, name, { type: handle.mimeType });
  }
  if (!image.naturalWidth || !image.naturalHeight) throw new Error(ATTACHMENT_COPY.badType);
  const factor = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * factor));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * factor));
  const context = canvas.getContext('2d');
  if (!context) throw new Error(ATTACHMENT_COPY.badType);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(ATTACHMENT_COPY.badType))), 'image/png'),
  );
  if (blob.size > MAX_ATTACHMENT_BYTES) throw new Error(ATTACHMENT_COPY.tooLarge);
  return new File([blob], `${name}.png`, { type: 'image/png' });
}

/** 完成文件读取后再一起追加图片与文字；用户在等待期间输入的内容也保留。 */
export async function addImageRequest(
  conversationId: string,
  target: MediaTarget,
  handle: MediaHandle,
  name: string,
  image: HTMLImageElement,
  request: string,
): Promise<void> {
  const id = `preview:${targetKey(target)}`;
  const current = () => useDraftImages.getState().images[conversationId] ?? [];
  const present = () =>
    current().some(
      (entry) =>
        entry.id === id || ('attachmentId' in target && (entry.id === target.attachmentId || entry.ref?.id === target.attachmentId)),
    );
  if (!present()) {
    if (current().length >= MAX_ATTACHMENTS_PER_MESSAGE) throw new Error(ATTACHMENT_COPY.tooMany);
    const file = await previewImageFile(handle, name, image);
    if (!present()) {
      if (current().length >= MAX_ATTACHMENTS_PER_MESSAGE) throw new Error(ATTACHMENT_COPY.tooMany);
      useDraftImages.getState().add(conversationId, [{ id, file, url: URL.createObjectURL(file) }]);
    }
  }
  const shell = useShell.getState();
  shell.setDraft(conversationId, appendImageRequest(shell.drafts[conversationId] ?? '', request));
  if (shell.route.tab === 'home' && shell.route.conversationId === conversationId) {
    shell.revealConversation();
  }
}

/** Prepare the full batch before updating the draft; concurrent typing and attachment limits are respected. */
export async function addImageBatch(
  conversationId: string,
  inputs: { target: MediaTarget; handle: MediaHandle; name: string; image: HTMLImageElement }[],
  request: string,
  extras: File[] = [],
): Promise<void> {
  const current = () => useDraftImages.getState().images[conversationId] ?? [];
  const pending = inputs.filter(
    (input, index) =>
      inputs.findIndex((other) => targetKey(other.target) === targetKey(input.target)) === index &&
      !current().some(
        (i) =>
          i.id === `preview:${targetKey(input.target)}` ||
          ('attachmentId' in input.target && (i.id === input.target.attachmentId || i.ref?.id === input.target.attachmentId)),
      ),
  );
  if (current().length + pending.length + extras.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new Error(ATTACHMENT_COPY.tooMany);
  const ready = await Promise.all(
    pending.map(async (input) => ({
      id: `preview:${targetKey(input.target)}`,
      file: await previewImageFile(input.handle, input.name, input.image),
    })),
  );
  for (const file of extras)
    if (file.size > MAX_ATTACHMENT_BYTES || !(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type))
      throw new Error(ATTACHMENT_COPY.tooLarge);
  const additions = [
    ...ready.filter((i) => !current().some((old) => old.id === i.id)),
    ...extras.map((file) => ({ id: crypto.randomUUID(), file })),
  ];
  if (current().length + additions.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new Error(ATTACHMENT_COPY.tooMany);
  useDraftImages.getState().add(
    conversationId,
    additions.map((i) => ({ ...i, url: URL.createObjectURL(i.file) })),
  );
  const shell = useShell.getState();
  shell.setDraft(conversationId, appendImageRequest(shell.drafts[conversationId] ?? '', request));
  shell.revealConversation();
}
