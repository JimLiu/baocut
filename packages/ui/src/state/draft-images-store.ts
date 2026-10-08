import { create } from 'zustand';
import { newId, type AttachmentRef } from '@baocut/protocol';

/**
 * 输入区里还没发出去的图片，按草稿键分（会话 ID 或新会话的草稿键）。
 * 只在这个窗口里：File 与预览地址存不进 localStorage，刷新后就没了。
 */
export interface DraftImage {
  id: string;
  file: File;
  /** 缩略图用的本地地址（object URL），移除时收回。 */
  url: string;
  /** 正在上传时的进度 0–100；没在传为 null。 */
  progress: number | null;
  error: string | null;
  /** 已经上传完：再发时不重复上传。 */
  ref: AttachmentRef | null;
}

interface DraftImagesStore {
  images: Record<string, DraftImage[]>;
  /** 加进来的图片已经有了 id 与预览地址（PromptField 粘贴、拖放时自己建的；「+」菜单选的用 `imageEntry`）。 */
  add(draftKey: string, entries: readonly Pick<DraftImage, 'id' | 'file' | 'url'>[]): void;
  remove(draftKey: string, id: string): void;
  patch(draftKey: string, id: string, patch: Partial<Pick<DraftImage, 'progress' | 'error' | 'ref'>>): void;
  /** 发出去了，或放弃了：收回预览地址。 */
  clear(draftKey: string): void;
  /** 新会话建好了、第一句却没发出去：图片跟着文字搬到那个会话的输入框。 */
  move(from: string, to: string): void;
}

const EMPTY: DraftImage[] = [];

export const useDraftImages = create<DraftImagesStore>()((set, get) => ({
  images: {},
  add: (draftKey, entries) => {
    if (!entries.length) return;
    const added = entries.map((e) => ({ id: e.id, file: e.file, url: e.url, progress: null, error: null, ref: null }));
    set((s) => ({ images: { ...s.images, [draftKey]: [...(s.images[draftKey] ?? EMPTY), ...added] } }));
  },
  remove: (draftKey, id) => {
    const gone = get().images[draftKey]?.find((i) => i.id === id);
    if (!gone) return;
    URL.revokeObjectURL(gone.url);
    set((s) => {
      const rest = (s.images[draftKey] ?? EMPTY).filter((i) => i.id !== id);
      const images = { ...s.images };
      if (rest.length) images[draftKey] = rest;
      else delete images[draftKey];
      return { images };
    });
  },
  patch: (draftKey, id, patch) =>
    set((s) => {
      const list = s.images[draftKey];
      if (!list?.some((i) => i.id === id)) return {};
      return { images: { ...s.images, [draftKey]: list.map((i) => (i.id === id ? { ...i, ...patch } : i)) } };
    }),
  clear: (draftKey) => {
    const list = get().images[draftKey];
    if (!list) return;
    for (const image of list) URL.revokeObjectURL(image.url);
    set((s) => {
      const images = { ...s.images };
      delete images[draftKey];
      return { images };
    });
  },
  move: (from, to) =>
    set((s) => {
      const list = s.images[from];
      if (!list) return {};
      const images = { ...s.images, [to]: [...(s.images[to] ?? EMPTY), ...list] };
      delete images[from];
      return { images };
    }),
}));

/** 自己选的文件：建一个预览地址。 */
export function imageEntry(file: File): Pick<DraftImage, 'id' | 'file' | 'url'> {
  return { id: newId('img'), file, url: URL.createObjectURL(file) };
}

export function useDraftImageList(draftKey: string): DraftImage[] {
  return useDraftImages((s) => s.images[draftKey] ?? EMPTY);
}

/**
 * 把这个草稿里还没上传的图片传上去，返回全部图片的引用（按添加顺序）。
 * 每张图的进度、失败写回 store；有一张失败就抛出第一个错误，已经传完的下次不再传。
 */
export async function uploadDraftImages(
  draftKey: string,
  upload: (file: File, onProgress: (percent: number) => void) => Promise<AttachmentRef>,
): Promise<AttachmentRef[]> {
  const store = useDraftImages.getState();
  const list = store.images[draftKey] ?? EMPTY;
  const results = await Promise.allSettled(
    list.map(async (image) => {
      if (image.ref) return image.ref;
      store.patch(draftKey, image.id, { progress: 0, error: null });
      try {
        const ref = await upload(image.file, (progress) => useDraftImages.getState().patch(draftKey, image.id, { progress }));
        useDraftImages.getState().patch(draftKey, image.id, { ref, progress: null });
        return ref;
      } catch (error) {
        useDraftImages.getState().patch(draftKey, image.id, { progress: null, error: (error as Error).message });
        throw error;
      }
    }),
  );
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
  return results.map((r) => (r as PromiseFulfilledResult<AttachmentRef>).value);
}
