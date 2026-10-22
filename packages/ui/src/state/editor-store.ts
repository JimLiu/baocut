import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Id, Revision } from '@baocut/protocol';
import { mergeDraft, type ItemDraft } from '../model/item-draft.ts';
import type { TemplateStudio } from '../model/template-studio.ts';
import { ZOOM_DEFAULT, ZOOM_MIN, clampZoom } from '../model/timeline-zoom.ts';
import { clampLiteZoom, rememberEditorView, resolveEditorView, type EditorView, type EditorViewDefault } from '../model/lite-segments.ts';
import { CAPTION_LAYERS_SHOWN, captionsAllHidden, type CaptionLayer, type CaptionLayersHidden } from '../model/stage-layers.ts';

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
 * 右侧面板的页：文稿、字幕、AI 工具、元素、文字、三类素材库、品牌与属性（选中片段时是片段的属性，否则是视频的）。
 * `aitools` 是 AI 工具 Tab：列表页与各工具的参数页（产品设计 §5.10），只在桌面端。
 */
export type PanelTab = 'transcript' | 'subtitle' | 'aitools' | 'elements' | 'text' | 'image' | 'video' | 'audio' | 'brand' | 'props';

/**
 * 网页宿主没有 AI 工具 Tab（原型 model-surface.js `WEB_RAIL_DROP`）：工具栏不显示它，记着的是它时落回文稿。
 * 审片页（`review`，架构设计 §12.8）也没有品牌：品牌库是跨视频的用户数据，审片会话碰不到。
 */
