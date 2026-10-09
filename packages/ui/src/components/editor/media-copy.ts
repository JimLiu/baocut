import { defineMessages } from '@baocut/protocol';
import type { PlaceableKind } from '../../model/editor-ops.ts';
import { zhHans } from './media-copy.zh-Hans.ts';
import { zhHant } from './media-copy.zh-Hant.ts';
import { ja } from './media-copy.ja.ts';
import { ko } from './media-copy.ko.ts';
import { es } from './media-copy.es.ts';
import { fr } from './media-copy.fr.ts';
import { de } from './media-copy.de.ts';
import { nl } from './media-copy.nl.ts';
import { ptBR } from './media-copy.pt-BR.ts';
import { it } from './media-copy.it.ts';
import { ru } from './media-copy.ru.ts';
import { pl } from './media-copy.pl.ts';
import { tr } from './media-copy.tr.ts';
import { vi } from './media-copy.vi.ts';

/** 句中用的素材类名（小写）。 */
const noun: Record<PlaceableKind, string> = { video: 'video', image: 'image', audio: 'audio' };

/** 素材面板、素材卡片菜单、预览与替换素材窗口的文案。译文在 `media-copy.zh-Hans.ts`。 */
const en = {
  kindName: (kind: PlaceableKind): string => ({ video: 'Video', image: 'Image', audio: 'Audio' })[kind],
  panelTitle: (kind: PlaceableKind): string => ({ video: 'Video', image: 'Images', audio: 'Audio' })[kind],
  undo: 'Undo',
  readOnly: 'The video is read-only',
  revealManaged: 'Collected into the video folder and managed by BaoCut; it has no separate file location',
  revealUnknown: 'Can’t find the location recorded for this file',
  uses: 'Where it’s used',
  usesNone: 'Not used on the timeline yet',
  replace: 'Replace…',
  replaceNone: 'Not used on the timeline, so there’s nothing to replace',
  collect: 'Collect into video folder',
  collectNote: 'Copies the original file into the video folder and leaves the original where it is; moving the original later has no effect',
  remove: 'Remove from video',
  removeNote: 'Assets can’t be removed from a video yet: Runtime has no operation for it',
  copied: (name: string) => `Copied ${name}`,
  copyFailed: 'Couldn’t copy. Try again.',
  collected: (name: string) => `Collected “${name}” into the video folder`,
  moreActions: (name: string) => `More actions for “${name}”`,
  preview: 'Preview',
  copyName: 'Copy file name',
  usesCount: (n: number) => `Used in ${n} ${n === 1 ? 'place' : 'places'} on the timeline`,
  usesOf: (name: string) => `Where “${name}” is used`,
  replaceOne: (kind: PlaceableKind) => `Replace this ${noun[kind]} on the timeline`,
  replaceMany: (n: number) => `Replace all ${n} together`,
  previewFailed: (error: string) => `Can’t read this asset: ${error}`,
  previewLoading: 'Getting the asset…',
  retry: 'Try again',
  close: 'Close',
  importLabel: 'Import assets',
  imported: 'Imported to the media library · not on the timeline yet',
  addClip: 'Add clip',
  addKind: (kind: PlaceableKind) => `Add ${noun[kind]}`,
  dropOrPick: (kind: PlaceableKind) => `Drop files here, or choose a local ${noun[kind]} file`,
  import: 'Import',
  existing: (kind: PlaceableKind): string => ({ video: 'Existing videos', image: 'Existing images', audio: 'Existing audio' })[kind],
  dubAnother: 'Voice-over in another language',
  dubbedGroups: (n: number) => `${n} ${n === 1 ? 'language' : 'languages'} voiced`,
  dubHintBefore: 'To have the video speak another language, open ',
  dubHintLink: 'Translated voice-over',
  dubHintAfter: '; each voiced language gets its own group here.',
  emptyLibrary: 'No files of this type in the media library yet',
  emptyHint: 'Drag files into the box above, or click “Import” to choose files.',
  foot: 'Importing only adds files to the media library and leaves them where they are (linked); to copy one into the video folder, use “Collect into video folder” in the asset’s ⋯ menu. Placing on the timeline is a separate step: click “+” to place at the playhead, or drag onto the timeline. The same asset can be used many times.',
  linked: 'Linked',
  pauseAuditionOf: (name: string) => `Pause “${name}”`,
  auditionOf: (name: string) => `Play “${name}”`,
  pauseAudition: 'Pause',
  auditionTip: 'Play this audio',
  usedTimes: (n: number) => `On the timeline · ${n} ${n === 1 ? 'place' : 'places'}`,
  unused: 'Unused',
  addToTimelineOf: (name: string) => `Add “${name}” to the timeline`,
  addToTimelineTip: 'Add to timeline (at playhead)',
  auditionFailed: (name: string, error: string) => `Couldn’t play “${name}”: ${error}`,
  auditionFailedPlain: (name: string) => `Couldn’t play “${name}”`,
  replaceKind: (kind: PlaceableKind) => `Replace ${noun[kind]}`,
  replacedOne: (kind: PlaceableKind) => `Replaced the ${noun[kind]} on the timeline`,
  replacedMany: (kind: PlaceableKind, n: number) => `Replaced the ${noun[kind]} on the timeline · ${n} clips`,
  replacingThis: 'Replacing this asset',
  replaceRule: 'Clips on the timeline that use it are replaced together: position, crop, style, and volume are kept, and the new asset plays from its start. If the new asset is shorter, the clips get shorter and later clips on the same track move up.',
  replacingClip: 'Replacing this clip',
  replaceClipRule: 'Only this clip is replaced; other clips that use the asset stay as they are. Position, crop, style, and volume are kept, and the new asset plays from its start. If the new asset is shorter, the clip gets shorter and later clips on the same track move up.',
  replaceCancelNote: 'Close the window to cancel. You can undo after confirming.',
  pickNew: (kind: PlaceableKind) => `Choose the new ${noun[kind]}`,
  sourceTabs: 'Where the new asset comes from',
  localFile: 'Local file',
  searchExisting: (kind: PlaceableKind) => `Search existing ${noun[kind]}`,
  searchExistingPlaceholder: (kind: PlaceableKind) => `Search existing ${noun[kind]}…`,
  noNameMatch: 'No assets match that name.',
  noOthers: (kind: PlaceableKind) => `There’s no other ${noun[kind]} in this video yet. Import one first, or switch to “Local file”.`,
  chooseLocal: (kind: PlaceableKind) => `Choose a local ${noun[kind]} file`,
  localNote: 'The file is added to the video’s assets and used to replace these clips on the timeline.',
  chooseAgain: 'Choose another file',
  chooseKindFile: (kind: PlaceableKind) => `Choose ${noun[kind]} file`,
  alignNote: 'Align to the original asset’s timing (another version of the same content)',
  replaceWith: (name: string) => `Replace with: ${name}`,
  noneChosen: 'No new asset chosen yet',
  pickToReplace: 'Choose an asset to replace it with.',
  usingClips: 'Clips that use it',
  locked: 'Locked',
  proxy: 'Pre-rendered stand-in for a composition',
  keepAsIs: 'Unchanged',
  cancel: 'Cancel',
  confirmReplace: 'Replace',
};

export type MediaMessages = typeof en;
export const MEDIA_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
