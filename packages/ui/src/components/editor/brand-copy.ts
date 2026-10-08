import { defineMessages } from '@baocut/protocol';
import { zhHans } from './brand-copy.zh-Hans.ts';
import { zhHant } from './brand-copy.zh-Hant.ts';
import { ja } from './brand-copy.ja.ts';
import { ko } from './brand-copy.ko.ts';
import { es } from './brand-copy.es.ts';
import { fr } from './brand-copy.fr.ts';
import { de } from './brand-copy.de.ts';
import { nl } from './brand-copy.nl.ts';
import { ptBR } from './brand-copy.pt-BR.ts';
import { it } from './brand-copy.it.ts';
import { ru } from './brand-copy.ru.ts';
import { pl } from './brand-copy.pl.ts';
import { tr } from './brand-copy.tr.ts';
import { vi } from './brand-copy.vi.ts';

/** 品牌面板（品牌库的各节、行操作、新建品牌色、取色面板里的品牌色）的文案。译文在 `brand-copy.zh-Hans.ts`。 */
const en = {
  importFilter: 'Files the brand kit accepts',
  videoNotReady: 'The video isn’t ready yet, so it can’t be changed now',
  noStylableCaptions: 'This video has no subtitles whose style can be changed',
  importTitle: 'Import to Brand kit',
  import: 'Import',
  brand: 'Brand',
  imported: (section: string, name: string) => `Imported to Brand kit › ${section}: ${name}`,
  notBrandGlossary: (file: string) => `${file} isn’t a brand asset; saved to Glossary`,
  notBrandVoice: (file: string) => `${file} isn’t a brand asset; saved to Voices`,
  importFailed: (file: string, message: string) => `Couldn’t import ${file}: ${message}`,
  addSection: (section: string) => `Add ${section}`,
  add: 'Add',
  addFailed: (file: string, message: string) => `Couldn’t add ${file}: ${message}`,
  addedCount: (section: string, count: number) => `Added to Brand kit › ${section} · ${count}`,
  untitled: 'Untitled',
  addedOne: (section: string, name: string) => `Added to Brand kit › ${section}: ${name}`,
  actionSaveToBrand: 'save to the brand kit',
  saveProblem: (problem: string) => `Couldn’t save to the brand kit: ${problem}`,
  captionStyle: 'Subtitle style',
  captionStyleName: (video: string) => `${video} · Subtitle style`,
  savedStyle: (name: string) => `Saved to Brand kit › Subtitle styles: ${name}`,
  actionSaveStyle: 'save the subtitle style',
  addedColor: (name: string) => `Added to brand colors: ${name}`,
  actionAddColor: 'add the brand color',
  actionRename: 'rename',
  removed: (name: string) => `Deleted “${name}” from Brand kit`,
  actionDelete: 'delete',
  copied: (value: string) => `Copied ${value}`,
  copyFailed: (message: string) => `Couldn’t copy: ${message}`,
  noFilePicker: 'Files can’t be picked here; add and import from your computer in the desktop app.',
  loadingLibrary: 'Loading brand kit',
  loadingLibraryEllipsis: 'Loading brand kit…',
  new: 'New',
  entryCount: (count: number) => `${count}`,
  styleStillDefault: 'Subtitles still use the default style: change the subtitle style once in the inspector, then come back to save it.',
  noCaptionsToSave: 'This video has no subtitles yet, so there’s no current style to save.',
  rename: 'Rename',
  name: 'Name',
  save: 'Save',
  deleteTitle: (name: string) => `Delete “${name}” from Brand kit?`,
  delete: 'Delete',
  cancel: 'Cancel',
  deleteBody: 'Other videos won’t be able to use it after it’s deleted. Copies already placed in videos aren’t affected.',
  localFiles: 'Files on this computer',
  localFilesEllipsis: 'Files on this computer…',
  noFilePickerShort: 'Files can’t be picked here',
  videoAssets: 'Assets in this video',
  none: 'None',
  noAssetsOfKind: 'This video has no assets of this kind',
  saveCurrentStyle: 'Save current style',
  whichStyle: 'Subtitle style to save',
  styleUses: (count: number) => `Used by ${count} subtitles`,
  applyToCaptions: 'Apply to this video’s subtitles',
  placeOnCanvas: 'Place on canvas (at playhead)',
  placeOnTimeline: 'Place on timeline (at playhead)',
  copyToAssets: 'Copy to this video’s assets',
  unreadable: (error: string) => `Can’t read: ${error}`,
  loading: 'Loading…',
  actionsFor: (name: string) => `Actions for “${name}”`,
  copyValue: 'Copy color value',
  renameEllipsis: 'Rename…',
  deleteFromLibrary: 'Delete from Brand kit',
  deleteFromLibraryEllipsis: 'Delete from Brand kit…',
  actionPlace: (name: string) => `place “${name}” in the video`,
  appliedToCaptions: (name: string, count: number) => `Applied “${name}” to ${count} subtitles`,
  copiedNoCaptions: (name: string) => `Copied “${name}” into this video; no subtitles use it yet`,
  copiedToAssets: (name: string) => `Copied to this video’s assets: ${name}`,
  copiedNotPlaced: (name: string) => `Copied to assets but not placed on the timeline yet: ${name}`,
  elementsTrack: 'Elements',
  copiedNotPlaceable: (name: string) => `Copied to assets; this kind of file can’t go straight onto the timeline: ${name}`,
  addLabel: (name: string) => `Add ${name}`,
  placedAtPlayhead: (name: string) => `Placed on timeline at playhead: ${name}`,
  newBrandColor: 'New Brand Color',
  namePlaceholder: 'e.g. Primary',
  color: 'Color',
  colorValue: 'Value',
  colorValueError: 'Use #RRGGBB, or #RRGGBBAA with opacity',
  savedToColors: (value: string) => `Saved to brand colors: ${value}`,
  actionSaveToColors: 'save to brand colors',
  brandColors: 'Brand colors',
  inBrandColors: 'Already in brand colors',
  saveToColors: 'Save to brand colors',
  commonColors: 'Common colors',
};

export type BrandMessages = typeof en;
export const BRAND_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
