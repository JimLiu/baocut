import { defineMessages } from '@baocut/protocol';
import { zhHans } from './standalone-copy.zh-Hans.ts';
import { zhHant } from './standalone-copy.zh-Hant.ts';
import { ja } from './standalone-copy.ja.ts';
import { ko } from './standalone-copy.ko.ts';
import { es } from './standalone-copy.es.ts';
import { fr } from './standalone-copy.fr.ts';
import { de } from './standalone-copy.de.ts';
import { nl } from './standalone-copy.nl.ts';
import { ptBR } from './standalone-copy.pt-BR.ts';
import { it } from './standalone-copy.it.ts';
import { ru } from './standalone-copy.ru.ts';
import { pl } from './standalone-copy.pl.ts';
import { tr } from './standalone-copy.tr.ts';
import { vi } from './standalone-copy.vi.ts';

/**
 * 独立 CLI 包的 `baocut cli install|status|remove` 与 `baocut update` 的文字（CLI 独立使用与发布 §9.3、§9.5；英文是键与类型的来源，
 * 译文在 `standalone-copy.<语言>.ts`）。与 App 共用的几行（入口、终端、PATH）在 `admin/skills-copy.ts`。
 */
const en = {
  cliHelp: `Usage:
  baocut cli install               Install this command line package for your user and put baocut on PATH. The package is
                                   copied to ~/.local/share/baocut/versions/<version> (Windows:
                                   %LOCALAPPDATA%\\BaoCut\\cli\\versions\\<version>) unless it's already there. macOS: a link
                                   at ~/.local/bin/baocut. Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd, with that folder
                                   added to your user PATH. No administrator rights needed
  baocut cli status                Where baocut is placed, which installed version it points to, and which baocut your
                                   terminal finds
  baocut cli remove                Remove what baocut cli install placed; the installed versions stay. Something at that path
                                   that BaoCut didn't put there is never replaced or deleted`,
  help: `baocut update [--check | --rollback]

Update the standalone command line package: reads the same release feed as the BaoCut app, downloads the command line
package of the newest release, checks its size and sha256 (and on macOS its signature and notarization), installs it
next to the current version and points baocut to it. The previous version stays for --rollback; older ones that no
Runtime still uses are deleted.
  --check      Only say whether a newer version is available
  --rollback   Go back to the previous version
A Runtime that's already running keeps the old version until it stops (baocut runtime stop).
Only the standalone package updates this way: the BaoCut app updates itself, Homebrew installs with brew upgrade.
Set BAOCUT_UPDATE_APPCAST to read another feed (a URL or a local file, for testing).`,
  version: (version: string, build: number) => `${version} (build ${build})`,
  state: {
    none: 'Not installed',
    current: 'Points to the current version',
    stale: 'Points to another BaoCut',
    broken: 'Points to a location that no longer exists',
    foreign: "Something else is there (left alone)",
  },
  statusPackage: (version: string, root: string) => `Package   ${version}  ${root}`,
  statusVersions: (versions: readonly string[], root: string) => `Installed ${versions.join(', ')}  ${root}`,
  statusNoVersions: (root: string) => `Installed nothing in ${root} yet: baocut cli install copies this package there`,
  currentMark: ' (current)',
  previousMark: ' (previous)',
  copied: (dest: string, from: string) => `Copied the package to ${dest}; ${from} is no longer needed`,
  versionsKept: (dir: string) => `The installed versions stay in ${dir}: delete that folder to remove them`,
  entryTaken: (path: string) =>
    `${path} isn't something BaoCut placed, so it's left alone. Move or delete it yourself, then run baocut cli install again`,
  pathFailed: (dir: string) => `Couldn't add ${dir} to your user PATH: add it in System Properties → Environment Variables`,
  copyFailed: (from: string, dest: string, detail: string) => `Couldn't copy ${from} to ${dest}${detail ? `: ${detail}` : ''}`,
  updateUsage: (token: string) => `baocut update takes --check or --rollback (one of them): ${token}`,
  updateUnavailable:
    'baocut update updates the standalone command line package. This baocut belongs to the BaoCut app, which updates itself (BaoCut → Check for Updates), or to Homebrew (brew upgrade --cask baocut)',
  upToDate: (current: string) => `Up to date: ${current}`,
  available: (latest: string, current: string) => `${latest} is available (you have ${current})`,
  downloading: (version: string, build: number, megabytes: number) => `Downloading ${version} (build ${build}), ${megabytes} MB…`,
  updated: (from: string, to: string) => `Updated ${from} → ${to}`,
  rolledBack: (from: string, to: string) => `Went back from ${from} to ${to}`,
  rollbackHint: 'To go back: baocut update --rollback',
  entrySwitched: (path: string) => `${path} now points to it`,
  entryNotInstalled: (path: string) => `${path} isn't installed: baocut cli install puts baocut on PATH`,
  entryLeftAlone: (path: string) =>
    `${path} points to something other than this package and was left alone: baocut cli install points it here`,
  removedVersions: (versions: readonly string[]) => `Deleted older versions: ${versions.join(', ')}`,
  runtimeStillRunning: (pid: number) =>
    `A Runtime (pid ${pid}) is still running the version it started with; once it stops, the next command starts the new one (baocut runtime stop stops it now)`,
  systemTooOld: (required: string, system: string) => `The new version needs macOS ${required}; this Mac has ${system}`,
  feedFailed: (url: string, detail: string) => `Couldn't read the release feed ${url}: ${detail}`,
  feedMissing: (url: string) => `The release feed ${url} has no command line package yet: try again after the next release`,
  downloadFailed: (url: string, detail: string) => `Couldn't download ${url}: ${detail}`,
  verifyFailed: (detail: string) => `The downloaded package didn't pass the checks and wasn't installed: ${detail}`,
  unsignedBuild:
    "This package isn't signed, so it can't check the signature of an update. Download the standalone package from the BaoCut releases page instead",
  noPrevious: (dir: string) => `There's no previous version to go back to in ${dir}`,
  inProgress: (pid: number) => `Another baocut update (pid ${pid}) is running: wait for it to finish`,
};

export type StandaloneMessages = typeof en;

export const S = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
