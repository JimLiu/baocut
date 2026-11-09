import { defineMessages } from '@baocut/protocol';
import { zhHans } from './doctor-copy.zh-Hans.ts';
import { zhHant } from './doctor-copy.zh-Hant.ts';
import { ja } from './doctor-copy.ja.ts';
import { ko } from './doctor-copy.ko.ts';
import { es } from './doctor-copy.es.ts';
import { fr } from './doctor-copy.fr.ts';
import { de } from './doctor-copy.de.ts';
import { nl } from './doctor-copy.nl.ts';
import { ptBR } from './doctor-copy.pt-BR.ts';
import { it } from './doctor-copy.it.ts';
import { ru } from './doctor-copy.ru.ts';
import { pl } from './doctor-copy.pl.ts';
import { tr } from './doctor-copy.tr.ts';
import { vi } from './doctor-copy.vi.ts';

/** `baocut doctor` 的文字（CLI 独立使用与发布 §8.1；英文是键与类型的来源，译文在 `doctor-copy.<语言>.ts`）。 */
const en = {
  help: [
    'baocut doctor',
    '',
    'Why BaoCut does not start or cannot read something: which baocut terminals find, which Runtime the CLI would',
    'start and with which home, whether the credential store answers, and Full Disk Access on macOS. Each check is',
    'ok, warn, fail or skip, with a remedy command where there is one; next is the remedy of the first problem.',
    'Read-only: never starts a Runtime and never reads a key (the keychain check only asks whether a made-up key',
    'exists). Ask the user before running the remedies.',
    'From a repository checkout it also runs the Runtime self-check, which starts each native program once and compares',
    'the builds with the source.',
    '',
    'Flags: --json',
  ].join('\n'),
  checkName: {
    entry: 'Command line',
    runtime: 'Runtime',
    credentials: 'Credentials',
    fullDiskAccess: 'Full Disk Access',
    build: 'Build',
  } as Record<'entry' | 'runtime' | 'credentials' | 'fullDiskAccess' | 'build', string>,
  remedyLabel: 'fix',

  // 入口
  entryApp: (found: string, version: string | null) =>
    `Terminals run ${found}, the command line of the BaoCut app${version ? ` ${version}` : ''}`,
  entryOtherApp: (found: string, target: string, app: string) =>
    `Terminals run ${found} (${target}), not the command line of the BaoCut app at ${app}`,
  entryNoApp: (found: string, target: string) => `Terminals run ${found} (${target}); no BaoCut app was found`,
  entryMissing: "Terminals can't find baocut. Install it from the BaoCut app (no administrator rights needed).",
  entryMissingNoApp: "Terminals can't find baocut, and no BaoCut app was found in the usual places",
  entryStandalone: (found: string, version: string) =>
    `Terminals run ${found}, the standalone BaoCut command line package ${version}`,
  entryOtherStandalone: (found: string, target: string, own: string) =>
    `Terminals run ${found} (${target}), not a standalone BaoCut command line package such as ${own}`,
  entryMissingStandalone: "Terminals can't find baocut. Install this command line package with cli install (no administrator rights needed).",

  // Runtime
  runtimeRunning: (version: string, pid: number, by: 'app' | 'cli') =>
    `Running: version ${version}, process ${pid}, started by ${by === 'cli' ? 'the command line' : 'the BaoCut app'}`,
  runtimeStopped: (entry: string) => `Not running. The next command starts it in the background with ${entry}`,
  runtimeUnreachable: (pid: number, reason: string) => `A Runtime is running (process ${pid}) but doesn't answer: ${reason}`,
  runtimeNoLaunch:
    "Not running, and there's no Runtime to start: install the BaoCut app, run from the repository, or set BAOCUT_RUNTIME_ENTRY to the Runtime entry.",

  // 凭据
  credentialsFile: (file: string) => `This build keeps keys in a file: ${file}`,
  credentialsKeychain: (platform: string): string =>
    platform === 'win32' ? 'Windows Credential Manager answers' : 'The macOS keychain answers',
  credentialsDenied:
    'The keychain refused access. Over SSH or without a desktop login macOS can keep it locked: run baocut in a terminal on the desktop, or unlock the login keychain.',
  credentialsNoHelper: (file: string | null) =>
    `The credential helper is missing${file ? ` (${file})` : ''}, so keys can't be read. Reinstall the BaoCut app.`,
  credentialsUnavailable: (reason: string) => `The credential store could not be reached: ${reason}`,
  credentialsUnknown: 'BAOCUT_RUNTIME_ENTRY decides where keys are kept; not checked',
  credentialsTimedOut: (seconds: number) => `the helper did not answer within ${seconds} s`,

  // 完全磁盘访问
  fdaGranted: 'Full Disk Access is on',
  fdaMissingApp:
    'Full Disk Access is off for BaoCut.app, so files in protected places (Desktop, Documents, Downloads, other drives) may be unreadable. Turn on BaoCut in System Settings › Privacy & Security › Full Disk Access, then run baocut doctor again.',
  fdaMissingCli: (app: string | null) =>
    `Full Disk Access is off for the Runtime the command line started; macOS counts it against ${app ?? 'the app that ran the command (your terminal, or the app hosting the agent)'}. Turn that app on in System Settings › Privacy & Security › Full Disk Access and reopen it, or stop this Runtime (baocut runtime stop) and open the BaoCut app; then run baocut doctor again.`,
  fdaMissingOwn: (app: string) =>
    `Full Disk Access is off for the Runtime the command line started. It runs on its own as ${app}, so macOS counts it against ${app}, not your terminal: turn on ${app} in System Settings › Privacy & Security › Full Disk Access, stop this Runtime (baocut runtime stop), then run baocut doctor again.`,
  fdaNotRunning: 'Checked while a Runtime is running',
  // 构建（开发态）
  buildOk: (count: number) => `The native programs start, and the ${count} builds match the source`,
  buildNotSource: 'Checked when the Runtime runs from a repository checkout',
  buildFailed: (reason: string) => `The Runtime self-check didn't finish: ${reason}`,
  buildTimedOut: (seconds: number) => `no answer within ${seconds} s`,
  buildProblems: (count: number, first: string) =>
    count === 1 ? `The Runtime self-check found a problem: ${first}` : `The Runtime self-check found ${count} problems, first: ${first}`,
  buildMore: (first: string, more: number) => `${first} (${more} more)`,
};

export type DoctorMessages = typeof en;

export const D = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
