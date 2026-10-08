import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './drivers-common.zh-Hans.ts';
import { zhHant } from './drivers-common.zh-Hant.ts';
import { ja } from './drivers-common.ja.ts';
import { ko } from './drivers-common.ko.ts';
import { es } from './drivers-common.es.ts';
import { fr } from './drivers-common.fr.ts';
import { de } from './drivers-common.de.ts';
import { nl } from './drivers-common.nl.ts';
import { ptBR } from './drivers-common.pt-BR.ts';
import { it } from './drivers-common.it.ts';
import { ru } from './drivers-common.ru.ts';
import { pl } from './drivers-common.pl.ts';
import { tr } from './drivers-common.tr.ts';
import { vi } from './drivers-common.vi.ts';

/** 各家 Driver 共用的句子：探测结果（没装、版本太旧）与会话里的通用错误、提示。 */
const en = {
  executableMissing: (p: { command: string; path: string }) => `The specified ${p.command} (${p.path}) doesn't exist or can't be run.`,
  commandMissing: (p: { command: string; hint: string }) => `Couldn't find the ${p.command} command. ${p.hint}, or set its location in Settings.`,
  commandNotFound: (p: { command: string }) => `Couldn't find the ${p.command} command`,
  installItFirst: 'Install it first',
  versionFailed: (p: { command: string }) => `${p.command} --version didn't exit normally.`,
  outdated: (p: { name: string; version: string; min: string }) => `${p.name} ${p.version} is too old. BaoCut needs ${p.min} or later.`,
  startFailed: (p: { name: string; error: string }) => `${p.name} failed to start: ${p.error}`,
  openSessionFailed: (p: { name: string; error: string }) => `${p.name} couldn't open a session: ${p.error}`,
  confinedUnsupported: (p: { name: string }) => `${p.name} doesn't support confined one-off calls`,
  /** `error` 为空时不带括号里的原因。 */
  resumeFailed: (p: { name: string; error: string }) =>
    `Couldn't resume the ${p.name} native session${p.error ? ` (${p.error})` : ''}. Started a new session; the Agent can't see the earlier conversation.`,
  sessionClosed: (p: { name: string }) => `The ${p.name} session is closed`,
  sessionNotReady: (p: { name: string }) => `The ${p.name} session isn't ready yet`,
  turnInProgress: "The previous turn hasn't finished yet",
  modelSwitchFailed: (p: { name: string; model: string; error: string }) => `${p.name} couldn't switch to model ${p.model}: ${p.error}`,
  timedOut: (p: { label: string; seconds: number }) => `${p.label} timed out (${p.seconds} s)`,
  unknownError: 'Unknown error',
  unknownReason: 'unknown reason',
  /** 工具输出里图片的占位。 */
  imagePlaceholder: '[Image]',
  /** 安装方式的名字。 */
  officialScript: 'Official script',
};

export type DriversCommonMessages = typeof en;

export const DriversCommon = defineCatalog('driversCommon', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
