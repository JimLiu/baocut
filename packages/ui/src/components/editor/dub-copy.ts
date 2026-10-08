import { defineMessages, type DubOriginalAudio } from '@baocut/protocol';
import { zhDub, zhDubRegen, zhTimelineDub } from './dub-copy.zh-Hans.ts';
import { zhHantDub, zhHantDubRegen, zhHantTimelineDub } from './dub-copy.zh-Hant.ts';
import { jaDub, jaDubRegen, jaTimelineDub } from './dub-copy.ja.ts';
import { koDub, koDubRegen, koTimelineDub } from './dub-copy.ko.ts';
import { esDub, esDubRegen, esTimelineDub } from './dub-copy.es.ts';
import { frDub, frDubRegen, frTimelineDub } from './dub-copy.fr.ts';
import { deDub, deDubRegen, deTimelineDub } from './dub-copy.de.ts';
import { nlDub, nlDubRegen, nlTimelineDub } from './dub-copy.nl.ts';
import { ptBRDub, ptBRDubRegen, ptBRTimelineDub } from './dub-copy.pt-BR.ts';
import { itDub, itDubRegen, itTimelineDub } from './dub-copy.it.ts';
import { ruDub, ruDubRegen, ruTimelineDub } from './dub-copy.ru.ts';
import { plDub, plDubRegen, plTimelineDub } from './dub-copy.pl.ts';
import { trDub, trDubRegen, trTimelineDub } from './dub-copy.tr.ts';
import { viDub, viDubRegen, viTimelineDub } from './dub-copy.vi.ts';

/** 「n 句」：英文按单复数。 */
const sentences = (n: number) => `${n} sentence${n === 1 ? '' : 's'}`;
/** 「这一句 / 这 n 句」。 */
const these = (n: number) => (n > 1 ? `these ${n} sentences` : 'this sentence');

/**
 * 翻译配音的文案（设置页、运行态、授权询问、问题与收据）。设计稿：panel-dub-setup.jsx `DubSetup`、panel-dub.jsx。
 * 译文在 `dub-copy.zh-Hans.ts`；界面英文里配音叫 Voice-over（docs/glossary.md）。
 */
