import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './drivers-acp.zh-Hans.ts';
import { zhHant } from './drivers-acp.zh-Hant.ts';
import { ja } from './drivers-acp.ja.ts';
import { ko } from './drivers-acp.ko.ts';
import { es } from './drivers-acp.es.ts';
import { fr } from './drivers-acp.fr.ts';
import { de } from './drivers-acp.de.ts';
import { nl } from './drivers-acp.nl.ts';
import { ptBR } from './drivers-acp.pt-BR.ts';
import { it } from './drivers-acp.it.ts';
import { ru } from './drivers-acp.ru.ts';
import { pl } from './drivers-acp.pl.ts';
import { tr } from './drivers-acp.tr.ts';
import { vi } from './drivers-acp.vi.ts';

/** 经 ACP 接入的 Agent（GitHub Copilot、Gemini CLI、Cursor Agent、Grok、Kimi Code 与用户添加的）：预设、探测与会话里的文字。 */
const en = {
  copilotPlan: 'GitHub Copilot subscription',
  copilotLoginHint: "run copilot login in a terminal to sign in (or enter /login in copilot's interactive mode)",
  copilotInstallHint: 'Install GitHub Copilot CLI (npm install -g @github/copilot)',
  geminiPlan: 'Google account',
  geminiLoginHint: 'run gemini in a terminal and choose to sign in with a Google account, or put GEMINI_API_KEY=… in ~/.gemini/.env',
  geminiInstallHint: 'Install Gemini CLI (brew install gemini-cli)',
  cursorPlan: 'Cursor subscription',
  cursorInstallHint: 'Install Cursor Agent with the official script',
  grokPlan: 'xAI account',
  grokInstallHint: 'Install Grok CLI with the official script',
  kimiPlan: 'Kimi account',
  kimiInstallHint: 'Install Kimi Code following the official instructions (https://github.com/MoonshotAI/kimi-code)',
  customNoCommand: (p: { id: string }) => `Agent ${p.id} has no command`,
  customInstallHint: (p: { command: string }) => `Check that ${p.command} is installed and on PATH, or add it again with an absolute path`,
  /** 未登录时「怎么登录」的缺省说法。 */
  loginViaTerminal: (p: { command: string }) => `run ${p.command} in a terminal to sign in`,
  loginPerInstructions: 'follow its instructions to sign in',
  /** `detail` 为空时不带括号里的原文。 */
  signedOut: (p: { name: string; login: string; detail: string }) =>
    `${p.name} isn't signed in: ${p.login}.${p.detail ? ` (${p.detail})` : ''}`,
  probeTimeout: (p: { name: string; seconds: number }) => `${p.name} didn't respond within ${p.seconds} seconds`,
  acpModeFailed: (p: { name: string; error: string }) => `${p.name} failed to start in ACP mode: ${p.error}`,
  exitCode: (p: { code: string }) => `exit code ${p.code}`,
  /** `tail` 是 stderr 的最后一行，为空时不带。 */
  exited: (p: { name: string; status: string; tail: string }) => `${p.name} exited (${p.status})${p.tail ? `: ${p.tail}` : ''}`,
  exitedBeforeInit: (p: { name: string }) => `${p.name} exited before initializing`,
  initTimeout: (p: { name: string }) => `${p.name} didn't finish ACP initialization in time`,
  mcpHttpUnsupported: (p: { name: string }) =>
    `${p.name} can't connect to MCP servers over HTTP, so BaoCut's tools (reading and editing projects, subtitles, and so on) aren't available in this session.`,
  resumeUnsupported: (p: { name: string }) => `${p.name} doesn't support resuming sessions`,
  onlyAlwaysAllow: (p: { name: string }) =>
    `${p.name} only offered "Always allow" this time. BaoCut won't write that into its settings for you, so the request was declined.`,
  modeSwitchFailed: (p: { name: string; mode: string; error: string }) => `${p.name} couldn't switch session mode (${p.mode}): ${p.error}`,
  noAllowAllSwitch: (p: { name: string; configId: string }) =>
    `This ${p.name} session has no "allow all" switch (${p.configId}), so it will still ask about each action in Full access.`,
  setOptionFailed: (p: { name: string; configId: string; value: string; error: string }) =>
    `${p.name} couldn't set ${p.configId}=${p.value}: ${p.error}`,
  stillAskThisTurn: (p: { failure: string }) => `${p.failure}. It will still ask about each action this turn.`,
  noMatchingMode: (p: { name: string }) =>
    `${p.name} has no session mode matching this access mode, so it runs with its own default. BaoCut still checks actions that need approval against the access mode.`,
  modelSwitchUnsupported: (p: { name: string }) => `${p.name} can't switch models within a session, so it keeps using its current model.`,
};

export type DriversAcpMessages = typeof en;

export const DriversAcp = defineCatalog('driversAcp', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
