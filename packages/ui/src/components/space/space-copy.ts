import { defineMessages } from '@baocut/protocol';
import { revealLabel } from '../../copy.ts';
import { zhHans } from './space-copy.zh-Hans.ts';
import { zhHant } from './space-copy.zh-Hant.ts';
import { ja } from './space-copy.ja.ts';
import { ko } from './space-copy.ko.ts';
import { es } from './space-copy.es.ts';
import { fr } from './space-copy.fr.ts';
import { de } from './space-copy.de.ts';
import { nl } from './space-copy.nl.ts';
import { ptBR } from './space-copy.pt-BR.ts';
import { it } from './space-copy.it.ts';
import { ru } from './space-copy.ru.ts';
import { pl } from './space-copy.pl.ts';
import { tr } from './space-copy.tr.ts';
import { vi } from './space-copy.vi.ts';

/** 英文的「n 个某物」：只分单复数。 */
const count = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;

/**
 * Space 页的文案（产品设计 §4；原型 page-space.jsx、space-list.jsx、space-viewer.jsx）。英文是键与类型的来源，
 * 译文在 `space-copy.<语言>.ts`。做不了的动作写一句真实原因，原因本身在 model/space-actions.ts。
 */
const en = {
  searchPlaceholder: "Search names, files, or what's said in videos",
  searchLabel: 'Search Space',

  // 列表与菜单
  openVideo: 'Open video',
  viewInfo: 'View info',
  /** 视频条目的转录动作（产品设计 §4.4）：没转录过、转录过、上次失败。 */
  transcribe: { first: 'Transcribe…', redo: 'Re-transcribe…', retry: 'Retry transcription…' },
  info: 'Video details…',
  view: 'View',
  continue: 'Continue in session',
  favorite: 'Favorite',
  unfavorite: 'Remove from favorites',
  rename: 'Rename',
  get reveal() {
    return revealLabel();
  },
  viewTask: 'View task',
  trash: 'Move to Trash',
  restore: 'Restore from Trash',
  purge: 'Delete permanently',
  clear: 'Clear',
  columnMeasure: 'Duration or dimensions',
  columnStatus: 'Status',
  noValue: '—',
  favorited: 'Favorited',

  // 工具条
  statusPicker: 'Status',
  refreshMenu: 'Refresh',
  rescan: 'Rescan project folders',
  rescanHint: 'Read the files in every project and session folder again',
  rebuild: 'Rebuild index',
  rebuildHint: 'Discard the derived catalog and content index and rebuild them; favorites, display names, and Trash are kept',
  scanning: 'Scanning project folders',
  rebuilt: (entries: number, pending: number) =>
    pending > 0
      ? `Index rebuilt · ${count(entries, 'item', 'items')} · content index for ${count(pending, 'video', 'videos')} still updating in the background`
      : `Index rebuilt · ${count(entries, 'item', 'items')}`,

  // 新建
  newLabel: 'New',
  newBlank: 'New blank video',
  newBlankHint: 'A 16:9 blank video that opens right away, with no transcription or queue',
  newFromFile: 'New video from file',
  newFromFileHint: 'Video or audio goes to the Home composer so you can say what to do with it; images go straight onto the timeline',
  newFromPackage: 'New video from portable package',
  newFromPackageHint: 'A .baocut exported elsewhere, with all its assets inside',
  pickPackageTitle: 'Choose a portable package',
  pickPackageButton: 'Open',
  pickPackageFilter: 'BaoCut portable package',
  openPackage: 'Open as new video',
  packageBlocked: (reason: string) => `Open as new video: ${reason}`,
  packageOpening: (name: string) => `Opening "${name}"…`,
  packageOpened: (name: string) => `Opened "${name}" as a new video`,
  importAssets: 'Import assets',
  importAssetsHint: 'Register files as project assets; files outside the project are copied into its imports/',
  whichProject: 'Which project',
  noProject: 'Open a project folder in Home first',
  pickNotMedia: "That isn't a video, audio, or image file",
  createdFromFile: (name: string) => `Created video "${name}" and placed the asset`,
  createdEmpty: (reason: string) => `The video was created, but the asset wasn't placed: ${reason}`,

  // 导入框（原型 SpaceImport）
  importTitle: 'Import assets',
  importProject: 'Import to project',
  importHint:
    "Choose videos, audio, or images. Files in the project folder are registered in place; files outside it are copied into the project's imports/ and the originals stay put. Nothing is added to any video.",
  importPick: 'Choose files…',
  importNoProject: 'No projects yet: open a project folder in Home first.',
  importing: 'Importing',

  // 查看框
  factSource: 'Source',
  factFile: 'File',
  factMeasure: 'Duration or dimensions',
  factSize: 'Size',
  factStatus: 'Status',
  factActivity: 'Last activity',
  factConversation: 'Source session',
  factGenerated: 'Generated',
  factVersion: 'Version',
  factNote: 'Note',
  viewConversation: 'View source session',
  close: 'Close',
  editBlocked: (reason: string) => `Edit again: ${reason}`,
  continueBlocked: (reason: string) => `Continue in session: ${reason}`,
  version: (frozen: string, current: string | null) =>
    current && current !== frozen ? `Video version ${frozen}; the video is now ${current}` : `Video version ${frozen}`,
  missingTitle: "Can't find this file",
  // 卡片角标与列表缩略图的读屏说明（原型 sp-prev__flag）
  missingFile: 'File not found',
  missingBody: 'The item is still here. Its status recovers once the file is back.',
  failedTitle: 'Generation failed',
  failedBody: "No file was produced. See why and try again on the Tasks page, or clear it if you don't need it.",
  changedTitle: 'Source video changed since',
  changedBody: 'This result matches an earlier version of the video. It still works, but no longer reflects the current video.',
  reexport: 'Export again from the source video',
  noPreviewVideo: 'Videos open in the editor.',

  // 能力（origin.capability）
  capability: {
    synthesizeSpeech: 'Voice-over',
    generateImage: 'Generate image',
    generateText: 'Generate text',
    export: 'Export',
  } as Record<string, string>,

  // 动作的结果
  trashed: (name: string) => `Moved to Trash · ${name}`,
  undo: 'Undo',
  restored: (name: string) => `Restored · ${name}`,
  purged: (name: string) => `Permanently deleted · ${name}`,
  cleared: (name: string) => `Cleared · ${name}`,
  renamed: 'Renamed',
  continued: (created: boolean, name: string, title: string) =>
    created
      ? `Started a new session with "${name}" attached: write what to do, then send`
      : `Back in "${title}" with "${name}" attached: write what to do, then send`,
  sourceGone: "The source video isn't in any project or session folder right now, so it can't be opened",
  /** `what` 是动作的名字（如 `trash`、`rebuild`），不分大小写都能读。 */
  failed: (what: string, reason: string) => `${what} failed: ${reason}`,

  // 删除视频（产品设计 §4.9）
  trashVideoTitle: 'Delete this video?',
  trashVideoBody: "The whole video folder moves to the project's Trash and can be restored. Linked original assets stay where they are.",
  trashVideoRelated: (n: number) =>
    `${count(n, 'item', 'items')} exported or generated from it will stay in Space and won't be deleted with the video:`,
  trashVideoConfirm: 'Delete video',

  // 彻底删除
  purgeTitle: 'Delete permanently?',
  purgeBody: (name: string) =>
    `"${name}" will be deleted from disk and can't be restored. If a video or a running task still uses it, nothing is deleted and you'll see what's using it.`,
  purgeVideoBody: (name: string) =>
    `The whole folder of video "${name}" will be deleted from disk and can't be restored. Linked original assets aren't affected.`,
  purgeConfirm: 'Delete permanently',
  blockedTitle: "Can't delete yet",
  blockedBody: (name: string) => `"${name}" is still in use, so nothing was deleted:`,
  gotIt: 'Got it',

  // 改名
  renameTitle: 'Rename',
  renameLabel: 'Display name',
  renameHint: (fileName: string) =>
    `Only changes the name shown in Space; the file itself stays the same. Leave it empty to go back to "${fileName}".`,
  save: 'Save',

  // 来源视频改过（产品设计 §4.6）
  changedDialogTitle: 'The source video has changed',
  changedDialogBody: (frozen: string | null, current: string | null) =>
    `This result matches video version ${frozen ?? '(unknown)'}; the video is now ${current ?? '(unknown)'}. The current working copy will open.`,
  changedOpenCurrent: 'Open current working copy',
  changedFromFrozen: 'Continue from that version',
  changedFromFrozenReason:
    "Continuing from the version this export was made from isn't possible yet (Runtime has no command to go back to a version). You can open the current working copy and view that version in History.",

  // 内容命中（架构设计 §5.11）
  hitsTitle: 'Said in videos',
  hitsCount: (n: number) => count(n, 'match', 'matches'),
  hitsSearching: 'Searching the content index',
  hitsNone: 'Nothing said in videos matches',
  hitsError: (reason: string) => `Can't search the content index: ${reason}`,
  hitUnopenable: "This video isn't in any project or session folder right now, or it's in Trash, so it can't be opened",
  hitSourceClock: 'This is in an asset, not on the timeline: open the video and look for it',
  hitStale: 'The video changed after it was indexed, so the position may be off',
  // 内容命中的过滤与分组（设计稿 page-projects.jsx HitGroup；种类、说话人是合同 space.search 的筛选）
  hitsGrouped: (n: number, videos: number) => `${count(n, 'match', 'matches')} · ${count(videos, 'video', 'videos')}`,
  hitKind: 'Document type',
  hitKindAll: 'All types',
  hitSpeaker: 'Speaker',
  hitSpeakerAll: 'All speakers',
  hitSpeakerNone: 'None of these matches has a speaker',
  hitsNoneFiltered: 'Nothing matches this type or speaker. Try another one.',
  hitsMore: (n: number) => `Show ${n} more`,

  // 页面里的其余文字
  cancel: 'Cancel',
  openForEdit: 'Open for editing',
  newVideo: 'New video',
  revealUnavailable: "This file isn't in any project or session folder, so there's no location to show",
  sidebarLabel: 'Space categories',
  kindsHeader: 'Categories',
  mineHeader: 'Organize',
  sidebarNote: 'Space shows the videos, assets, and outputs in all your projects. The files stay in their own project folders.',
  all: 'All',
  emptyFiltered: 'No matching items',
  emptyTrash: 'Trash is empty',
  emptyFavorite: 'No favorites yet',
  emptyAll: 'No items yet',
  /** 某个类型分类（`label` 是分类名）下还没有条目。 */
  emptyCategory: (label: string) => `Nothing in ${label} yet`,
  emptyFilteredBody: 'Try other keywords, or clear the project and status filters.',
  emptyTrashBody: 'Items you move to Trash show up here. You can restore them or delete them permanently.',
  emptyBody: 'Ask the agent in a session and its outputs show up here. You can also import assets from "New", or open an existing folder in Home.',
  projectPicker: 'Project',
  allProjects: 'All projects',
  sortPicker: 'Sort',
  viewPicker: 'View',
  viewGrid: 'Grid',
  viewList: 'List',
  issuesTitle: (n: number) => (n === 1 ? "1 folder wasn't fully listed" : `${n} folders weren't fully listed`),
  issueTruncated: (detail: string) => `Too many files, only some were listed: ${detail}`,
  issueUnreadable: (detail: string) => `Can't read: ${detail}`,
  preparing: 'Getting Space ready…',
  preparingBody: 'The first time, project folders need to be scanned. This takes a moment.',
  /** 新建菜单项的说明：已经筛了项目时写明建在哪个项目里。 */
  createIn: (project: string, hint: string) => `In "${project}" · ${hint}`,
  /** 「新建空视频」等子菜单的读屏名：`label` 是菜单项的名字。 */
  whichProjectFor: (label: string) => `${label}: which project`,
  entryActions: (name: string) => `Actions for "${name}"`,
  entriesLabel: 'Space items',
  columnName: 'Name',
  columnKind: 'Type',
  columnSource: 'Source',
  columnActivity: 'Last activity',
  columnMenu: 'Actions',
  /** 删除视频时只列前几个相关条目，其余合成一行：`n` 是总数。 */
  relatedMore: (n: number) => `…${n} in total`,
  /** 导入结果的一句话（`text` 来自 model/space-actions.ts `importSummary`）后面带上项目名。 */
  importSummaryIn: (text: string, project: string) => `${text} (${project})`,
  /** 查看框「最近活动」：相对时间后面括上具体时间。 */
  activityAt: (ago: string, at: string) => `${ago} (${at})`,
  /** 把条目状态的原因放在说明前面：`reason` 是一句话，不带句末标点。 */
  withReason: (reason: string, body: string) => `${reason}. ${body}`,
};

export type SpaceMessages = typeof en;

export const SPACE_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
