import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './runtime-storage-credentials.zh-Hans.ts';
import { zhHant } from './runtime-storage-credentials.zh-Hant.ts';
import { ja } from './runtime-storage-credentials.ja.ts';
import { ko } from './runtime-storage-credentials.ko.ts';
import { es } from './runtime-storage-credentials.es.ts';
import { fr } from './runtime-storage-credentials.fr.ts';
import { de } from './runtime-storage-credentials.de.ts';
import { nl } from './runtime-storage-credentials.nl.ts';
import { ptBR } from './runtime-storage-credentials.pt-BR.ts';
import { it } from './runtime-storage-credentials.it.ts';
import { ru } from './runtime-storage-credentials.ru.ts';
import { pl } from './runtime-storage-credentials.pl.ts';
import { tr } from './runtime-storage-credentials.tr.ts';
import { vi } from './runtime-storage-credentials.vi.ts';

/** 凭据存储（系统的安全存储、凭据文件、凭据助手）的错误说明（`packages/runtime-storage`）。 */
const en = {
  denied: 'Access denied',
  unavailable: 'The credential store is unavailable',
  unsupported: "This platform doesn't support the system's secure storage",
  internal: 'Error reading or writing the credential',
  problem: (p: { reason: string; message: string }) => `${p.reason}: ${p.message}`,
  fileWriteFailed: (p: { code: string }) => `Couldn't write the credential file (${p.code})`,
  helperBadResponse: 'The credential helper returned an invalid response',
  helperNotFound: "The credential helper program wasn't found",
  helperTimedOut: (p: { seconds: number }) => `The credential helper didn't respond within ${p.seconds} seconds`,
  helperMissing: 'The credential helper program is missing',
  helperStartFailed: (p: { code: string }) => `The credential helper couldn't start (${p.code})`,
  helperResponseTooLong: "The credential helper's response is too long",
  helperExitedSilently: 'The credential helper exited without responding',
  helperReportedError: 'The credential helper reported an error',
  redacted: '[redacted]',
};

export type RuntimeStorageCredentialsMessages = typeof en;

export const RuntimeStorageCredentials = defineCatalog('runtimeStorageCredentials', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
