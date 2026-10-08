import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Id } from '@baocut/protocol';
import { BLANK_IMAGE, type ImageDraft } from '../model/tools-image.ts';
import { hideJob } from '../model/tools-records.ts';
import { BLANK_TEXT, type TextDraft } from '../model/tools-text.ts';
import { BLANK_COMPRESS, BLANK_EXTRACT, BLANK_MERGE, type TranscodeDraft } from '../model/tools-transcode.ts';
import type { TranscribeMode } from '../model/tools-transcribe.ts';
import { BLANK_TTS, type TtsDraft } from '../model/tools-tts.ts';

/** 转录工具的表单：选的文件只留在这次运行里（路径可能过期），方式、模型与语言跟着草稿记住。 */
export interface TranscribeDraft {
  path: string | null;
  mode: TranscribeMode | null;
  model: string | null;
  language: string;
  /** 「更多选项 › 识别说话人」亲手拨过的值，换模型也留着；null 为没拨过（按模型与装没装「说话人区分」决定）。 */
  speakers: boolean | null;
}

export const BLANK_TRANSCRIBE: TranscribeDraft = { path: null, mode: null, model: null, language: '', speakers: null };

/**
 * 工具页的本机状态（设计稿里各工具的 `jobs.draft`）：表单草稿，切走再回来还在；「删除这条记录」藏起来的任务；重新提交过的记录。
 * 记录本身不在这里——它们是 `jobs` 主题里的任务（model/tools-records.ts）。
 */
export interface ToolsStore {
  hidden: Id[];
  /** 这次运行里已经照原参数重新提交过的没做成的记录：不再给「再试一次」，连点不会多扣一次钱。不落盘。 */
  retried: Id[];
  tts: TtsDraft;
  image: ImageDraft;
  text: TextDraft;
  transcribe: TranscribeDraft;
  /** 压缩视频、合并视频与提取音频的表单：选的文件只留在这次运行里（同转录），编码设置与输出目录跟着草稿记住。 */
  compress: TranscodeDraft;
  merge: TranscodeDraft;
  extract: TranscodeDraft;
  hide(jobId: Id): void;
  markRetried(jobId: Id): void;
  patchTts(patch: Partial<TtsDraft>): void;
  patchImage(patch: Partial<ImageDraft>): void;
  patchText(patch: Partial<TextDraft>): void;
  patchTranscribe(patch: Partial<TranscribeDraft>): void;
  patchCompress(patch: Partial<TranscodeDraft>): void;
  patchMerge(patch: Partial<TranscodeDraft>): void;
  patchExtract(patch: Partial<TranscodeDraft>): void;
}

export const useTools = create<ToolsStore>()(
  persist(
    (set) => ({
      hidden: [],
      retried: [],
      tts: BLANK_TTS,
      image: BLANK_IMAGE,
      text: BLANK_TEXT,
      transcribe: BLANK_TRANSCRIBE,
      compress: BLANK_COMPRESS,
      merge: BLANK_MERGE,
      extract: BLANK_EXTRACT,
      hide: (jobId) => set((s) => ({ hidden: hideJob(s.hidden, jobId) })),
      markRetried: (jobId) => set((s) => (s.retried.includes(jobId) ? s : { retried: [...s.retried, jobId] })),
      patchTts: (patch) => set((s) => ({ tts: { ...s.tts, ...patch } })),
      patchImage: (patch) => set((s) => ({ image: { ...s.image, ...patch } })),
      patchText: (patch) => set((s) => ({ text: { ...s.text, ...patch } })),
      patchTranscribe: (patch) => set((s) => ({ transcribe: { ...s.transcribe, ...patch } })),
      patchCompress: (patch) => set((s) => ({ compress: { ...s.compress, ...patch } })),
      patchMerge: (patch) => set((s) => ({ merge: { ...s.merge, ...patch } })),
      patchExtract: (patch) => set((s) => ({ extract: { ...s.extract, ...patch } })),
    }),
    {
      name: 'baocut.tools',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // 保存位置的「更改…」只改这一次：输出目录不跨次保留。
      partialize: (s) => ({
        hidden: s.hidden,
        tts: s.tts,
        image: s.image,
        text: s.text,
        transcribe: { ...s.transcribe, path: null },
        compress: { ...s.compress, inputs: [], outDir: null },
        merge: { ...s.merge, inputs: [], outDir: null },
        extract: { ...s.extract, inputs: [], outDir: null },
      }),
      // 字段以后加了，旧草稿缺的那几项用空表单补上。
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Pick<ToolsStore, 'hidden' | 'tts' | 'image' | 'text' | 'transcribe' | 'compress' | 'merge' | 'extract'>>;
        return {
          ...current,
          hidden: Array.isArray(p.hidden) ? p.hidden : current.hidden,
          tts: { ...BLANK_TTS, ...p.tts },
          image: { ...BLANK_IMAGE, ...p.image },
          text: { ...BLANK_TEXT, ...p.text },
          transcribe: { ...BLANK_TRANSCRIBE, ...p.transcribe, path: null },
          compress: { ...BLANK_COMPRESS, ...p.compress, inputs: [], outDir: null },
          merge: { ...BLANK_MERGE, ...p.merge, inputs: [], outDir: null },
          extract: { ...BLANK_EXTRACT, ...p.extract, inputs: [], outDir: null },
        };
      },
    },
  ),
);
