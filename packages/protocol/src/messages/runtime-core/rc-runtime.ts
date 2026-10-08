import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-runtime.zh-Hans.ts';
import { zhHant } from './rc-runtime.zh-Hant.ts';
import { ja } from './rc-runtime.ja.ts';
import { ko } from './rc-runtime.ko.ts';
import { es } from './rc-runtime.es.ts';
import { fr } from './rc-runtime.fr.ts';
import { de } from './rc-runtime.de.ts';
import { nl } from './rc-runtime.nl.ts';
import { ptBR } from './rc-runtime.pt-BR.ts';
import { it } from './rc-runtime.it.ts';
import { ru } from './rc-runtime.ru.ts';
import { pl } from './rc-runtime.pl.ts';
import { tr } from './rc-runtime.tr.ts';
import { vi } from './rc-runtime.vi.ts';

/** Runtime 本体（runtime.ts、agent-setup、handlers、self-check、project-files、media 等）的错误与说明。英文是键与类型的来源，译文在 `rc-runtime.<语言>.ts`。 */
const en = {
  noSuchRun: (p: { runId: string }) => `No run ${p.runId}`,
  noLoginCommand: (p: { agent: string }) => `${p.agent} has no sign-in command`,
  installKindRequired: 'Specify how to install or upgrade (kind)',
  driverNotRegistered: (p: { driverId: string }) => `No agent engine is registered as ${p.driverId}`,
  runtimeStopping: 'Runtime is stopping',
  scriptNotRun: "Commands that download and run a script from the network don't run inside BaoCut: copy the command and run it in a terminal, or use agents.openTerminal",
  commandAlreadyRunning: (p: { agent: string }) => `${p.agent} already has a command running`,
  noInstallKind: (p: { agent: string; kind: string }) => `${p.agent} has no "${p.kind}" install option`,
  commandNotRunnable: (p: { agent: string }) => `This command for ${p.agent} can't be run`,
  projectNotFound: 'Project not found',
  newVideoNeedsTarget: 'Specify a project or session for the new video',
  attachmentNotFound: 'Attachment not found',
  outputNotFound: 'Output not found',
  settingManaged: (p: { key: string; method: string }) => `Change the ${p.key} setting with ${p.method}`,
  assetHashInvalid: "The asset's content hash is malformed",
  assetHasNoPicture: 'The asset has no picture',
  onlyAudioVideoAnalyzable: 'Only audio and video assets can be analyzed',
  noFramesForFileType: "Frames aren't extracted from this kind of file",
  thumbnailTooLarge: 'The thumbnail is too large',
  noFrameAtTime: 'No frame is available at this time',
  ffmpegTimeout: 'ffmpeg timed out',
  ffmpegMissing: "ffmpeg wasn't found: install it, then restart BaoCut",
  ffmpegCannotRun: (p: { reason: string }) => `Can't run ffmpeg: ${p.reason}`,
  ffmpegCannotRead: "ffmpeg can't read this asset",
  cachedThumbnailBroken: 'The cached thumbnail is corrupt',
  fileNotFound: 'File not found',
  onlyWorkingFolderFiles: 'Only files in the working folder can be opened',
  notAFile: 'Not a file',
  folderPathInvalid: 'Invalid folder path',
  folderPathMustBeRelative: 'Use a folder path relative to the project folder',
  folderOutsideProject: "The folder isn't in the project",
  folderNotBrowsable: "This folder can't be browsed",
  folderNotFound: 'Folder not found',
  notAFolder: 'Not a folder',
  folderUnreadable: "Can't read this folder",
  projectFolderNotFound: 'Project folder not found',
  alreadyRunning: (p: { pid: number }) => `Runtime is already running (pid ${p.pid})`,
  harnessNotReady: "Harness isn't ready yet",
  spaceNotReady: "The Space catalog isn't ready yet",
  externalToolsNotReady: "The external tools service isn't ready yet",
  externalToolNotRegistered: (p: { name: string }) => `External tool ${p.name} isn't registered`,
  offlineStrictNoDownload: "Strict offline mode doesn't download from links",
  offlineStrictRemedy: 'Download the video in your browser first, then choose the local file; or turn off strict offline in Settings',
  noSuchTool: (p: { toolId: string }) => `No such tool: ${p.toolId}`,

  // runtime.status / runtime.stop（handlers）
  statusLocalOnly: 'Runtime status is only available to the local CLI and the desktop app',
  stopCliOnly: 'Only the CLI can ask Runtime to stop',
  stopNotCliLaunched: "This Runtime wasn't started by the CLI (the desktop app started it, or it was started manually), so the CLI doesn't stop it",
  runtimeInUse: (p: { desktop: number; cli: number; activeJobs: number }) =>
    `This Runtime is still in use (desktop app: ${p.desktop}, other CLI connections: ${p.cli}, unfinished tasks: ${p.activeJobs}). Wait for them to finish or close them, then stop it`,
  stopNotSupported: "This Runtime can't be stopped through the gateway",

  // legacyImport.answer（旧版项目的导入询问，architecture-design §2.7）
  legacyPromptGone: "This import question has already been answered or is no longer open",
  legacyImportFolderReserved: "Choose a folder outside the data folders of BaoCut and its earlier versions",
  legacyImportFolderUnwritable: "Can't create or write to this folder",
  legacyImportLocalOnly: "Only the desktop app and the local CLI can answer the question about importing earlier projects",
};

export type RcRuntimeMessages = typeof en;

export const RcRuntime = defineCatalog('rcRuntime', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
