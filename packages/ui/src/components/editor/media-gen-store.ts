import { create } from 'zustand';
import type { Id } from '@baocut/protocol';
import type { EditorImageDraft } from '../../model/media-generation.ts';
import { BLANK_IMAGE } from '../../model/tools-image.ts';
import { BLANK_TTS, type TtsDraft } from '../../model/tools-tts.ts';

/**
 * 素材面板里生成的那几页按视频记的状态（设计稿 editor.jsx 的 `paneView` 与 panel-image-gen.jsx 的 `J.drafts[scope]`）：
 * 音频 Tab 翻到哪个子页、图片 Tab 在哪一段、两张表单的草稿、生成语音正在看的那个任务。放在模块级：
 * 在时间线上选中东西会把右栏切到「属性」，回来时子页与草稿都还在；不往 editor-store 里加字段。
 */

export type AudioSubpage = 'tts' | 'clone';
export type ImageSegment = 'project' | 'gen';

export interface MediaGenState {
  /** 音频 Tab 的子页；null 为素材列表。 */
  audio: AudioSubpage | null;
  image: ImageSegment;
  tts: TtsDraft;
  /** 生成语音子页提交的那个任务（看它的进度与结果）；null 为还在填表。 */
  ttsJob: Id | null;
  img: EditorImageDraft;
  /** 「最近生成」展开了全部批次没有。 */
  allImages: boolean;
}

export const BLANK_MEDIA_GEN: MediaGenState = {
  audio: null,
  image: 'project',
  tts: BLANK_TTS,
  ttsJob: null,
  img: { ...BLANK_IMAGE, fit: true },
  allImages: false,
};

interface MediaGenStore {
  byVideo: Record<Id, MediaGenState>;
  patch(videoId: Id, patch: Partial<MediaGenState>): void;
  patchTts(videoId: Id, patch: Partial<TtsDraft>): void;
  patchImage(videoId: Id, patch: Partial<EditorImageDraft>): void;
}

export const useMediaGenStore = create<MediaGenStore>()((set) => ({
  byVideo: {},
  patch: (videoId, patch) => set((s) => ({ byVideo: { ...s.byVideo, [videoId]: { ...(s.byVideo[videoId] ?? BLANK_MEDIA_GEN), ...patch } } })),
  patchTts: (videoId, patch) =>
    set((s) => {
      const cur = s.byVideo[videoId] ?? BLANK_MEDIA_GEN;
      return { byVideo: { ...s.byVideo, [videoId]: { ...cur, tts: { ...cur.tts, ...patch } } } };
    }),
  patchImage: (videoId, patch) =>
    set((s) => {
      const cur = s.byVideo[videoId] ?? BLANK_MEDIA_GEN;
      return { byVideo: { ...s.byVideo, [videoId]: { ...cur, img: { ...cur.img, ...patch } } } };
    }),
}));

/** 这个视频的那一份（没有记过时是空白的那份，引用稳定）。 */
export function useMediaGen(videoId: Id | null): MediaGenState {
  return useMediaGenStore((s) => (videoId ? (s.byVideo[videoId] ?? BLANK_MEDIA_GEN) : BLANK_MEDIA_GEN));
}
