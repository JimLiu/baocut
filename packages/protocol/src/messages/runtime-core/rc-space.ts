import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-space.zh-Hans.ts';
import { zhHant } from './rc-space.zh-Hant.ts';
import { ja } from './rc-space.ja.ts';
import { ko } from './rc-space.ko.ts';
import { es } from './rc-space.es.ts';
import { fr } from './rc-space.fr.ts';
import { de } from './rc-space.de.ts';
import { nl } from './rc-space.nl.ts';
import { ptBR } from './rc-space.pt-BR.ts';
import { it } from './rc-space.it.ts';
import { ru } from './rc-space.ru.ts';
import { pl } from './rc-space.pl.ts';
import { tr } from './rc-space.tr.ts';
import { vi } from './rc-space.vi.ts';

/** Space（space-catalog、space/）的错误与说明。英文是键与类型的来源，译文在 `rc-space.<语言>.ts`。 */
const en = {
  // 扫描没有列全（SpaceScanIssue.detail）
  dirUnreadable: (p: { code: string }) => `Couldn't read the folder (${p.code})`,
  tooManyDirEntries: (p: { max: number }) => `More than ${p.max} folder items; only some are listed`,
  tooManyFiles: (p: { max: number }) => `More than ${p.max} files; only some are listed`,

  // 条目
  entryGone: 'This item is no longer in Space',
  trashVideoUseDelete: 'To delete a video, use videos.delete',
  restoreVideoUseRestore: 'To restore a deleted video, use videos.restore',
  videoDeletedRestoreFirst: 'This video was deleted. Restore it first',
  videoDeleted: 'This video was deleted',
  notInSourceDir: "This item isn't in a project or session folder",
  stillGeneratingNoFile: 'Still generating; there is no file yet',
  noReadableFile: 'This item has no readable file',
  entryStillGeneratingNoFile: 'This item is still generating; there is no file yet',
  entryInTrash: 'This item is in the trash. Restore it first',
  entryKindNotAccepted: (p: { kind: string }) => `A ${p.kind} item can't be used here`,
  notVideo: "This item isn't a video",

  // 登记（space.import）
  projectNotFound: "The project doesn't exist",
  needAbsolutePath: 'Give the absolute path of the file',
  fileNotFound: "The file doesn't exist",
  unrecognizedFileType:
    "Can't tell this file's type. Only video, image, audio, subtitle, and document files can be added",
  projectDirNotFound: "The project folder doesn't exist",
  hiddenDirFile: "Files in hidden or dependency folders can't be added",
  videoDirFile: "Files in a video folder belong to the video and can't be added on their own",
  tooManySameName: "Too many files with the same name in the project's imports/",

  // 物理删除（space.purge）
  purgeVideoDeleteFirst:
    'Delete the video first (videos.delete) to move it to the trash, then delete it permanently from the trash',
  purgeTaskRunning: 'The task is still running. Cancel it first (jobs.cancel)',
  purgeNotTrashed: 'Move it to the trash first, then delete it from the trash',
  videoSourceGone: "This video's source is gone",
  refRunningTaskUsesVideo: (p: { jobId: string }) => `Task ${p.jobId} in progress is using this video`,
  refTaskAwaitsDecision: (p: { jobId: string }) =>
    `Task ${p.jobId} has results waiting for you to decide whether to add them to this video`,
  /** `names` 是最多 3 个文件名，用 `/` 分隔（文件名里不会有 `/`）；`total` 是总数。 */
  refStrayFiles: (p: { names: string; total: number }) =>
    `The video folder has files the video doesn't manage (${new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(p.names.split('/'))}${p.total > 3 ? `, ${p.total} in total` : ''}). Restore the video and move them out before deleting`,
  refRunningTaskUsesOutput: (p: { jobId: string }) => `Task ${p.jobId} in progress is using this output`,
  refVideoUnreadable: (p: { dir: string }) =>
    `Video ${p.dir} can't be read right now (or its index is still updating), so it can't be confirmed that it doesn't use this file`,
  refVideoAssetLinks: (p: { video: string; asset: string }) => `Asset "${p.asset}" in video "${p.video}" links to this file`,

  // 派生的条目（statusDetail.reason 与名字）
  importedFileGone: 'The added file is no longer in the project folder',
  resultNotApplied: "The result wasn't applied to the video",
  taskNotFinished: "The task didn't finish",
  outputFileGone: 'The output file is gone',
  exportedFileGone: 'The exported file is gone',
  labelSynthesizeSpeech: 'Synthesized speech',
  labelGenerateImage: 'Generated image',
  labelGenerateText: 'Generated text',
  labelExport: 'Export',

  // 内容索引、继续、素材
  engineUnavailable: 'The video engine is unavailable',
  continueFromTrash: "Items in the trash can't be continued. Restore it first",
  conversationCantSee:
    "This session can't see this item. Items that belong to a project must go into a session in the same project",
  serviceUsesMcp: 'External services access Space through MCP tools',
  materialTextOnly: (p: { fileName: string }) =>
    `Only text from .txt and .md documents and .srt and .vtt subtitles can be read: ${p.fileName}`,
  materialTooLarge: (p: { fileName: string; bytes: number; limit: number }) =>
    `${p.fileName} is ${p.bytes} bytes, over the material limit of ${p.limit}`,
  afterMaterial: (p: { reason: string }) => `After adding the material: ${p.reason}`,
  invalidParams: 'Invalid parameters',
};

export type RcSpaceMessages = typeof en;

export const RcSpace = defineCatalog('rcSpace', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
