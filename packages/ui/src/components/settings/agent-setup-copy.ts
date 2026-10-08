import { defineMessages } from '@baocut/protocol';
import { zhHans } from './agent-setup-copy.zh-Hans.ts';
import { zhHant } from './agent-setup-copy.zh-Hant.ts';
import { ja } from './agent-setup-copy.ja.ts';
import { ko } from './agent-setup-copy.ko.ts';
import { es } from './agent-setup-copy.es.ts';
import { fr } from './agent-setup-copy.fr.ts';
import { de } from './agent-setup-copy.de.ts';
import { nl } from './agent-setup-copy.nl.ts';
import { ptBR } from './agent-setup-copy.pt-BR.ts';
import { it } from './agent-setup-copy.it.ts';
import { ru } from './agent-setup-copy.ru.ts';
import { pl } from './agent-setup-copy.pl.ts';
import { tr } from './agent-setup-copy.tr.ts';
import { vi } from './agent-setup-copy.vi.ts';

/** `agent-setup.ts` 生成的状态词、问题说明、排查清单与下拉选项的文案（英文是键与类型的来源，译文在 `agent-setup-copy.<语言>.ts`）。 */
const en = {
  badge: {
    'not-installed': 'Not installed',
    error: "Can't run",
    outdated: 'Outdated',
    'signed-out': 'Sign-in needed',
    disabled: 'Disabled',
  },
  badgeNotChecked: 'Not checked yet',
  badgeReady: 'Available',
  badgeModelUpgrade: 'Available · Default model needs an upgrade',
  badgeModelUnavailable: 'Available · Default model unavailable',
  badgeUpdate: 'Available · Update available',

  errorTitle: (name: string) => `Found ${name}, but it can't run`,
  errorBody: (detail: string | null) =>
    `${detail ? `${detail} ` : ''}This usually happens when Node.js was uninstalled or upgraded, or file permissions changed. Running checks can pinpoint the failing step.`,
  errorCta: 'Run checks',
  outdatedTitle: (name: string, version: string | null) =>
    version ? `${name} ${version} is too old for BaoCut to drive` : `This version of ${name} is too old for BaoCut to drive`,
  outdatedBody: (detail: string | null, minVersion: string) =>
    `${detail ? `${detail} ` : `Requires ${minVersion} or later. `}Upgrading only updates this command-line tool; your account and its own settings stay as they are.`,
  outdatedCta: (version: string) => `Upgrade to ${version}`,
  signedOutTitle: (name: string) => `${name} needs you to sign in again`,
  signedOutBody: (name: string) =>
    `Signing in happens in ${name}'s own window; BaoCut never handles your account or password. Come back here to check after signing in.`,
  signedOutCta: 'Open a terminal to sign in',

  stepSkipped: 'Checked once the previous step passes',
  stepFind: 'Found on this computer',
  stepFindFail: (command: string) => `${command} isn't in the usual install locations or on PATH`,
  stepRun: 'Starts',
  stepRunOk: (command: string, version: string) => `${command} --version returned ${version}`,
  stepRunFail: 'Failed to start',
  stepVersion: 'Version supported by BaoCut',
  stepVersionOk: (version: string, min: string) => `${version}, minimum ${min}`,
  stepVersionFail: (version: string, min: string) => `Current ${version}, minimum ${min}`,
  stepLogin: 'Signed in to your account',
  stepLoginOk: 'Signed in',
  stepLoginFail: "It reports that it isn't signed in, or the sign-in has expired",
  stepModels: 'Model list available',
  stepModelsOk: (n: number) => (n === 1 ? '1 model' : `${n} models`),
  stepModelsNone: "It didn't report a model list; sessions use the Agent default model",
  verdictFail: (label: string, detail: string) => `Stuck at “${label}”: ${detail}`,
  verdictOk: 'All five checks passed. You can start a session.',

  moreSummary: (names: string[], more: boolean) => names.join(', ') + (more ? ', and more' : ''),

  readyTitle: 'Ready to go',
  readyBody: (name: string, model: string, plan: string) =>
    `New sessions use ${name} · ${model}. It runs on the ${name} already installed on this computer with your own ${plan}; BaoCut doesn't charge anything extra.`,
  readyCta: 'Start session',
  attentionBody: (name: string) =>
    `It's already installed on this computer, so there's no need to reinstall. The cause and the fix are in the “${name}” row below.`,
  attentionCta: 'View problem',
  offTitle: (name: string) => `${name} is installed but disabled`,
  offBody: 'Enable it to hand work over from BaoCut with a single sentence.',
  offCta: (name: string) => `Enable ${name}`,
  missingTitle: 'No Agent detected on this computer yet',
  missingBodyMany: "Install any one below and sign in with an account you already have. You don't need all of them.",
  missingBodyOne: 'Install it following the steps below and sign in with an account you already have.',

  logDropped: (n: number) => `… (${n} earlier ${n === 1 ? 'line' : 'lines'} omitted)`,
  doneNotDetected: (name: string) => `The command finished, but ${name} still isn't detected. If it's installed somewhere else, you can set its location by hand.`,
  doneSignIn: (name: string, version: string) => `Detected ${name} ${version} · Sign in once to finish`,
  doneInstalled: (name: string, version: string) => `Detected ${name} ${version}`,
  doneUpgraded: (name: string, version: string) => `${name} is now ${version} · Refreshing its model list`,

  tier: {
    balanced: { label: 'Recommended', description: 'Good enough for transcribing, translating and editing; fast, and lighter on your subscription quota' },
    max: { label: 'Most capable', description: 'Slower and uses more subscription quota; rarely needed' },
    fast: { label: 'Fastest', description: 'Good for small edits like changing a few subtitles' },
  },
  agentDefaultModel: 'Agent default model',
  cliConfigGate: (model: string) => `Follows the CLI settings · ${model} needs a CLI upgrade`,
  cliConfigModel: (model: string) => `Follows the CLI settings · ${model}`,
  cliConfig: 'Follows the CLI settings',
  modelMissing: "Not in the current model list; new sessions use the recommended model",
  effort: {
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Extra high',
    max: 'Max',
  } as Record<string, string>,
  modelDefaultEffort: 'Model default',
  modelDefaultEffortOf: (label: string) => `Model default (${label})`,

  rulesTitle: (n: number) => `Always-allowed commands · ${n}`,
  rulesBody:
    'These rules come from choosing “Always allow” in sessions. Once removed, a rule no longer approves actions automatically; access modes and other rules still apply.',
  rulesEmpty: 'No saved rules yet. Choose “Always allow” on an approval card in a session and it shows up here.',
};

export type AgentSetupMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
