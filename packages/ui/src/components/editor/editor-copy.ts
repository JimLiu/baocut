import { defineMessages } from '@baocut/protocol';
import { zhHans } from './editor-copy.zh-Hans.ts';
import { zhHant } from './editor-copy.zh-Hant.ts';
import { ja } from './editor-copy.ja.ts';
import { ko } from './editor-copy.ko.ts';
import { es } from './editor-copy.es.ts';
import { fr } from './editor-copy.fr.ts';
import { de } from './editor-copy.de.ts';
import { nl } from './editor-copy.nl.ts';
import { ptBR } from './editor-copy.pt-BR.ts';
import { it } from './editor-copy.it.ts';
import { ru } from './editor-copy.ru.ts';
import { pl } from './editor-copy.pl.ts';
import { tr } from './editor-copy.tr.ts';
import { vi } from './editor-copy.vi.ts';

/** 编辑器外框（时间线、走带条、预览、打开状态）与几处通用句式的文案。译文在 `editor-copy.zh-Hans.ts`。 */
const en = {
  withNote: (label: string, note: string) => `${label} (${note})`,
  labeled: (label: string, value: string) => `${label}: ${value}`,
  thenNext: (message: string, next: string) => `${message}. ${next}`,
  gap: ' ',
  undo: 'Undo',
  redo: 'Redo',
  cancel: 'Cancel',
  retry: 'Try again',
  addClip: 'Add clip',
  editor: 'Editor',
  notEditableNow: 'The video can’t be edited right now',
  timeline: 'Timeline',
  moveClips: 'Move clips',
  moveTrack: 'Move track',
  importAndAdd: 'Import and add assets',
  seconds2: (seconds: number) => `${seconds.toFixed(2)}s`,
  emptyTimeline: 'Drag assets here, or add them from the panel on the right',
  hideTrack: (label: string) => `Hide ${label}: not shown in the preview`,
  showTrack: (label: string) => `Show ${label}`,
  hideTrackLabel: 'Hide track',
  showTrackLabel: 'Show track',
  unmuteTrack: (label: string) => `Unmute ${label}`,
  muteTrack: (label: string) => `Mute ${label}`,
  unmuteTrackLabel: 'Unmute',
  muteTrackLabel: 'Mute track',
  unlockTrack: (label: string) => `Unlock ${label}`,
  lockTrack: (label: string) => `Lock ${label}: clips on it can’t be moved, trimmed, or deleted`,
  unlockTrackLabel: 'Unlock track',
  lockTrackLabel: 'Lock track',
  playTip: { play: 'Play · Space', pause: 'Pause · Space', replay: 'Replay' },
  playLabel: { play: 'Play', pause: 'Pause', replay: 'Replay' },
  undoTip: (label: string, keys: string) => `Undo “${label}” ${keys}`,
  redoTip: (label: string, keys: string) => `Redo “${label}” ${keys}`,
  nothingToUndo: 'Nothing to undo',
  nothingToRedo: 'Nothing to redo',
  splitTip: 'Split at playhead · S',
  split: 'Split',
  splitClips: 'Split clip',
  deleteTip: 'Delete selection · Delete',
  deleteSelected: 'Delete selection',
  playhead: 'Playhead position',
  totalLength: (duration: string) => `Total length ${duration}`,
  editFailed: (message: string) => `Couldn’t make the change: ${message}`,
  cantOpen: 'Can’t open this video',
  openingAria: 'Opening video',
  opening: 'Opening video…',
  resizeTimeline: 'Resize timeline',
  workingDraft: 'Working draft',
  previewCanvas: 'Preview',
  previewFailed: 'The preview can’t be drawn',
  emptyDrag: 'Drag assets onto the timeline',
  emptyOr: 'or add them from the media panel on the right',
  problemsCount: (n: number) => `${n} ${n === 1 ? 'item' : 'items'} can’t be drawn`,
  problemsTitle: 'Some content in this frame can’t be drawn',
  rendererFailed: (message: string) => `The preview renderer didn’t load: ${message}`,
  spectrumTooLarge: (itemId: string, assetId: string, mb: number) =>
    `Waveform ${itemId}: asset ${assetId} is over ${mb} MB, so the preview doesn’t analyze its sound; export is unaffected`,
  /** 预览载入与卡住（产品设计 §5.1）：舞台上的载入态与卡住提示，`media` 等点名素材、字幕文档或字体族。 */
  stall: {
    loading: 'Loading preview',
    title: 'Preview is stuck',
    engine: 'Preview engine still loading',
    video: 'Still preparing this video',
    media: (name: string) => `Waiting for media: ${name}`,
    mediaUnnamed: 'Waiting for media',
    preparing: 'Preparing preview',
    converting: (name: string) => `Converting so it can play: ${name}`,
    convertingUnnamed: 'Converting media so it can play',
    once: 'This happens only the first time it opens. Your original file isn’t changed.',
    prepare: (name: string) => `Media conversion isn’t progressing: ${name}`,
    prepareUnnamed: 'Media conversion isn’t progressing',
    captions: (name: string) => `Waiting for captions: ${name}`,
    captionsUnnamed: 'Waiting for captions',
    fonts: (name: string) => `Waiting for fonts: ${name}`,
    paint: 'The picture stopped updating',
    body: (seconds: number) => `Waited ${seconds} s. Trying again reloads only the preview; your video isn’t changed.`,
  },
};

export type EditorMessages = typeof en;
export const EDITOR_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
