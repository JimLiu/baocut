import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Id, Revision } from '@baocut/protocol';
import { mergeDraft, type ItemDraft } from '../model/item-draft.ts';
import { ZOOM_DEFAULT, ZOOM_MIN, clampZoom } from '../model/timeline-zoom.ts';

/**
 * 编辑器的界面状态：选区、播放头、缩放与面板宽度。只属于这个窗口；
 * 在 Home 与 Space 之间切换、收起或展开会话时保持（产品设计 §5.1）。
 */

export { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from '../model/timeline-zoom.ts';
export const TIMELINE_HEIGHT_DEFAULT = 240;
export const TIMELINE_HEIGHT_MIN = 140;

/** 右侧面板（原型 model-layout.js 的 pane）：默认 360，300–560；拖到 340 以下收起，展开时回到收起前的宽度。 */
export const PANEL_WIDTH_DEFAULT = 360;
export const PANEL_WIDTH_MIN = 300;
export const PANEL_WIDTH_MAX = 560;
export const PANEL_COLLAPSE_BELOW = 340;

/**
 * 右侧面板的页：文稿、字幕、元素、文字、三类素材库、品牌与属性（选中片段时是片段的属性，否则是视频的）。
 * `aitools` 是工具页的宿主，不在工具栏上：从所在面板的入口打开（产品设计 §5.10）。
 */
export type PanelTab = 'transcript' | 'subtitle' | 'aitools' | 'elements' | 'text' | 'image' | 'video' | 'audio' | 'brand' | 'props';

/** 网页宿主没有工具页（原型 model-surface.js `WEB_RAIL_DROP`）：记着的是它时落回文稿。 */
export function hostPanelTab(tab: PanelTab, web: boolean): PanelTab {
  return web && tab === 'aitools' ? 'transcript' : tab;
}

/** 拖动中还没提交的字幕样式：预览读这份正文代替文档的 `baseRevision` 版本（见 video-editor 的 DraftDocuments）。 */
export interface DocumentDraft {
  documentId: Id;
  baseRevision: Revision;
  body: unknown;
}

/** 文稿里选中的词：同一份转写里的词下标；`anchor`–`focus` 是正在拖的那一段，`extra` 是 ⌘ 点选攒下的别的几段。 */
export interface WordSelection {
  assetId: Id;
  anchor: number;
  focus: number;
  extra: Array<[number, number]>;
}

export interface EditorStore {
  /** 打开的是哪个视频；换了视频时清掉选区与播放头。 */
  videoId: Id | null;
  selection: Id[];
  /**
   * 文稿面板里选中的词（不持久化）。与 `selection` 互斥（产品设计 §5.7 不跨模式删除）：选出词时清掉片段选区，
   * 选中片段时清掉词选区——否则 transport 的删除钮与 ⌫ 删的是片段，不是眼前这段字。清空任一边不动另一边。
   */
  wordSelection: WordSelection | null;
  /** 播放头（秒）。 */
  playhead: number;
  playing: boolean;
  /** 时间线缩放：每秒多少像素。 */
  pxPerSecond: number;
  /**
   * 缩小的下限（不持久化）：时间线按时长与泳道宽写入（model/timeline-zoom 的 zoomFloor）。
   * `setZoom` 夹到 [min(ZOOM_MIN, zoomFloor), ZOOM_MAX]，滚轮、按钮、菜单与快捷键都走这一处。
   */
  zoomFloor: number;
  timelineHeight: number;
  panelTab: PanelTab;
  panelWidth: number;
  /** 右侧面板收起：再点一次当前页，或把面板拖窄到收起线以下。工具栏一直在。 */
  panelHidden: boolean;
  /** 属性页拖动中的草稿（不持久化）：换选区时丢掉。 */
  draft: ItemDraft | null;
  documentDraft: DocumentDraft | null;
  /** 换到另一个视频：选区与播放头归零；给了落点就切到那一页（设计稿：有素材落在文稿，空的落在视频）。同一个视频不动。 */
  attach(videoId: Id, landing?: PanelTab): void;
  select(ids: Id[]): void;
  toggleSelect(id: Id): void;
  setWordSelection(next: WordSelection | null | ((prev: WordSelection | null) => WordSelection | null)): void;
  setPlayhead(seconds: number): void;
  setPlaying(playing: boolean): void;
  setZoom(pxPerSecond: number): void;
  /** 写入新的下限，并把当前缩放重新夹进范围（换了短视频时从长视频的极小缩放回到 ZOOM_MIN）。 */
  setZoomFloor(floor: number): void;
  setTimelineHeight(height: number): void;
  /** 打开某一页；`null` 收起面板。 */
  showPanel(tab: PanelTab | null): void;
  /** 拖动面板左边的缝：到收起线以下就收起，宽度留着下次展开用。 */
  dragPanel(width: number): void;
  /** 记下拖动中的值：同一片段同一版本的草稿叠在一起。 */
  setDraft(draft: ItemDraft): void;
  setDocumentDraft(draft: DocumentDraft): void;
  /** 丢掉草稿（提交失败时回到原值）。 */
  clearDrafts(): void;
  /** ⌥←/→ 连按攒下的时间微调（不持久化）：时间线按它画位移，停手后合成一笔提交。见 timeline-commands 的 nudgeTime。 */
  nudge: NudgeDraft | null;
  setNudge(nudge: NudgeDraft | null): void;
  /** 快捷键清单（`?`）开着。 */
  shortcutsOpen: boolean;
  setShortcutsOpen(open: boolean): void;
}

/** 还没提交（或正在提交）的时间微调：哪几件、累计挪了多少帧、按哪个视频版本算的。 */
export interface NudgeDraft {
  itemIds: Id[];
  deltaFrames: number;
  /** 视频版本：版本变了（提交落地或别人改了）就不再叠加这段位移。 */
  revision: Revision;
  /** 已经发出提交，等回执。 */
  committing: boolean;
}

export const useEditor = create<EditorStore>()(
  persist(
    (set) => ({
      videoId: null,
      selection: [],
      wordSelection: null,
      playhead: 0,
      playing: false,
      pxPerSecond: ZOOM_DEFAULT,
      zoomFloor: ZOOM_MIN,
      timelineHeight: TIMELINE_HEIGHT_DEFAULT,
      panelTab: 'video',
      panelWidth: PANEL_WIDTH_DEFAULT,
      panelHidden: false,
      draft: null,
      documentDraft: null,
      attach: (videoId, landing) =>
        set((s) =>
          s.videoId === videoId
            ? {}
            : {
                videoId,
                selection: [],
                wordSelection: null,
                playhead: 0,
                playing: false,
                draft: null,
                documentDraft: null,
                ...(landing ? { panelTab: landing } : {}),
              },
        ),
      select: (selection) => set({ selection, draft: null, documentDraft: null, ...(selection.length ? { wordSelection: null } : {}) }),
      toggleSelect: (id) =>
        set((s) => {
          const selection = s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id];
          return { selection, draft: null, documentDraft: null, ...(selection.length ? { wordSelection: null } : {}) };
        }),
      // 拖选每过一个词都会写一次：只有真有片段选中时才清，免得每次都换掉 `selection` 让时间线重画。
      setWordSelection: (next) =>
        set((s) => {
          const wordSelection = typeof next === 'function' ? next(s.wordSelection) : next;
          return wordSelection && s.selection.length
            ? { wordSelection, selection: [], draft: null, documentDraft: null }
            : { wordSelection };
        }),
      setPlayhead: (playhead) => set({ playhead: Math.max(0, playhead) }),
      setPlaying: (playing) => set({ playing }),
      setZoom: (pxPerSecond) => set((s) => ({ pxPerSecond: clampZoom(pxPerSecond, s.zoomFloor) })),
      setZoomFloor: (zoomFloor) => set((s) => ({ zoomFloor, pxPerSecond: clampZoom(s.pxPerSecond, zoomFloor) })),
      setTimelineHeight: (height) => set({ timelineHeight: Math.round(Math.max(TIMELINE_HEIGHT_MIN, height)) }),
      showPanel: (tab) => set(tab ? { panelTab: tab, panelHidden: false } : { panelHidden: true }),
      dragPanel: (width) =>
        set(
          width < PANEL_COLLAPSE_BELOW
            ? { panelHidden: true }
            : { panelWidth: Math.round(Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, width))) },
        ),
      setDraft: (draft) => set((s) => ({ draft: mergeDraft(s.draft, draft) })),
      setDocumentDraft: (documentDraft) => set({ documentDraft }),
      clearDrafts: () => set({ draft: null, documentDraft: null }),
      nudge: null,
      setNudge: (nudge) => set({ nudge }),
      shortcutsOpen: false,
      setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
    }),
    {
      name: 'baocut.editor',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        pxPerSecond: s.pxPerSecond,
        timelineHeight: s.timelineHeight,
        panelTab: s.panelTab,
        panelWidth: s.panelWidth,
        panelHidden: s.panelHidden,
      }),
    },
  ),
);
