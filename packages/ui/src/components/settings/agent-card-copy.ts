import { createElement, Fragment, type ReactNode } from 'react';
import { defineMessages } from '@baocut/protocol';
import { zhHans } from './agent-card-copy.zh-Hans.ts';
import { zhHant } from './agent-card-copy.zh-Hant.ts';
import { ja } from './agent-card-copy.ja.ts';
import { ko } from './agent-card-copy.ko.ts';
import { es } from './agent-card-copy.es.ts';
import { fr } from './agent-card-copy.fr.ts';
import { de } from './agent-card-copy.de.ts';
import { nl } from './agent-card-copy.nl.ts';
import { ptBR } from './agent-card-copy.pt-BR.ts';
import { it } from './agent-card-copy.it.ts';
import { ru } from './agent-card-copy.ru.ts';
import { pl } from './agent-card-copy.pl.ts';
import { tr } from './agent-card-copy.tr.ts';
import { vi } from './agent-card-copy.vi.ts';

/**
 * 设置 › Agent 提供方里每一家的卡片（agent-provider-card.tsx；设计稿 settings-agent-provider.jsx）的文案。
 * 英文是键与类型的来源，译文在 `agent-card-copy.<语言>.ts`。用户添加的那一家的专用文案在 `agent-copy.ts` 的 `added`。
 */