export function hostPanelTab(tab: PanelTab, web: boolean, review = false): PanelTab {
  return (web && tab === 'aitools') || (review && tab === 'brand') ? 'transcript' : tab;
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
  /**
   * 属性页显示模板（不持久化；视频格式规范 §3.17）：模板是序列的参数、不是片段，不进 `selection`。选中片段或换视频时清掉。
   * `templateLayer` 是在舞台或属性页上点中的那一层（只决定描边与展开哪一节）。
   */
  templateFocus: boolean;
  templateLayer: string | null;
  /** 打开模板属性页（翻到属性页、清掉片段选区）；`false` 回到视频属性。 */
  focusTemplate(on: boolean, layer?: string | null): void;
  /**
   * 版面编辑器的会话（不持久化；原型 `tplStudio`）：开着时舞台换成版面画布、右栏整个让给它。改的是草稿，「完成」才写回。
   * 打开时清掉片段选区与模板属性页；换视频时关掉（草稿丢弃）。
   */
  templateStudio: TemplateStudio | null;
  openStudio(studio: TemplateStudio): void;
  updateStudio(update: (studio: TemplateStudio) => TemplateStudio): void;
  closeStudio(): void;
  /** 元素面板要翻到的子页（「换一套」打开模板目录）：元素面板读到后清掉。 */
  elementsPage: 'template' | null;
  /** 打开元素面板的模板目录。 */
  openTemplates(): void;
  clearElementsPage(): void;
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
  /**
   * 预览在全屏播放（不持久化）：跟着浏览器的 `fullscreenchange` 走（preview.tsx），浏览器自己的 Esc 退出也算。
   * 全屏时键盘归全屏播放器，编辑器的快捷键让位。
   */
  fullscreen: boolean;
  setFullscreen(fullscreen: boolean): void;
  /**
   * 舞台下沿工具条的观看态（原型 stage.jsx `StageBar`；都不持久化，换视频时复位）：只是这个窗口怎么看，不进视频、不进撤销、
   * 不影响导出。倍速舞台与全屏播放器共用一份；字幕隐藏只管舞台（全屏有自己的四档）；平台安全区只在竖幅画布上画。
   */
  rate: number;
  setRate(rate: number): void;
  captionsHidden: boolean;
  /** 舞台隐藏 / 显示字幕：轻量视图按种类的开关一起跟着全关或全开。 */
  setCaptionsHidden(hidden: boolean): void;
  /**
   * 轻量视图的图层开关（轻量编辑器设计 §3.4；model/stage-layers）：字幕按原文 / 译文各藏没藏、配乐藏没藏。观看态，不持久化，
   * 换视频时复位。与 `captionsHidden` 保持「画面上有的字幕全藏 ⇔ captionsHidden」，时间线视图的字幕钮与全屏的字幕档位照旧。
   * `present` 是这部视频画面上有的字幕种类（model/stage-layers 的 `layerToggles`）。
   */
  captionLayersHidden: CaptionLayersHidden;
  setCaptionLayerHidden(kind: CaptionLayer, hidden: boolean, present: readonly CaptionLayer[]): void;
  musicHidden: boolean;
  setMusicHidden(hidden: boolean): void;
  safeArea: boolean;
  setSafeArea(on: boolean): void;
  /**
   * 视频标注模式（产品设计 §3.2.3「视频标注」、§5.3；舞台条的「标记」钮；不持久化，换视频时退出）：开着时预览画面上盖标记层与
   * 标记工具条（markup.tsx，两种视图同一套），画面里的元素这时不能选、不能拖。关掉走 markup-store 的 `close`，还有没发的标记先问。
   */
  annotating: boolean;
  setAnnotating(on: boolean): void;
  /**
   * 编辑器之外要把播放头挪到某一秒（例如点 composer 里的一条视频标注）：写播放头并加一次计数，编辑器看到计数变了就让引擎跳过去。
   * 同一部视频开着时 `setPlayhead` 只改显示，不会让引擎跳；换视频时打开的那一刻会按播放头跳，不需要它。
   */
  seekRequests: number;
  requestSeek(seconds: number): void;
  /**
   * 编辑器视图（轻量编辑器设计 §5、§6）：`lite` 是画面加按段分格的片条与侧栏，`timeline` 是时间线。两边共用播放头、
   * 播放状态、倍速、字幕显隐与标注模式（都在这个 store 里）。`view` 本身不持久化：打开视频时由 `resolveView` 按
   * 路由 > 这部视频上次的选择（`viewByVideo`，持久化）> 全局默认（`viewDefault`，持久化）> 审片 定下来；
   * `viewResolvedFor` 记的是已经按哪部视频定过，换视频时重定。
   */
  view: EditorView;
  viewResolvedFor: Id | null;
  viewByVideo: Record<Id, EditorView>;
  viewDefault: EditorViewDefault;
  /** 用户在顶栏切换：换视图并按视频记住；切到轻量时清掉时间线的选区（轻量视图里没有可选的片段）。 */
  setView(view: EditorView): void;
  setViewDefault(preference: EditorViewDefault): void;
  resolveView(videoId: Id, input: { route: EditorView | null }): void;
  /** 轻量视图片条的缩放（观看态，不持久化，换视频时回到 1）。 */
  liteZoom: number;
  setLiteZoom(zoom: number): void;
  /** 轻量视图的侧栏（脚本与台词）收起（持久化，与时间线视图的 `panelHidden` 各记各的）。 */
  liteSideHidden: boolean;
  setLiteSideHidden(hidden: boolean): void;
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
      templateFocus: false,
      templateLayer: null,
      templateStudio: null,
      elementsPage: null,
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
                templateFocus: false,
                templateLayer: null,
                templateStudio: null,
                playhead: 0,
                playing: false,
                draft: null,
                documentDraft: null,
                rate: 1,
                captionsHidden: false,
                captionLayersHidden: CAPTION_LAYERS_SHOWN,
                musicHidden: false,
                safeArea: false,
                annotating: false,
                liteZoom: 1,
                ...(landing ? { panelTab: landing } : {}),
              },
        ),
      select: (selection) =>
        set({
          selection,
          draft: null,
          documentDraft: null,
          ...(selection.length ? { wordSelection: null, templateFocus: false, templateLayer: null } : {}),
        }),
      toggleSelect: (id) =>
        set((s) => {
          const selection = s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id];
          return {
            selection,
            draft: null,
            documentDraft: null,
            ...(selection.length ? { wordSelection: null, templateFocus: false, templateLayer: null } : {}),
          };
        }),
      focusTemplate: (on, layer = null) =>
        set(
          on
            ? {
                templateFocus: true,
                templateLayer: layer,
                selection: [],
                draft: null,
                documentDraft: null,
                panelTab: 'props',
                panelHidden: false,
              }
            : { templateFocus: false, templateLayer: null },
        ),
      openStudio: (studio) =>
        set({
          templateStudio: studio,
          templateFocus: false,
          templateLayer: null,
          selection: [],
          wordSelection: null,
          draft: null,
          documentDraft: null,
          panelHidden: false,
        }),
      updateStudio: (update) => set((s) => (s.templateStudio ? { templateStudio: update(s.templateStudio) } : {})),
      closeStudio: () => set({ templateStudio: null }),
      openTemplates: () => set({ elementsPage: 'template', panelTab: 'elements', panelHidden: false }),
      clearElementsPage: () => set({ elementsPage: null }),
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
      fullscreen: false,
      setFullscreen: (fullscreen) => set({ fullscreen }),
      rate: 1,
      setRate: (rate) => set({ rate }),
      captionsHidden: false,
      setCaptionsHidden: (captionsHidden) =>
        set({ captionsHidden, captionLayersHidden: { original: captionsHidden, translation: captionsHidden } }),
      captionLayersHidden: CAPTION_LAYERS_SHOWN,
      setCaptionLayerHidden: (kind, hidden, present) =>
        set((s) => {
          // 从「全藏」里打开一种：其余的还藏着（只露这一种）。
          const base = s.captionsHidden ? { original: true, translation: true } : s.captionLayersHidden;
          const captionLayersHidden = { ...base, [kind]: hidden };
          return { captionLayersHidden, captionsHidden: captionsAllHidden(captionLayersHidden, present) };
        }),
      musicHidden: false,
      setMusicHidden: (musicHidden) => set({ musicHidden }),
      safeArea: false,
      setSafeArea: (safeArea) => set({ safeArea }),
      annotating: false,
      setAnnotating: (annotating) => set({ annotating }),
      seekRequests: 0,
      requestSeek: (seconds) => set((s) => ({ playhead: Math.max(0, seconds), seekRequests: s.seekRequests + 1 })),
      view: 'timeline',
      viewResolvedFor: null,
      viewByVideo: {},
      viewDefault: 'auto',
      setView: (view) =>
        set((s) => ({
          view,
          ...(s.videoId ? { viewByVideo: rememberEditorView(s.viewByVideo, s.videoId, view) } : {}),
          ...(view === 'lite' ? { selection: [], wordSelection: null, draft: null, documentDraft: null } : {}),
        })),
      setViewDefault: (viewDefault) => set({ viewDefault }),
      resolveView: (videoId, input) =>
        set((s) => ({
          viewResolvedFor: videoId,
          view: resolveEditorView({
            route: input.route,
            remembered: s.viewByVideo[videoId],
            preference: s.viewDefault,
          }),
        })),
      liteZoom: 1,
      setLiteZoom: (zoom) => set({ liteZoom: clampLiteZoom(zoom) }),
      liteSideHidden: false,
      setLiteSideHidden: (liteSideHidden) => set({ liteSideHidden }),
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
        viewByVideo: s.viewByVideo,
        viewDefault: s.viewDefault,
        liteSideHidden: s.liteSideHidden,
      }),
    },
  ),
);
