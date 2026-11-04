import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './drivers-codex.zh-Hans.ts';
import { zhHant } from './drivers-codex.zh-Hant.ts';
import { ja } from './drivers-codex.ja.ts';
import { ko } from './drivers-codex.ko.ts';
import { es } from './drivers-codex.es.ts';
import { fr } from './drivers-codex.fr.ts';
import { de } from './drivers-codex.de.ts';
import { nl } from './drivers-codex.nl.ts';
import { ptBR } from './drivers-codex.pt-BR.ts';
import { it } from './drivers-codex.it.ts';
import { ru } from './drivers-codex.ru.ts';
import { pl } from './drivers-codex.pl.ts';
import { tr } from './drivers-codex.tr.ts';
import { vi } from './drivers-codex.vi.ts';

/** Codex Driver：账号描述、探测结果与 app-server 连接的错误。 */
const en = {
  plan: 'ChatGPT Plus or Pro subscription',
  installHint: 'Install Codex CLI',
  /** `detail` 是 `codex login status` 的原文，为空时不带。 */
  signedOut: (p: { detail: string }) => `Codex isn't signed in. Run codex login in a terminal.${p.detail ? ` (${p.detail})` : ''}`,
  /** `command` 是可执行文件的路径，`detail` 是 `login status` 报错的第一行。 */
  loginCheckFailed: (p: { command: string; detail: string }) =>
    `Couldn't check the Codex sign-in: ${p.command} login status failed. BaoCut runs this program with subcommands such as login status and app-server, so a wrapper script has to pass its arguments through unchanged.${p.detail ? ` (${p.detail})` : ''}`,
  /** 配置选了自定义提供方（`model_providers`，自带密钥），不需要登录 OpenAI 账号。 */
  customProvider: 'Custom model provider',
  chatgptAccount: 'ChatGPT account',
  apiKey: 'OpenAI API key',
  accessToken: 'Access token',
  workloadIdentity: 'Workload identity',
  codexAccount: 'Codex account',
  steerMismatch: (p: { expected: string; received: string }) =>
    `Codex gave an unexpected turn/steer reply: expected turn ${p.expected}, got ${p.received}`,
  /** `stderr` 为空时不带。 */
  appServerExited: (p: { code: string; signal: string; stderr: string }) =>
    `codex app-server exited (code ${p.code}, signal ${p.signal})${p.stderr ? `\n${p.stderr}` : ''}`,
  connectionClosed: 'The codex app-server connection is closed',
  requestTimeout: (p: { method: string }) => `codex app-server request timed out: ${p.method}`,
  appServerGone: 'codex app-server has exited',
};

export type DriversCodexMessages = typeof en;

export const DriversCodex = defineCatalog('driversCodex', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