const en = {
  runFailed: (message: string) => `Couldn't run: ${message}`,
  stopFailed: (message: string) => `Couldn't stop: ${message}`,
  /** 复制按钮与「已复制」提示里的那个名词。 */
  loginCommand: 'login command',
  installCommand: 'install command',
  upgradeCommand: 'upgrade command',
  linkLabel: 'link',
  terminalLogin: (command: string) => `Running ${command} in a terminal · Come back here after signing in`,
  terminalRun: (command: string) => `Running ${command} in a terminal · Come back here when it's done`,
  terminalCopied: (label: string) => `Couldn't open a terminal. Copied the ${label}; paste it into a terminal to run it.`,
  terminalManual: (command: string) => `Couldn't open a terminal. Run ${command} in a terminal.`,
  terminalFailed: (message: string) => `Couldn't open a terminal: ${message}`,
  enableFailed: (message: string) => `Couldn't enable: ${message}`,
  disableFailed: (message: string) => `Couldn't disable: ${message}`,
  recheckFailed: (message: string) => `Couldn't check again: ${message}`,
  saveModelFailed: (message: string) => `Couldn't save the default model: ${message}`,
  saveEffortFailed: (message: string) => `Couldn't save the default effort: ${message}`,
  refreshFailed: (message: string) => `Couldn't refresh models: ${message}`,
  setDefaultFailed: (message: string) => `Couldn't make it the default: ${message}`,
  openFailed: (message: string) => `Couldn't open: ${message}`,
  enabled: (name: string) => `Enabled ${name}`,
  disabled: (name: string) => `Disabled ${name} · New sessions no longer list it`,

  defaultBadge: 'Default',
  subInstalled: (version: string | null, account: string | null) =>
    ['Installed on this computer', version ? `v${version}` : null, account].filter(Boolean).join(' · '),
  subMissing: (command: string, plan: string) => `${command} not found on this computer · The ${plan} you already have is all you need`,
  enable: (name: string) => `Enable ${name}`,
  details: 'Details',
  install: 'Install',
  checking: 'Checking…',
  gateTitle: (name: string, model: string) => `${name}'s configured default model ${model} needs a newer version`,
  gateBody: (version: string, model: string) =>
    `This computer has ${version}, and this version's model list doesn't include ${model}. Sessions set to “Agent default model” use it as configured and get rejected when sent; sessions with a specific model aren't affected.`,
  gateUpgrade: 'Upgrading only updates this command-line tool; your account and its own settings stay as they are.',
  gateNoUpgrade: "There's no newer version to upgrade to yet. For now, pick a model from the list in the session.",
  upgradeTo: (version: string) => `Upgrade to ${version}`,
  updateStrip: (latest: string, current: string) => `Version ${latest} is available (current: ${current}). You can keep using it without upgrading.`,
  viewUpgrade: 'See how to upgrade',
  cancel: 'Cancel',

  defaultModel: 'Default model',
  defaultModelDesc:
    "New sessions start with it; each session can still switch below the input box. The “Recommended” tier is enough for transcribing, translating and editing; you don't need the most capable model.",
  defaultModelOf: (name: string) => `${name} default model`,
  defaultEffortOf: (name: string) => `${name} default reasoning effort`,
  modelsOf: (name: string, count: number) => `${name} models · ${count}`,
  modelsList: (list: string) => `${list}. Refreshed with each check.`,
  modelsNone: "It didn't report a model list, so sessions use the Agent default model. It's asked again on the next check.",
  refreshing: 'Refreshing…',
  refreshModels: 'Refresh models',
  refreshed: (name: string) => `Refreshed ${name}'s model list`,
  nowDefault: (name: string) => `New sessions now use ${name}`,
  version: (version: string | null) => (version ? `Version · v${version}` : 'Version'),
  versionDesc: (latest: string | null, min: string | null, source: string) =>
    `${latest ? `You can upgrade to ${latest}. ` : ''}${min ? `BaoCut needs at least ${min}. ` : ''}Upgrading only updates this command-line tool; your account and its own settings stay as they are. ${source}`,
  account: 'Account',
  accountDesc: (signedOut: boolean, account: string | null, plan: string) =>
    `${signedOut ? 'Not signed in, or the sign-in has expired' : (account ?? 'Signed in')}. Uses your own ${plan}; BaoCut doesn't charge extra. Signing in happens in a terminal.`,
  loginInTerminal: 'Open a terminal to sign in',
  switchAccount: 'Switch account…',
  location: 'Install location',
  locationDesc: 'BaoCut calls this program on your computer directly and never installs another copy.',
  realLocation: 'Actual location',
  setLocation: 'Set location by hand',
  troubleshoot: 'Troubleshoot',
  troubleshootDesc: 'Checks installation, version, sign-in and the model list one by one, and tells you where it gets stuck.',
  setDefault: 'Make default',
  runChecks: 'Run checks',

  /** 升级说明的最后一句：认出了来源就点名，否则请用户用当初的方式。 */
  sourceKnown: (label: string) =>
    `This copy was installed with “${label}”, so upgrade it the same way. Other methods can't reach this copy; they only install another one.`,
  sourceUnknown: 'Upgrade it the same way you installed it.',
  scriptInstall:
    "This command downloads and runs a script from the official website. BaoCut doesn't run scripts from the internet for you: copy it and run it in a terminal yourself.",
  scriptUpgrade: 'This command downloads and runs a script from the official website. Copy it and run it in a terminal yourself.',
  copyUpgrade: 'Copy this command and run it in a terminal, then come back here and check again.',
  runnableHint: 'Click ▶ to the left of the command to run it here; its output appears below. Or copy it and run it in a terminal yourself.',
  copyHint: 'Copy the command below and run it in a terminal.',
  installMethod: 'Install method',
  upgradeMethod: 'Upgrade method',
  needs: (needs: string) => `Requires ${needs} on this computer.`,

  installIntro: (name: string, plan: string) =>
    `${name} is a command-line AI assistant installed on your own computer, signed in with the ${plan} you already have. BaoCut just calls it: no extra charge, and no API key to enter in BaoCut.`,
  stepInstall: 'Install it on this computer',
  stepInstallOfficial: 'Install it on this computer following the official instructions',
  /** `command` 是排成代码样式的命令名。 */
  installOfficialBody: (command: ReactNode): ReactNode =>
    createElement(Fragment, null, 'Install it following its official instructions. Once installed, ', command, ' should run in a terminal.'),
  stepLogin: 'Sign in to your account',
  stepLoginBody:
    'Once installed, run the command below in a terminal and sign in in your browser when prompted. Signing in happens in its own window; BaoCut never handles your account or password.',
  stepBack: 'Come back here',
  stepBackBody: "It's ready to use once it's detected as installed and signed in.",
  detecting: 'Checking…',
  recheck: "I've installed it, check again",
  notDetected: 'Installed but not detected?',
  notDetectedBody:
    "BaoCut looks in PATH and common install locations (Homebrew, npm's global folder, ~/.local/bin). Ones installed with a version manager (nvm, asdf, mise) are sometimes elsewhere; you can point BaoCut to it by hand.",
  diagnosisOf: (name: string) => `Check results for ${name}`,
};

export type AgentCardMessages = typeof en;

export const CARD_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
