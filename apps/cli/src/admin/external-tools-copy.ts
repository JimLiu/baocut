import { defineMessages, type ExternalToolStatus, type ExternalToolUpdateMethod } from '@baocut/protocol';
import { zhHans } from './external-tools-copy.zh-Hans.ts';
import { zhHant } from './external-tools-copy.zh-Hant.ts';
import { ja } from './external-tools-copy.ja.ts';
import { ko } from './external-tools-copy.ko.ts';
import { es } from './external-tools-copy.es.ts';
import { fr } from './external-tools-copy.fr.ts';
import { de } from './external-tools-copy.de.ts';
import { nl } from './external-tools-copy.nl.ts';
import { ptBR } from './external-tools-copy.pt-BR.ts';
import { it } from './external-tools-copy.it.ts';
import { ru } from './external-tools-copy.ru.ts';
import { pl } from './external-tools-copy.pl.ts';
import { tr } from './external-tools-copy.tr.ts';
import { vi } from './external-tools-copy.vi.ts';

/** `baocut external-tools …` 的文案（英文是键与类型的来源，译文在 `external-tools-copy.<语言>.ts`）。 */
const en = {
  /** `baocut external-tools --help` 与 `baocut help external-tools` 的正文。 */
  help: `Usage:
  baocut external-tools [list]     External tools (yt-dlp, ffmpeg): status, version, path,
                                   source, and whether you've agreed to use them
  baocut external-tools detect [name]
                                   Detect again
  baocut external-tools install <name> [--yes]
                                   Download a managed copy to tools/ in the Runtime Home: lists the source, version, size, and
                                   license, then downloads after confirmation and verifies sha256 (--yes means you agree).
                                   Download source: the tools.downloadEndpoint setting and the BAOCUT_TOOLS_ENDPOINT environment variable
  baocut external-tools update <name> [--yes]
                                   Update the system copy the way it was installed (Homebrew, pipx, pip, or the official
                                   standalone program): lists the full command to run, which the Runtime runs after
                                   confirmation (--yes confirms), printing the output line by line and detecting again when
                                   done. Commands that need admin rights are only printed; run them yourself in a terminal
  baocut external-tools path <name> <file>|--clear
                                   Use a copy you installed yourself (runs --version once to check it); --clear removes the override
  baocut external-tools remove <name>
                                   Delete the managed copy (system copies and overrides aren't touched)
  baocut external-tools consent <name> [--revoke]
                                   Agree to use a download tool, or withdraw consent (after which importing from links is refused)`,
  usage:
    'Usage: baocut external-tools [list] | detect [name] | install <name> [--yes] | update <name> [--yes] | path <name> <file>|--clear | remove <name> | consent <name> [--revoke]',
  clearOrFile: 'Give either --clear or a file, not both',
  stateLabels: {
    installed: 'Installed',
    missing: 'Not installed',
    outdated: 'Update available',
    unavailable: 'Unavailable',
  } satisfies Record<ExternalToolStatus['state'], string>,
  sourceLabels: {
    system: 'system PATH',
    user: 'specified path',
    managed: 'copy downloaded by BaoCut',
    env: 'environment variable',
  } satisfies Record<NonNullable<ExternalToolStatus['source']>, string>,
  updateMethodLabels: {
    homebrew: 'Homebrew',
    pipx: 'pipx',
    pip: 'pip',
    standalone: 'official standalone build',
    winget: 'winget',
    scoop: 'Scoop',
    chocolatey: 'Chocolatey',
  } satisfies Record<ExternalToolUpdateMethod, string>,
  statusHead: (name: string, state: string, version: string | null, source: string | null, purpose: string) =>
    `${name}  ${state}${version ? ` ${version}` : ''}${source ? ` (${source})` : ''}  ${purpose}`,
  pathLine: (path: string) => `  Path: ${path}`,
  userPathLine: (path: string) => `  Specified path: ${path}`,
  managedLine: (version: string, path: string) => `  Managed copy: ${version}  ${path}`,
  consentLine: (label: string) => `  Consent: ${label}`,
  installingLine: (jobId: string) => `  Installing: task ${jobId}`,
  updatingLine: (jobId: string) => `  Updating: task ${jobId}`,
  updateLine: (command: string, method: string, runnable: boolean) =>
    `  Update: ${command} (${method}${runnable ? '' : ', run it yourself in a terminal'})`,
  reasonLine: (reason: string) => `  Reason: ${reason}`,
  remedyLine: (remedy: string) => `  Fix: ${remedy}`,
  consentMissing: (name: string) => `Not given yet (consent before using it: baocut external-tools consent ${name})`,
  consentVia: { agent: "through the agent's approval", cli: 'in the CLI', app: 'in the app' },
  consentGranted: (at: string, via: string) => `Granted (${at}, ${via})`,
  consentRevoked: (at: string) => `Withdrawn (${at})`,
  noTools: 'No external tools registered',
  cannotUpdate: (label: string, reason: string) => `Can't update ${label} for you: ${reason}`,
  runInTerminal: 'Run this in a terminal:',
  redetect: (name: string) => `Then check again: baocut external-tools detect ${name}`,
  updatePlanHead: (method: string, label: string, version: string | null) =>
    `Will update ${label}${version ? ` ${version}` : ''} the way it was installed (${method})`,
  runLine: (command: string) => `  Run: ${command}`,
  updatePrompt: (label: string) => `Run this command on this computer to update ${label}? [y/N] `,
  omittedLines: (n: number) => `…(${n} ${n === 1 ? 'line' : 'lines'} omitted)`,
  updated: (label: string, before: string | null, after: string) => `Updated ${label}: ${before ?? 'unknown version'} → ${after}`,
  upToDate: (label: string, version: string | null) => `${label} is up to date${version ? ` (${version})` : ''}`,
  sizeEstimated: (size: string) => `about ${size} (size unknown, estimated)`,
  sizeAbout: (size: string) => `about ${size}`,
  willDownload: (label: string, version: string) => `Will download ${label} ${version}`,
  sourceLine: (url: string | null) => `  Source: ${url ?? '(no file available for this computer)'}`,
  sizeLine: (size: string) => `  Size: ${size}`,
  licenseLine: (license: string) => `  License: ${license}`,
  homepageLine: (url: string) => `  Homepage: ${url}`,
  sha256Line: (hash: string) => `  sha256: ${hash}`,
  blockedLine: (reason: string) => `  Can't download: ${reason}`,
  installPrompt: (label: string, version: string, size: string) => `Download and use ${label} ${version} (${size})? [y/N] `,
  noExternalTool: (name: string) => `No external tool "${name}"`,
  alreadyInstalling: (jobId: string) => `Already installing (task ${jobId}); showing progress`,
  installDone: 'Installation complete',
  notDownloadedByBaoCut: (label: string, remedy: string | null | undefined) => `BaoCut doesn't download ${label}: ${remedy ?? 'install it yourself'}`,
  cannotDownload: (label: string, reason: string | null) => `Can't download ${label}: ${reason}`,
  notTtyAgreeDownload: 'Not running in a terminal: add --yes once the user agrees to the download',
  notTtyConfirmRun: 'Not running in a terminal: add --yes once the user confirms running it',
  notDownloaded: 'Not downloaded',
  notRun: 'Not run',
  /** 任务失败后 stderr 上的补救（不缩进；状态行里缩进的是 `remedyLine`）。 */
  remedy: (remedy: string) => `To fix: ${remedy}`,
  partialDownloadKept: (name: string) => `The downloaded part is kept: run baocut external-tools install ${name} to resume`,
  alreadyUpdating: (jobId: string) => `Already updating (task ${jobId}); showing output`,
  managedCopy: (label: string, name: string) =>
    `The ${label} in use is a copy BaoCut downloaded: use baocut external-tools install ${name} to change versions`,
  unknownInstall: (file: string, name: string) =>
    `Can't tell how ${file} was installed: update it in a terminal the way it was installed, then run baocut external-tools detect ${name}`,
  noRunnableTool: (label: string, remedy: string) => `No runnable ${label} found: ${remedy}`,
  updateManual: (label: string, command: string) => `Updating ${label} has to be done yourself in a terminal: ${command}`,
  partialCommand: (name: string) =>
    `The command may have run only partly: run baocut external-tools detect ${name} to see the current version`,
};

export type ToolsMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
