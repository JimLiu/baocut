import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-video.zh-Hans.ts';
import { zhHant } from './rc-video.zh-Hant.ts';
import { ja } from './rc-video.ja.ts';
import { ko } from './rc-video.ko.ts';
import { es } from './rc-video.es.ts';
import { fr } from './rc-video.fr.ts';
import { de } from './rc-video.de.ts';
import { nl } from './rc-video.nl.ts';
import { ptBR } from './rc-video.pt-BR.ts';
import { it } from './rc-video.it.ts';
import { ru } from './rc-video.ru.ts';
import { pl } from './rc-video.pl.ts';
import { tr } from './rc-video.tr.ts';
import { vi } from './rc-video.vi.ts';

/** 视频（videos/）的错误。英文是键与类型的来源，译文在 `rc-video.<语言>.ts`。 */
const en = {
  // 引擎进程（engine-host）
  engineExited: "The video engine exited, so the change may not have been committed. Retry with the same command",
  engineStartFailed: (p: { reason: string }) => `Couldn't start the video engine: ${p.reason}`,
  engineNotRunning: "The video engine isn't running",
  engineRequestFailed: (p: { method: string }) => `The engine failed to handle ${p.method}`,
  engineRestarting: 'The video engine is restarting. Retry with the same command in a moment',
  runtimeStopping: 'Runtime is stopping',
  engineNotFound: "The video engine (engine-host) wasn't found. Run npm run build:engine first",

  // 新建与打开（video-service、package-import、pipeline-targets）
  /** 写进目录名与视频名的默认名字（按新建时的语言）。 */
  defaultDirName: 'Video',
  untitledVideo: 'Untitled video',
  sourceDirNotFound: "The source folder doesn't exist",
  reservedDirOutsideSource: "The reserved folder isn't in the source folder",
  videoInUse: 'This video is open',
  videoNotOpenOpenFirst: "The video isn't open. Open it first",
  assetVersionNotFound: "The asset or this version of it doesn't exist",
  videoNotFound: "The video doesn't exist",
  onlyWorkspaceVideos: 'Only videos in the working folder can be opened',
  videoDeletedRestoreFromTrash: 'This video was deleted. Restore it from the trash first',
  dirNotVideo: "This folder isn't a video",
  linkedPreviewUnsupported: 'Only linked images, audio, video, fonts, and Lottie animations can be previewed',
  packageNotFound: "The portable package doesn't exist",
  packageNotFile: 'The portable package must be a .baocut file',
  videoInTrash: 'This video is in the trash. Restore it first',
  videoNotInSourceDir: "The video isn't in a project or session folder",
  cantCreateInSession: "This Runtime can't create videos in a session",
  targetLocationIncomplete: "The target video's location is incomplete",
  reservedDirOutsideProject: "The reserved folder isn't in this project or session folder",
  pipelinePrincipalName: 'Pipeline',

  // 回收站（video-trash）
  openElsewhere: 'This video is open in another window or connection. Close it there first',
  videoBusy: 'This video still has tasks or exports in progress. Cancel them first',
  crossDevice: "The video folder and source folder aren't on the same disk, so it can't be moved to the trash",
  videoEntryNotFound: "Can't find this video (it isn't in Space, or Space is still scanning)",
  notDeletedVideo: "This item isn't a deleted video",
  restoreRootGone: "The project or session this video was in is gone, so it can't be restored",
  trashDirGone: "The video folder in the trash is gone",
  sourceRootInTrash:
    "This video folder is a project folder or a session's working folder (or contains one), so it can't be moved to the trash",
  sourceRootRemedy:
    'In BaoCut, first remove the project or session that uses it as its folder, then delete this video from the parent project',

  // 代码画面（compositions/）：界面直接导入与预览失败；具体原因的错误码在括号里，原话在 details 里
  compositionImportFailed: (p: { code: string }) => `Couldn't import the motion graphic (${p.code})`,
  compositionPreviewFailed: (p: { code: string }) => `Couldn't preview the motion graphic (${p.code})`,
};

export type RcVideoMessages = typeof en;

export const RcVideo = defineCatalog('rcVideo', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
