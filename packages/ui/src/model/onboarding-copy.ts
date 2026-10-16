import { defineMessages } from '@baocut/protocol';
import { zhHans } from './onboarding-copy.zh-Hans.ts';
import { zhHant } from './onboarding-copy.zh-Hant.ts';
import { ja } from './onboarding-copy.ja.ts';
import { ko } from './onboarding-copy.ko.ts';
import { es } from './onboarding-copy.es.ts';
import { fr } from './onboarding-copy.fr.ts';
import { de } from './onboarding-copy.de.ts';
import { nl } from './onboarding-copy.nl.ts';
import { ptBR } from './onboarding-copy.pt-BR.ts';
import { it } from './onboarding-copy.it.ts';
import { ru } from './onboarding-copy.ru.ts';
import { pl } from './onboarding-copy.pl.ts';
import { tr } from './onboarding-copy.tr.ts';
import { vi } from './onboarding-copy.vi.ts';

/**
 * 底部那一行说的是哪类事：全是 Agent 安装（`install`）、全是模型下载（`download`），或两样都有（`mixed`）。
 * 用词跟着那几件走（model/onboarding.ts `bgLine`）。
 */
export type BackgroundKind = 'download' | 'install' | 'mixed';

/** 首次启动引导的文案（model/onboarding.ts、components/onboarding；英文是键与类型的来源，译文在 `onboarding-copy.<语言>.ts`）。 */
const en = {
  dialogLabel: 'Welcome to BaoCut',
  stepsLabel: 'Setup steps',
  step: {
    agent: 'Connect an Agent',
    asr: 'Speech recognition',
    tts: 'Speech synthesis',
    semantic: 'Semantic search',
    image: 'Image generation',
    music: 'Music generation',
  },
  title: {
    agent: 'Welcome to BaoCut',
    asr: 'Download speech recognition models',
    tts: 'Download speech synthesis models',
    semantic: 'Install semantic search',
    image: 'Download image generation models',
    music: 'Download music generation models',
  },
  lead: {
    agent:
      'Describe the video you want, and an Agent transcribes, adds subtitles, translates, makes voice-overs and edits for you. BaoCut uses the Agents on this computer (such as Claude Code or Codex) with your own account, at no extra charge.',
    asr: 'Transcribing, adding subtitles and editing talking-head videos all start by turning speech into text. The models run on this computer and work offline.',
    tts: 'Speech synthesis models read text aloud, clone a voice from a recording and make voice-overs for translated videos. Pick one or two to start; download others later in Settings › Speech synthesis.',
    semantic:
      'Find what was said and shown by meaning: Space search, picking material by topic, matching footage and translation memory all use it. Once it’s installed, your existing videos are indexed in the background.',
    image: 'Generate images from a sentence on this computer, for covers and illustrations. The models are large and generating is slow.',
    music:
      'Generate background music and songs from a style or lyrics on this computer, ready to add to a video’s music track. Generating is slow: about a few minutes for 30 seconds.',
  },
  /** 下好之后在哪儿用（只写工具页里有入口的那几类）。 */
  where: {
    tts: {
      title: 'Use it in Tools › Generate speech',
      body: 'Write some text, or pick a document or subtitles in Space, then choose a model and a voice. Models you haven’t downloaded can be downloaded there too.',
    },
    image: { title: 'Use it in Tools › Generate image', body: 'Describe the picture in a sentence. Agents also use it to make covers.' },
    music: {
      title: 'Use it in Tools › Generate music',
      body: 'Choose a style and write lyrics. The music is saved to Space and can be added to your videos.',
    },
  },
  /** 转录候选下面那一句：区分说话人的方式。`pack` 是「说话人区分」模型包的名字（Runtime 给的）。 */
  diarizes: 'Tells speakers apart while transcribing',
  needsDiarization: (pack: string) => `To tell speakers apart, also download “${pack}”`,
  /** 其余候选下面那一句（按模型族）；没列的不写。 */
  familyNote: {
    'qwen3-tts-1.7b-customvoice': '9 preset voices · describe a speaking style in a sentence',
    'qwen3-tts-0.6b-base': 'Clones a voice from a 3-second recording',
    voxcpm2: 'Clones a voice from a recording · describe a style · 30 languages and Cantonese',
    'qwen-image-2.1-turbo': 'Distilled · fixed 8 steps · more than twice as fast as the base model',
    'qwen-image-2.1': 'Base model · slower, more steps',
    'yue2-3b': 'Generates from a style or lyrics · about a few minutes for 30 seconds',
  } as Record<string, string>,
  recommended: 'Recommended',
  installed: 'Installed',
  missingParts: 'Missing components',
  /** 卡片下面的一行：这次一起下哪几件。 */
  planLine: (parts: string) => `Downloads together: ${parts}`,
  downloading: (name: string) => `Downloading ${name}`,
  inBackground: 'Downloading in the background',
  bgNote: 'Before downloading, you’ll see where it comes from and where it’s saved. It starts only after you confirm and runs in the background, so you don’t have to wait.',
  asrAlt: 'Don’t want to download? You can also add cloud speech recognition later in Settings › API providers.',
  unsupported: 'This computer can’t run these models. You can skip this step.',
  semanticParts: (text: string, multimodal: string) => `${text} + ${multimodal}`,

  agentListLabel: 'Agents on this computer',
  agentChecking: 'Checking for Agents on this computer…',
  agentMissingBody: 'Check the ones you want and BaoCut installs them in the background. Once installed, sign in once with your existing account.',
  agentNote:
    'Checked Agents appear in the Agent menu of new sessions. Installing runs in the background, so you don’t have to wait. Choose the default or add more in Settings › Agent providers.',
  agentInstalled: 'Installed on this computer',
  agentFix: (problem: string) => `${problem} · Fix it in Settings › Agent providers`,
  agentManual: 'Install it in Terminal by following the official instructions · See Settings › Agent providers',
  agentNotInstalled: (plan: string | null) => (plan ? `Not installed · Sign in with your ${plan} once it’s installed` : 'Not installed'),
  agentWillInstall: (method: string, command: string, login: string) =>
    `Installs in the background with ${method} (${command}) · Then run ${login} in Terminal to sign in`,
  agentInstalling: (method: string, login: string) => `Installing in the background with ${method} · Then run ${login} in Terminal to sign in`,
  agentInstallingLabel: (name: string) => `Installing ${name}`,
  agentInstallFailed: 'Couldn’t install it · Details are in Background tasks',

  next: 'Next',
  finish: 'Done',
  skip: 'Skip',
  exit: 'Exit setup',
  install: (n: number) => (n === 1 ? 'Install 1 in the background and continue' : `Install ${n} in the background and continue`),
  /** `size` 不知道时 null（有部分没有登记大小）。 */
  download: (size: string | null, last: boolean) =>
    `Download${size ? ` ${size}` : ''} in the background and ${last ? 'finish' : 'continue'}`,
  /** 对话框底部那一行（和按钮挤一排，要短）。 */
  bg: {
    one: (kind: BackgroundKind, name: string, pct: number | null) => {
      const tail = pct === null ? '' : ` ${pct}%`;
      return kind === 'install' ? `Installing ${name}${tail}` : kind === 'download' ? `Downloading ${name}${tail}` : `Setting up ${name}${tail}`;
    },
    many: (kind: BackgroundKind, n: number) =>
      kind === 'install' ? `Installing ${n} in the background` : kind === 'download' ? `Downloading ${n} in the background` : `Setting up ${n} in the background`,
    idle: (kind: BackgroundKind): string =>
      kind === 'install' ? 'Background installs' : kind === 'download' ? 'Background downloads' : 'Background downloads and installs',
    done: (kind: BackgroundKind, n: number) => (kind === 'install' ? `${n} installed` : kind === 'download' ? `${n} downloaded` : `${n} done`),
    failed: (kind: BackgroundKind, n: number) =>
      kind === 'install' ? `${n} not installed` : kind === 'download' ? `${n} not downloaded` : `${n} didn’t finish`,
  },
  /** 关掉引导时还有在后台跑的：几个模型在下、几个 Agent 在装。 */
  closedToast: (models: number, agents: number) => {
    const parts = [
      ...(models ? [models === 1 ? '1 model is downloading' : `${models} models are downloading`] : []),
      ...(agents ? [agents === 1 ? '1 Agent is installing' : `${agents} Agents are installing`] : []),
    ];
    return `${parts.join(' and ')} in the background. ${models + agents === 1 ? 'It’s' : 'They’re'} ready to use once finished.`;
  },
  viewTasks: 'View background tasks',
};

export type OnboardingMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
