import { defineMessages, intlLocale } from '@baocut/protocol';
import { zhHans } from './models-install-copy.zh-Hans.ts';
import { zhHant } from './models-install-copy.zh-Hant.ts';
import { ja } from './models-install-copy.ja.ts';
import { ko } from './models-install-copy.ko.ts';
import { es } from './models-install-copy.es.ts';
import { fr } from './models-install-copy.fr.ts';
import { de } from './models-install-copy.de.ts';
import { nl } from './models-install-copy.nl.ts';
import { ptBR } from './models-install-copy.pt-BR.ts';
import { it } from './models-install-copy.it.ts';
import { ru } from './models-install-copy.ru.ts';
import { pl } from './models-install-copy.pl.ts';
import { tr } from './models-install-copy.tr.ts';
import { vi } from './models-install-copy.vi.ts';

/** 本地模型包的安装、修复与删除的文案（英文是键与类型的来源，译文在 `models-install-copy.<语言>.ts`）。大小都已格式化。 */

const and = (items: readonly string[]) => new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(items);
const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;
const KEEP = "What's already downloaded is kept, and the next download picks up where it left off.";
const SOURCE = 'the "Model download source" in Settings › General';

const en = {
  // ---- 确认对话框 ----
  planSize: (size: string) => `Downloads ${size}`,
  planSizeEstimate: (size: string) => `About ${size} (some file sizes are unknown, so this uses the registered estimate)`,
  amountEstimate: (size: string) => `About ${size}`,
  noSpace: (need: string, have: string) =>
    `Not enough disk space: this needs ${need}, and the disk with the models folder only has ${have} left. Free up space before downloading.`,
  resumed: (size: string) => `The ${size} downloaded last time is reused, not downloaded again.`,
  space: (size: string) => `${size} free on disk`,
  lineKeep: 'Already installed, left as is',
  lineSize: (size: string, count: number) => `${size} · ${files(count)}`,
  lineUnknown: (count: number) => `Size unknown · ${files(count)}`,
  // ---- 进度 ----
  queued: 'Queued for download',
  downloading: (amount: string) => `Downloading ${amount}`,
  downloadingUnknown: (amount: string) => `Downloading · ${amount} received`,
  verifying: 'Verifying and publishing',
  pausedKept: (amount: string) => `Paused · ${amount} kept; resuming picks up where it left off`,
  paused: 'Paused',
  // ---- 失败与补救 ----
  /** 磁盘空间不够：知道数字时说出来。 */
  remedyNoSpace: (need: string | null, have: string | null) =>
    `${need !== null && have !== null ? `This needs ${need}, and only ${have} is left. ` : ''}Free up disk space, then download again. ${KEEP}`,
  remedyNetwork: `Check your network, then download again. ${KEEP} If the default source can't be reached, switch to a mirror in ${SOURCE}.`,
  remedyIntegrity: `The files from the download source didn't match the manifest's size or sha256, and the bad files were deleted. Switch to another download source (${SOURCE}), then download again.`,
  remedySource: `The download source doesn't have this file or denied access. Check that the mirror set in ${SOURCE} (or the BAOCUT_MODELS_ENDPOINT environment variable) is complete.`,
  remedyManifest: "This model package's built-in manifest is missing a trusted sha256, so it can't be installed until BaoCut is updated.",
  remedyOffline: 'Strict offline mode is on, so nothing is downloaded. To download, turn off strict offline mode in Settings first.',
  remedySizeChanged: 'The download size changed. Confirm again with the new plan.',
  remedyInUse:
    'A task is using this model package (transcribing, synthesizing, checking or installing). Wait for it to finish, or cancel it in Background tasks, then delete again.',
  remedyUnavailable:
    "The model package can't be used right now (not fully installed, turned off, or not supported on this computer). Repair it or turn it back on first.",
  remedyInstallFailed: `Try downloading again. ${KEEP}`,
  /** Runtime 的原话接上怎么办。 */
  problemText: (message: string, remedy: string) => (/[.!?。！？]$/.test(message) ? `${message} ${remedy}` : `${message}. ${remedy}`),
  // ---- 删除 ----
  /**
   * 删除确认的正文。`unknown`：不知道组件，只说删掉独有的文件；`frees`：会腾出的大小（为 null 时不说）；
   * `kept`：别的模型包还在用、会保留的组件。
   */
  removalBody: (unknown: boolean, frees: string | null, kept: readonly { repo: string; usedBy: readonly string[] }[]) =>
    [
      unknown ? 'Deletes the files only this model package uses.' : frees !== null ? `Frees about ${frees}.` : null,
      ...kept.map((k) => `${k.repo} is kept because ${and(k.usedBy)} still ${k.usedBy.length === 1 ? 'uses' : 'use'} it.`),
      "To use it again, you'll need to download it again.",
    ]
      .filter(Boolean)
      .join(' '),
  removed: (bundleId: string) => `Deleted ${bundleId}`,
  removedKept: (bundleId: string, repos: readonly string[]) =>
    `Deleted ${bundleId} · ${and(repos)} kept because other model packages still use ${repos.length === 1 ? 'it' : 'them'}`,
};

export type ModelsInstallMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