const dub = {
  // 设置页
  title: 'Translated voice-over',
  back: 'Back',
  web: 'Translated voice-over needs the desktop app',
  webBody: 'BaoCut in the browser doesn’t provide fixed workflows (pipelines.*), so a translated voice-over can’t start here. Open this video in the desktop app.',
  summary: (language: string, count: number | null, translate: boolean) =>
    `${translate ? `Translates into ${language} first, then synthesizes` : `Uses the existing ${language} translation and synthesizes`} speech ${count === null ? 'sentence by sentence' : `for ${sentences(count)} one by one`}, aligns each to the original sentence’s timing, and writes them to the timeline as one voice-over group`,
  language: 'Voice-over language',
  languagePicker: 'Voice-over language',
  languageLine: (translate: boolean, count: number | null) =>
    `${translate ? 'No translation in this language yet · translates first' : 'Uses the existing translation · no new translation'}${count === null ? '' : ` · ${sentences(count)}`}`,
  allTaken: 'No languages available for voice-over.',
  staleNote: (n: number) =>
    `${sentences(n)} in this translation ${n === 1 ? 'is' : 'are'} out of date (the original changed or was marked out of date). They won’t be synthesized and will be listed in the summary. Retranslate them in the Subtitles panel first for a complete voice-over.`,
  source: 'Original',
  sourcePicker: 'Transcript to voice',
  sourceLine: (language: string, count: number | null) => (count === null ? language : `${language} · ${sentences(count)}`),
  voiceModel: 'Voice model',
  voiceModelPicker: 'Speech model for synthesis',
  voiceModelsLoading: 'Loading speech models…',
  manageVoiceModels: 'Manage speech models…',
  ttsMissingTitle: 'No speech model available yet',
  goTts: 'Open Models › Speech synthesis',
  voice: 'Default voice',
  voicePicker: 'Used for speakers without a voice of their own',
  voiceDefault: 'Model default',
  voiceCustom: 'Voice ID',
  voiceCustomPlaceholder: 'Voice ID from your provider account',
  voiceHint: 'Speakers with a voice assigned below use it; the rest use the one chosen here.',
  voiceCustomEmpty: 'Enter a voice ID first, or choose another voice',
  speakers: 'Speakers',
  speakersAside: (n: number) => `${n}`,
  speakersNone: 'This transcript has no speaker information, so every sentence uses the default voice above.',
  speakersNote: 'Assignments are saved in this video (an edit you can undo) and reused next time. Priority: assigned → default voice → model default.',
  speakerLine: (count: number) => sentences(count),
  speakerBinding: (name: string) => `Voice assigned to ${name}`,
  bindingNone: 'None',
  bindingOther: (label: string) => `${label} (assigned elsewhere)`,
  bindingIgnored: (provider: string) => `Assigned voice is from another provider and isn’t used with ${provider}`,
  bindingReadOnly: 'The video is read-only, so speaker voices can’t be changed.',
  bindingFailed: (message: string) => `Couldn’t change the speaker’s voice: ${message}`,
  bindingLoading: 'Loading speaker voices…',
  bindingReadFailed: (message: string) => `Couldn’t read the speaker voices assigned in this video: ${message}`,
  bindingSaved: (name: string) => `Assigned a voice to ${name}`,
  bindingCleared: (name: string) => `Removed ${name}’s voice assignment`,
  sourceVideo: 'Assigned',
  sourceParams: 'Default voice',
  sourceDefault: 'Model default',
  /** 说话人这一行实际用哪个音色；模型默认的 label 自带「模型默认」，不再重复来源。 */
  effective: (label: string, source: string | null) => (source ? `Using: ${label} (${source})` : `Using: ${label}`),
  speakerWarning: (reason: string) => `This speaker’s sentences won’t be synthesized: ${reason}`,
  manageVoices: 'Manage My voices…',
  mix: 'Mix',
  separate: 'Separate background audio',
  separateHint: 'The voice-over replaces only the speech; music and ambient sound stay',
  separateMissing: 'No separation model is available on this computer; even if turned on, separation is skipped and the original audio is processed as a whole.',
  installSeparate: 'Install separation model…',
  /** 分离开着、分离模型还没装时的门卡与主按钮（设计稿 panel-dub-setup.jsx「还要下载 X · 大小」「下载模型并配成…」）。 */
  separateDownload: (name: string) => `${name} needs to be downloaded`,
  separateDownloadBody: 'The button below downloads it first and starts the voice-over once it’s installed. Downloading doesn’t use the task queue.',
  separateWaiting: (name: string, pct: number | null) =>
    `Downloading ${name}${pct === null ? '' : ` · ${pct}%`} · the voice-over starts once it’s installed`,
  ctaDownload: (language: string) => `Download model and voice in ${language}`,
  separateDownloadStopped: 'The separation model didn’t finish downloading, so the voice-over didn’t start.',
  original: 'Original audio',
  originalPicker: 'What happens to the original audio when the voice-over plays',
  originalLabel: { duck: 'Lower', mute: 'Mute', keep: 'Keep' } satisfies Record<DubOriginalAudio, string>,
  /**
   * 混音一节的说明（设计稿 panel-dub-setup.jsx）：分离时背景声单独成轨、原声只剩人声（压低时人声在「人声」轨上压低），
   * 不分离时原声整条静音或压低；`keep` 不动原声，也不分离。
   */
  mixHint: (o: { separated: boolean; original: DubOriginalAudio; duckDb: number }) =>
    o.original === 'keep'
      ? `The original audio stays as is and plays under the voice-over${o.separated ? '; nothing is separated when it’s kept' : ''}.`
      : `${o.separated ? 'Background audio goes on its own track and the original keeps only the speech, which is' : 'Without separation, the whole original audio is'} ${o.original === 'mute' ? 'muted' : `lowered by −${o.duckDb} dB`}. You can switch back to the original audio from the voice-over track header at any time.`,
  duckDb: 'How much to lower (dB)',
  duckLabel: 'Lower',
  duckUnit: 'dB',
  translate: 'Translation',
  textModel: 'Text model',
  textModelPicker: 'Text model for translation',
  textModelsLoading: 'Loading text models…',
  manageTextModels: 'Manage text models…',
  textMissingTitle: 'No text model available yet',
  goLlm: 'Open Models › Text generation',
  noStructured: 'No structured output · can’t be used for translation',
  style: 'Style hint',
  stylePlaceholder: 'For example: conversational, concise; keep names in the original',
  styleHint: 'Optional; up to 500 characters.',
  cta: (language: string) => `Voice in ${language}`,
  /** 按钮下的说明：写进哪几条轨（分离时多「背景声」，压低时再多「人声」）。 */
  ctaHint: (language: string, stems: { separated: boolean; original: DubOriginalAudio }) => {
    const tracks = [`“Voice-over · ${language}”`];
    if (stems.separated && stems.original !== 'keep') tracks.push('“Background”');
    if (stems.separated && stems.original === 'duck') tracks.push('“Vocals”');
    const list = tracks.length === 1 ? tracks[0] : `${tracks.slice(0, -1).join(', ')} and ${tracks[tracks.length - 1]}`;
    return `When done, it’s written to the ${list} track${tracks.length === 1 ? '' : 's'} on the timeline; undo with one click. Online models are billed per call.`;
  },
  noSpeechTitle: 'No transcript to voice yet',
  noSpeech: 'Voice-over works sentence by sentence from a transcript. First transcribe an asset with “Generate subtitles” in the Subtitles panel.',
  busy: 'This video already has a voice-over in progress; wait for it to finish before starting another.',
  readOnly: 'The video is read-only, so it can’t get a voice-over.',

  // 运行态
  submitting: 'Submitting voice-over',
  queued: 'Queued',
  running: (language: string) => `Voicing · ${language}`,
  stepUnits: (step: 'translate' | 'synthesize', done: number, total: number | null) =>
    `${step === 'translate' ? 'Translated' : 'Synthesized'} ${done}${total ? ` / ${total}` : ''} sentence${(total ?? done) === 1 ? '' : 's'}`,
  sentences: (running: number, failed: number) =>
    [running ? `${sentences(running)} synthesizing` : '', failed ? `${sentences(failed)} failed` : ''].filter(Boolean).join(' · '),
  cancel: 'Cancel voice-over',
  cancelled: 'Voice-over cancelled',
  cancelFailed: (message: string) => `Couldn’t cancel the voice-over: ${message}`,
  liveNote: 'When done, the Runtime writes it straight to the timeline, and you can undo it at any time. You can leave this page.',
  foreign: 'This voice-over wasn’t started here. When it finishes, check the timeline; undo with the editor’s Undo.',

  // 授权
  grantTitle: (recipient: string) => `No permission yet to send the transcript to ${recipient}`,
  grantBody:
    'Voice-over sends the translation to synthesize (and the original where a translation is missing) to the provider. Grant a permission limited to this video to continue; nothing is sent without it.',
  grantAction: 'Grant permission and start',
  grantRetryAction: 'Grant permission and try again',
  grantDialogTitle: 'Grant data sharing permission',
  grantDialogIntro: 'Once you confirm, BaoCut records this permission and continues the voice-over:',
  grantConfirm: 'Grant and continue',
  grantCancel: 'Not now',
  granting: 'Granting permission…',
  grantFailed: (message: string) => `Couldn’t grant permission: ${message}`,
  grantStillRefused: 'Still refused after granting permission',
  grantNext: 'When translation and synthesis use different providers, each needs its own permission.',
  commands: 'Command line',

  // 问题
  notConfigured: 'Voice-over isn’t available yet',
  submitFailed: 'Couldn’t start the voice-over',
  failed: 'Voice-over failed',
  interrupted: 'Voice-over was interrupted',
  retry: 'Try again',
  retryFailed: (message: string) => `Couldn’t try again: ${message}`,
  retryCharges:
    'Trying again resumes from the step where it stopped. If it stopped at “Translate”, that whole step reruns; batches already translated call the model again and may be billed again.',
  retryPartial: 'Trying again resumes from “Synthesize sentences”: synthesized sentences are reused, and only failed or remaining ones are synthesized.',
  retryFree: 'Trying again resumes from the step where it stopped; earlier finished steps are reused without calling the model again.',
  retryFrozen:
    'Speaker voice assignments were frozen when it started: fixing a voice (recloning it, adding the owner’s statement) helps a retry, but changing assignments needs a new voice-over.',
  failedUnits: (n: number) => `${sentences(n)} failed to synthesize`,
  stoppedAt: (synthesized: number, remaining: number) => `Stopped after synthesizing ${sentences(synthesized)}; ${remaining} remaining`,
  dismiss: 'OK',

  // 收据
  doneTitle: (language: string) => `Voiced in ${language}`,
  doneToast: (language: string, placed: number) => `Voiced in ${language} · ${sentences(placed)} placed on the timeline`,
  placed: (placed: number, total: number) => `${placed} / ${total} sentences placed on the timeline`,
  fitHead: 'Where each sentence went',
  speakersHead: 'Speaker voices',
  speakerUnits: (n: number) => sentences(n),
  speakerNone: 'No speaker',
  voiceFailedHead: 'These speakers’ sentences weren’t synthesized',
  voiceFailedLine: (name: string, n: number, reason: string) => `${name} · ${sentences(n)} · ${reason}`,
  voiceFailedFix:
    'This voice-over is finished and can’t be retried: undo this voice-over group → fix the voice (reclone it, add the owner’s statement) or change the assignment → voice it again.',
  synthesisLine: (calls: number, retries: number, failures: number, reused: number) =>
    [
      `${calls} call${calls === 1 ? '' : 's'}`,
      retries ? `${retries} resent` : '',
      failures ? `${failures} failed` : '',
      reused ? `${sentences(reused)} reused` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  translationCreated: 'The new translation made this time is saved in the video (undoing the voice-over won’t delete it)',
  translationUsed: 'Used an existing translation',
  glossaryUsed: (n: number) => `Used ${n} ${n === 1 ? 'glossary' : 'glossaries'}`,
  warnings: 'Warnings',
  undo: 'Undo this voice-over',
  undoing: 'Undoing…',
  undone: 'Voice-over undone',
  undonePartial:
    'Undid this voice-over’s clips, mutes, and ducking. The empty voice-over track and the voice-over plan document stay in the video (the protocol has no operation to delete tracks or documents).',
  undoLabel: (language: string) => `Undo voice-over (${language})`,
  undoFailed: 'Couldn’t undo this voice-over',
  undoNotOpen: 'Open that video first to undo this voice-over.',
  close: 'Close',
  again: 'Voice again',
  providerFallback: 'this provider',
  unknownLanguage: 'Unknown language',
};

export type DubMessages = typeof dub;
export const DUB_COPY = defineMessages(dub, { 'zh-Hans': zhDub, 'zh-Hant': zhHantDub, ja: jaDub, ko: koDub, es: esDub, fr: frDub, de: deDub, nl: nlDub, 'pt-BR': ptBRDub, it: itDub, ru: ruDub, pl: plDub, tr: trDub, vi: viDub });

/** 说话人音色的来源，按当前语言读。 */
export const DUB_SPEAKER_SOURCE = {
  get video() {
    return DUB_COPY.sourceVideo;
  },
  get params() {
    return DUB_COPY.sourceParams;
  },
  get default() {
    return DUB_COPY.sourceDefault;
  },
};

/** 时间线上的配音块与块菜单（设计稿 timeline-dub.jsx `DubBlock` / `DubBlockMenu`，model-dub.js `selectionTitle`；`trackLine` 见 DUB_REGEN_COPY.headLine）。 */
const timelineDub = {
  trackLabel: (language: string) => `Voice-over · ${language}`,
  /** 这组配音分离出的分轨的行头（设计稿 model-timeline.js 的「背景声」行）；人声只在原声压低时有。 */
  stemTrackLabel: (stem: 'background' | 'vocals', language: string) => `${stem === 'vocals' ? 'Vocals' : 'Background'} · ${language}`,
  /** 块上的语速角标：1.0× 不写，快过上限写「1.62× · 过快」。 */
  rate: (rate: number, fast: boolean) => `${rate.toFixed(2)}×${fast ? ' · too fast' : ''}`,
  /** 拖右缘时的读数。 */
  stretching: (rate: number, seconds: number) => `${rate.toFixed(2)}× · ${seconds.toFixed(2)} s`,
  tip: (parts: { text: string; speaker: string | null; rate: string; muted: boolean; manual: boolean; editable: boolean }) =>
    [
      parts.text,
      parts.speaker,
      parts.rate,
      parts.muted ? 'Muted' : '',
      parts.manual ? 'Speed changed by hand' : '',
      parts.editable ? 'Drag the right edge to change length · right-click for more' : '',
    ]
      .filter(Boolean)
      .join(' · '),
  menuLabel: (title: string) => `Voice-over menu for “${title}”`,
  selection: (n: number) => `${sentences(n)} selected`,
  count: (n: number) => (n > 1 ? `These ${n} sentences` : 'This sentence'),
  listen: 'Play this sentence',
  listenHint: (timecode: string, seconds: number, rate: string) => `${timecode} · ${seconds.toFixed(1)} s${rate ? ` · ${rate}` : ''}`,
  mute: (allMuted: boolean, n: number) => `${allMuted ? 'Unmute' : 'Mute'} ${these(n)}`,
  muteHint: (allMuted: boolean): string => (allMuted ? 'Bring back the voice-over for these sentences' : 'These sentences go silent · also in exports'),
  remove: (n: number) => `Delete ${these(n)}`,
  removeHint: 'Removes from the voice-over track · can be undone',
  removeGroup: 'Remove this voice-over group',
  removeGroupHint: (bed: boolean) =>
    `${bed ? 'Removes it along with its background audio' : 'Removes all voice-over in this language'} · original audio muted by it comes back`,
  labelMute: 'Mute voice-over',
  labelUnmute: 'Unmute voice-over',
  labelRemove: 'Delete voice-over',
  labelRemoveGroup: (language: string) => `Remove voice-over (${language})`,
  labelStretch: 'Change voice-over speed',
  muted: (n: number) => `Muted ${sentences(n)} of voice-over`,
  unmuted: (n: number) => `Unmuted ${sentences(n)} of voice-over`,
  removed: (n: number) => `Deleted ${sentences(n)} of voice-over`,
  groupRemoved: (language: string) =>
    `Removed “Voice-over · ${language}” · the empty voice-over track and voice-over plan document stay in the video`,
  planUnread: 'Couldn’t read the voice-over plan: original audio muted by it wasn’t restored. You can unmute it on the original clips.',
};

export type TimelineDubMessages = typeof timelineDub;
export const TIMELINE_DUB_COPY = defineMessages(timelineDub, { 'zh-Hans': zhTimelineDub, 'zh-Hant': zhHantTimelineDub, ja: jaTimelineDub, ko: koTimelineDub, es: esTimelineDub, fr: frTimelineDub, de: deTimelineDub, nl: nlTimelineDub, 'pt-BR': ptBRTimelineDub, it: itTimelineDub, ru: ruTimelineDub, pl: plTimelineDub, tr: trTimelineDub, vi: viTimelineDub });

/** 句级重配（时间线配音行头的 ⋯、块菜单、改译文并重配、属性页的版本；设计稿 timeline-dub.jsx、panel-dub-fit.jsx、panel-audio-sentence.jsx）。 */
const dubRegen = {
  // ---- 行头 ⋯ ----
  headMenu: (label: string) => `“${label}” track`,
  headLine: (c: { total: number; fast: number; muted: number; failed: number; queued: number }) =>
    [
      sentences(c.total),
      c.failed ? `${c.failed} not synthesized` : '',
      c.fast ? `${c.fast} too fast` : '',
      c.muted ? `${c.muted} muted` : '',
      c.queued ? `${c.queued} regenerating` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  listenDub: 'Hear voice-over',
  listenDubHint: (o: { bed: boolean; duck: boolean; others: boolean }) =>
    `This group’s voice-over${o.bed ? ' + background' : ''} · ${o.duck ? 'original lowered' : 'original muted'}${o.others ? ' · other languages off' : ''}`,
  listenDubKeep: 'This voice-over group kept the original audio and didn’t record which parts it was; use “Hear both”',
  listenOriginal: 'Hear original',
  listenOriginalHint: (others: boolean) => `Brings back the video’s original audio · ${others ? 'all voice-over groups' : 'this voice-over group'} muted`,
  listenBoth: 'Hear both',
  listenBothHint: (bed: boolean) => `For comparing${bed ? ' · this group’s background off' : ''}`,
  sourceLabel: { dub: 'Hear voice-over', original: 'Hear original', both: 'Hear both' },
  sourceDone: {
    dub: (language: string) => `Hearing “Voice-over · ${language}”`,
    original: 'Hearing original · voice-over muted',
    both: 'Playing original and voice-over together',
  },
  regenSome: (n: number) => (n ? `Regenerate ${sentences(n)}…` : 'Regenerate…'),
  regenSomeHint: (failed: number, fast: number) =>
    failed || fast
      ? `${[failed ? `${failed} not synthesized` : '', fast ? `${fast} too fast` : ''].filter(Boolean).join(' · ')} · you can edit the translation first`
      : 'No sentences failed or too fast',
  redub: 'Voice again…',
  redubHint: 'Opens Translated voice-over: change the language or voice and redo the whole group',
  readOnly: 'The video is read-only',

  // ---- 块菜单 ----
  regenBlocks: (n: number) => `Regenerate ${these(n)}`,
  regenBlocksHint: 'Synthesize the same translation and voice again · new seed · the old take is kept',
  retext: 'Edit translation and revoice…',
  retextHint: 'Check lengths and edit the translation first, then revoice only these sentences',
  inQueue: 'Some sentences are regenerating',

  // ---- 块 ----
  queued: 'Regenerating…',
  queuedTip: (text: string) => `${text} · regenerating`,
  version: (k: number, seed: number | null) => (seed === null ? `Take ${k}` : `Take ${k} · seed ${seed}`),

  // ---- 提交与收尾 ----
  submitted: (n: number) => `Started regenerating ${sentences(n)} of voice-over`,
  submitFailed: (message: string) => `Couldn’t start regenerating: ${message}`,
  grantRefused: (recipient: string) =>
    `Regenerating sends the translation to ${recipient}, which has no permission yet. Grant one in Settings, or start over from Translated voice-over`,
  busy: 'This group is being submitted; one moment',
  done: (replaced: number, total: number) =>
    replaced === total ? `Regenerated ${sentences(replaced)} of voice-over` : `Regenerated ${replaced}/${total} sentences of voice-over`,
  doneNone: 'No sentence got a new take',
  notPlaced: (status: string, n: number) =>
    status === 'overlong'
      ? `${sentences(n)} didn’t fit; the previous take was kept`
      : status === 'stale'
        ? `${sentences(n)} had an outdated translation and weren’t synthesized`
        : status === 'voice-unavailable'
          ? `${sentences(n)} had an unavailable voice and weren’t synthesized`
          : `${sentences(n)} aren’t on the timeline`,
  failed: (message: string) => `Regeneration didn’t finish: ${message}`,
  cancelled: 'Regeneration cancelled',
  undo: 'Undo',
  undoMissing: 'Couldn’t find the edit this regeneration wrote; use the editor’s Undo',
  labelRetext: 'Edit translation (revoice)',

  // ---- 改译文并重配 ----
  fitTitle: (n: number) => `Edit translation and revoice ${sentences(n)}`,
  fitIntro:
    'You’re editing the translated sentence that gets spoken (edited ones are marked reviewed); subtitles made from it aren’t re-split. Each sentence is synthesized again with a new seed, and the old take is kept.',
  fitDub: (seconds: number, rate: string) => `Voice-over ${seconds.toFixed(1)} s${rate ? ` · ${rate}` : ''}`,
  fitVoice: 'Not synthesized: voice unavailable',
  fitOverlong: (seconds: number | null) => (seconds === null ? 'Not placed: too long' : `Not placed: ${seconds.toFixed(1)} s too long`),
  fitLoading: 'Loading translation…',
  fitUnreadable: (message: string) => `Couldn’t read this voice-over’s translation (${message}); revoicing from the original translation only`,
  fitMissing: 'This sentence isn’t in the translation; revoicing from the script in the plan',
  fitText: (index: number) => `Translation of sentence ${index}`,
  fitCancel: 'Cancel',
  fitSubmit: (n: number, changed: number) => (changed ? `Edit ${changed} and revoice ${sentences(n)}` : `Revoice ${sentences(n)}`),
  fitBusy: 'Submitting…',

  // ---- 属性页的版本 ----
  takesTitle: 'Takes',
  takesAside: (n: number) => `${n} take${n === 1 ? '' : 's'}`,
  takeCurrent: 'Current',
  takeUse: 'Switch to this take',
  takeLine: (seed: number | null, seconds: number | null, tempo: number | null) =>
    [
      seed !== null ? `seed ${seed}` : '',
      seconds !== null ? `${seconds.toFixed(1)} s` : 'not placed',
      tempo !== null && Math.abs(tempo - 1) >= 0.005 ? `${tempo.toFixed(2)}×` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  takeUnavailable: 'This take isn’t on the timeline, or its asset can’t be found',
  takesNote: 'Each regeneration records a take; switching back to an older take is an edit you can undo and doesn’t synthesize again.',
  takeName: (k: number) => `Take ${k}`,
  labelSwitchTake: (k: number) => `Switch to voice-over take ${k}`,
  switched: (k: number) => `Switched to take ${k}`,
  regenThis: 'Regenerate this sentence',
  unreadableFormat: 'Unrecognized format',
  unreadableNoTranslation: 'The plan has no translation',
};

export type DubRegenMessages = typeof dubRegen;
export const DUB_REGEN_COPY = defineMessages(dubRegen, { 'zh-Hans': zhDubRegen, 'zh-Hant': zhHantDubRegen, ja: jaDubRegen, ko: koDubRegen, es: esDubRegen, fr: frDubRegen, de: deDubRegen, nl: nlDubRegen, 'pt-BR': ptBRDubRegen, it: itDubRegen, ru: ruDubRegen, pl: plDubRegen, tr: trDubRegen, vi: viDubRegen });
