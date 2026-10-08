import { defineMessages, live } from '@baocut/protocol';
import { zhHans } from './tts-local-copy.zh-Hans.ts';
import { zhHant } from './tts-local-copy.zh-Hant.ts';
import { ja } from './tts-local-copy.ja.ts';
import { ko } from './tts-local-copy.ko.ts';
import { es } from './tts-local-copy.es.ts';
import { fr } from './tts-local-copy.fr.ts';
import { de } from './tts-local-copy.de.ts';
import { nl } from './tts-local-copy.nl.ts';
import { ptBR } from './tts-local-copy.pt-BR.ts';
import { it } from './tts-local-copy.it.ts';
import { ru } from './tts-local-copy.ru.ts';
import { pl } from './tts-local-copy.pl.ts';
import { tr } from './tts-local-copy.tr.ts';
import { vi } from './tts-local-copy.vi.ts';

/**
 * 设置 › 模型 › 语音合成的本地模型页与「试听」用到的文字（设计稿 settings-local.jsx、settings-tts.jsx、panel-tts-local.jsx）。
 * 本地页共用的文字在 models-copy.ts 的 `LOCAL_COPY`，下载管理在 local-models-copy.ts。
 * 英文是键与类型的来源，译文在 `tts-local-copy.<语言>.ts`。
 */
const en = {
  ttsLocal: {
    // 默认模型（语音合成没有出厂默认，菜单里没有「自动选择」）
    unset: 'Not set',
    defaultDesc: 'Preselected for new synthesis tasks. Without a default you pick a model each time; a manual choice always wins.',
    cloudDefault: (name: string) =>
      `The default is a cloud model (${name}); change it in Settings › Cloud models. Choosing a local model switches to it.`,
    noInstalled: 'No speech synthesis model is installed yet. Download one below first.',
    // 行
    audition: 'Preview',
    hideAudition: 'Hide preview',
    engine: 'Engine',
    license: 'License',
    components: 'Components',
    // 下载前的许可确认（设计稿 withModelLicense）
    licenseTitle: 'License',
    licenseUse: 'Speech made with it may only be used in non-commercial content; for videos you plan to use commercially, pick another speech model.',
    licenseConfirm: (size: string) => `I understand, download ${size}`,
    // 试听面板
    voice: 'Voice',
    tone: 'Tone',
    say: 'What to say',
    lines: 'Lines',
    more: 'More voices',
    cloneNew: 'Clone a new voice…',
    writeOwn: 'Write my own',
    ownPlaceholder: 'Type a sentence to hear',
    ownLabel: 'Preview text',
    describeLabel: 'Voice description',
    describePlaceholder: 'e.g. a deep, unhurried elderly male voice',
    builtinRef: (label: string, seconds: number | null) =>
      `Reference recording · ${label}${seconds !== null ? ` · ${seconds}s` : ''} · its transcript is included automatically`,
    describedBuiltin: (label: string) => `Voice from a description · uses the description that comes with “${label}”`,
    describePreset: (text: string) => `Description: ${text}`,
    myVoice: (name: string) => `My voices · ${name} · cloned from its reference recording and transcript`,
    presetOnly: (models: string | null) =>
      models
        ? `This model only has its built-in speakers · try “My voices” on a model that can clone: ${models} (the preview on each one’s row)`
        : 'This model only has its built-in speakers · to try “My voices”, download a model that can clone first',
    /** `presetOnly` 里列出的模型名。 */
    nameList: (names: readonly string[]) => names.join(', '),
    cloneHint: 'Give it 5–15 seconds of clean speech: one person talking, no background music. WAV, MP3, M4A, FLAC or a video file all work.',
    yourFile: (name: string) => `Your recording · ${name}`,
    sampleFile: (label: string) => `Sample recording · ${label} · comes with BaoCut, no need to find a file`,
    pickFile: 'Choose recording…',
    changeFile: 'Choose another…',
    useSample: 'Use sample recording',
    crossLang: 'Works across languages too: a Chinese recording can still read English.',
    noPicker:
      'The browser can’t pick files on this computer. To use a recording just this once, pick it in the desktop app; or use the sample recording, or save it to “My voices” first.',
    pickTitle: 'Choose a reference recording',
    pickButton: 'Choose',
    pickFilter: 'Audio or video',
    transcriptLabel: 'Recording transcript (optional)',
    transcriptHint: 'Writing down what’s said in the recording makes it sound closer',
    fileChip: (name: string, sample: boolean) => (sample ? `Sample · ${name}` : name),
    generate: 'Generate preview',
    again: 'Generate again',
    cancel: 'Cancel',
    busy: (phase: string) => `Synthesizing · ${phase}`,
    stalePrefix: 'Previous · ',
    stale: 'This clip was made with your previous choices. After changing the voice or text, click “Generate preview” to hear the new one.',
    download: 'Download',
    resultLabel: 'Preview result',
    credit: (credit: string) => `Built-in voice recording: ${credit}`,
    loadingAudio: 'Loading audio…',
    audioFailed: (message: string) => `Couldn't load the audio: ${message}`,
    downloadFailed: (message: string) => `Couldn't download: ${message}`,
    fileName: (name: string) => `${name.replace(/[^\w.-]+/g, '-')}-preview.wav`,
    // 「我的声音」那一侧：`name` 是发起克隆的那只本地模型的名字
    handoffFrom: (name: string) => `From the “${name}” preview · record one or take it from a video; you’ll go back once it’s saved`,
    handoffSaved: (name: string) => `Saved · go back to the “${name}” preview, where this voice will be selected`,
    handoffBack: 'Go back and use it',
    handoffCancel: 'No thanks, go back',
    auditionClone: 'Preview clone',
    auditionCloneLabel: (name: string) => `Preview clone · ${name}`,
    noCloneModel:
      'No local model that can clone is installed yet. Download one on the local models page first (IndexTTS2, Qwen3-TTS Base, GPT-SoVITS…).',
    goLocal: 'Go to local models',
  },
};

export type TtsLocalMessages = typeof en;

const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

export const TTS_LOCAL_COPY = live(() => M.ttsLocal);
