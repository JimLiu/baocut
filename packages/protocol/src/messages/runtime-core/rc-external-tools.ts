import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-external-tools.zh-Hans.ts';
import { zhHant } from './rc-external-tools.zh-Hant.ts';
import { ja } from './rc-external-tools.ja.ts';
import { ko } from './rc-external-tools.ko.ts';
import { es } from './rc-external-tools.es.ts';
import { fr } from './rc-external-tools.fr.ts';
import { de } from './rc-external-tools.de.ts';
import { nl } from './rc-external-tools.nl.ts';
import { ptBR } from './rc-external-tools.pt-BR.ts';
import { it } from './rc-external-tools.it.ts';
import { ru } from './rc-external-tools.ru.ts';
import { pl } from './rc-external-tools.pl.ts';
import { tr } from './rc-external-tools.tr.ts';
import { vi } from './rc-external-tools.vi.ts';

/** 外部工具（external-tools/）的错误、状态说明与补救。英文是键与类型的来源，译文在 `rc-external-tools.<语言>.ts`。 */
const en = {
  manageOnlyInAppOrCli: 'External tools can only be managed in the desktop app or the CLI',
  videoNotOpen: "The video isn't open",

  // 能不能用（toolUseProblem）
  toolUpdating: (p: { label: string }) => `${p.label} is updating`,
  waitForUpdate: (p: { jobId: string }) => `Try again after update task ${p.jobId} finishes`,
  toolNotInstalled: (p: { label: string }) => `${p.label} isn't installed`,
  toolCannotRun: (p: { label: string; reason: string }) => `${p.label} can't run: ${p.reason}`,
  toolOutdated: (p: { label: string; reason: string }) => `${p.label} is out of date: ${p.reason}`,
  consentRevoked: (p: { label: string }) => `Consent to use ${p.label} was withdrawn`,
  consentRequired: (p: { label: string }) => `Using ${p.label} needs the user's consent first`,
  consentRemedy: (p: { name: string }) =>
    `Try again after the user consents: externalTools.consent (baocut external-tools consent ${p.name}), or consent while installing (externalTools.install with consent: true)`,

  // 指定路径、安装、更新
  notExecutable: (p: { path: string }) => `${p.path} isn't an executable file`,
  notWindowsProgram: (p: { path: string }) =>
    `${p.path} isn't a Windows program (.exe): BaoCut doesn't run external tools through a command interpreter`,
  cannotRunAs: (p: { path: string; label: string; reason: string }) => `${p.path} can't run as ${p.label}: ${p.reason}`,
  noVersion: "Couldn't read the version",
  toolInUse: (p: { label: string }) => `${p.label} is being installed or is in use by a task`,
  notDownloadedByBaocut: (p: { label: string; remedy: string }) => `BaoCut doesn't download ${p.label}: ${p.remedy}`,
  downloadNeedsConsent: (p: { label: string }) =>
    `Downloading ${p.label} needs the user's consent: confirm the source, version, size, and license first`,
  offlineStrictNoDownload: "External tools aren't downloaded in strict offline mode",
  cannotDownload: (p: { label: string; reason: string }) => `Can't download ${p.label}: ${p.reason}`,
  manifestIncompleteRemedy: (p: { label: string }) =>
    `Wait for BaoCut to update the manifest, or install ${p.label} yourself and set its path with externalTools.setPath`,
  updateManagedCopy: (p: { label: string }) => `The ${p.label} in use is a copy BaoCut downloaded, so it isn't updated through its installer`,
  updateUnknownInstall: (p: { path: string }) => `Can't tell how ${p.path} was installed`,
  updateNoRunnable: (p: { label: string }) => `No working ${p.label} was found`,
  updateManagedRemedy: 'Use externalTools.install to switch to the version in the manifest',
  updateManualRemedy: 'Update it in a terminal the way it was installed, then detect again (externalTools.detect)',
  cannotUpdateFor: (p: { label: string }) => `BaoCut can't update ${p.label} for you`,
  runInTerminalRemedy: (p: { command: string }) => `Run ${p.command} in a terminal, then detect again (externalTools.detect)`,
  confirmUpdateCommand: (p: { label: string; command: string }) => `Updating ${p.label} needs the user to confirm this command first: ${p.command}`,
  updateCommandChanged: (p: { label: string; command: string }) => `The command to update ${p.label} has changed. Confirm it again: ${p.command}`,
  offlineStrictNoUpdate: "External tools aren't updated in strict offline mode",
  unknownTool: (p: { name: string }) => `No external tool "${p.name}"`,
  notManaged: (p: { label: string; remedy: string }) => `BaoCut doesn't manage ${p.label}: ${p.remedy}`,
  endpointInvalid: "The external tool download source isn't a valid address",
  endpointBadForm:
    'The external tool download source must be a base address starting with http(s)://, without credentials, query parameters, or a fragment',

  // 探测（状态里的 reason / remedy）
  sourceEnvVar: (p: { name: string }) => `the environment variable ${p.name}`,
  sourceUserPath: 'the path you set',
  sourceManaged: 'the copy BaoCut downloaded',
  commandNotFound: (p: { command: string }) => `${p.command} not found`,
  commandNotFoundIn: (p: { where: string; command: string }) => `${p.command} not found in ${p.where}`,
  sourceNotExecutable: (p: { where: string }) => `${p.where} isn't an executable file`,
  sourceIsScript: (p: { where: string; batch: boolean }) =>
    `${p.where} points to a ${p.batch ? 'batch script' : 'script'}, not a Windows program (.exe); BaoCut doesn't run external tools through a command interpreter`,
  setExePathRemedy: (p: { command: string; canInstall: boolean }) =>
    `Set the path to ${p.command}.exe with externalTools.setPath${p.canInstall ? ', or download it with externalTools.install' : ''}`,
  belowMinVersion: (p: { version: string; min: string }) => `${p.version} is below the minimum version ${p.min}`,
  installOrUpdateRemedy: (p: { version: string; label: string }) =>
    `Download ${p.version} with externalTools.install, or update the ${p.label} on your system`,
  updateTool: (p: { label: string }) => `Update ${p.label}`,

  // 安装与更新任务
  diskFull: 'The disk filled up while writing the tool file',
  downloadedCannotRun: (p: { label: string; reason: string }) => `The downloaded ${p.label} can't run: ${p.reason}`,
  updateStopped: 'Update stopped',
  updateExited: (p: { code: string }) => `The update command exited with ${p.code}`,
  updateTimedOut: (p: { minutes: number }) => `The update command didn't finish within ${p.minutes} minutes and was stopped`,
  updateSignalled: (p: { signal: string }) => `The update command was terminated by signal ${p.signal}`,
  updateCannotStart: (p: { reason: string }) => `The update command couldn't start (${p.reason})`,
  updateFailedRemedy: (p: { command: string }) => `Check the output in the task, or run ${p.command} in a terminal and then detect again`,

  // 下载（tool-download）
  remedyNoSpace: 'The disk with the Runtime Home is out of space. Free up space, then install again',
  remedyNetwork:
    'The network is unreachable or the download was interrupted. Check the network and install again (the downloaded part resumes), or switch mirrors in "Tool download source" under Settings › General',
  remedyIntegrity:
    "The downloaded file doesn't match the manifest's size or sha256 (the source or mirror content is wrong). The bad file was deleted; switch to another download source and install again",
  remedySource:
    'The download source doesn\'t have this file or denied access. Check the mirror set in "Tool download source" under Settings › General (or the BAOCUT_TOOLS_ENDPOINT environment variable)',
  downloadFailed: (p: { file: string; reason: string }) => `Downloading ${p.file} failed: ${p.reason}`,
  integrityMismatch: (p: { file: string }) => `${p.file} doesn't match the manifest's size or sha256`,
  sourceHttpStatus: (p: { file: string; status: number }) => `The download source returned HTTP ${p.status} for ${p.file}`,
  largerThanManifest: (p: { file: string }) => `${p.file} is larger than the manifest says`,

  // 登记表（tool-manifests）
  ytDlpLicense: 'Unlicense (source); the standalone executable includes GPLv3+ components and is GPLv3+ as a whole',
  ytDlpPurpose: 'Import from link: reads the video page and downloads media and subtitles',
  ytDlpMissingRemedy:
    'Download it with externalTools.install (baocut external-tools install yt-dlp), or install it yourself and set its path with externalTools.setPath',
  ffmpegPurpose: 'Media analysis, file transcoding, exports, and merging audio and video after downloads',
  noReleaseForPlatform: (p: { platform: string }) => `No release file for this machine (${p.platform})`,
  noTrustedSha: "The built-in manifest doesn't have a trusted sha256 for this file yet, so it can't be downloaded",

  // 探测命令（tool-probe）
  probeCannotStart: (p: { error: string }) => `Can't start: ${p.error}`,
  probeTimeout: (p: { command: string; seconds: number }) => `${p.command} didn't finish within ${p.seconds} seconds`,
  probeCannotStartCode: (p: { code: string }) => `Can't start (${p.code})`,
  probeExited: (p: { code: string; detail: string }) => `Exited with ${p.code}${p.detail ? `: ${p.detail}` : ''}`,

  // 按原安装方式更新（tool-update-plan）
  pipxMissing: (p: { label: string }) => `This ${p.label} was installed with pipx, but pipx isn't on the PATH.`,
  brewMissing: (p: { label: string; brew: string }) => `This ${p.label} was installed with Homebrew, but that Homebrew's ${p.brew} can't be found.`,
  wingetMachineWide: (p: { label: string; dir: string }) =>
    `This ${p.label} was installed by winget for all users (${p.dir}) and needs administrator rights to update; BaoCut doesn't elevate for you. Open a terminal as administrator and run this command.`,
  wingetMissing: (p: { label: string }) => `This ${p.label} was installed with winget, but winget isn't on the PATH.`,
  scoopGlobal: (p: { label: string; dir: string }) =>
    `This ${p.label} is a global Scoop install (${p.dir}) and needs administrator rights to update; BaoCut doesn't elevate for you. Open a terminal as administrator and run this command.`,
  scoopMissing: (p: { label: string; script: string }) => `This ${p.label} was installed with Scoop, but Scoop itself can't be found (${p.script}).`,
  chocolateyAdmin:
    "Programs installed with Chocolatey need administrator rights to update; BaoCut doesn't elevate for you. Open a terminal as administrator and run this command.",
  pythonScriptMissing: 'The Python interpreter this entry script points to no longer exists.',
  pipAdmin: (p: { label: string; dir: string }) =>
    `This ${p.label} is installed in ${p.dir}, which needs administrator rights to change; BaoCut doesn't elevate for you. Update it the way it was installed.`,
  pythonLauncherMissing: 'The Python interpreter this entry program points to no longer exists.',
  pipAdminWin: (p: { label: string; dir: string }) =>
    `This ${p.label} is installed in ${p.dir}, which needs administrator rights to change; BaoCut doesn't elevate for you. Open a terminal as administrator and run this command.`,
  standaloneAdmin: (p: { label: string; dir: string }) =>
    `${p.dir}, where this ${p.label} is, needs administrator rights to change; BaoCut doesn't elevate for you.`,
  standaloneAdminWin: (p: { label: string; dir: string }) =>
    `${p.dir}, where this ${p.label} is, needs administrator rights to change; BaoCut doesn't elevate for you. Open a terminal as administrator and run this command.`,
};

export type RcExternalToolsMessages = typeof en;

export const RcExternalTools = defineCatalog('rcExternalTools', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
