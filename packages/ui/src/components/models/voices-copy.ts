import { defineMessages, live } from '@baocut/protocol';
import { zhHans } from './voices-copy.zh-Hans.ts';
import { zhHant } from './voices-copy.zh-Hant.ts';
import { ja } from './voices-copy.ja.ts';
import { ko } from './voices-copy.ko.ts';
import { es } from './voices-copy.es.ts';
import { fr } from './voices-copy.fr.ts';
import { de } from './voices-copy.de.ts';
import { nl } from './voices-copy.nl.ts';
import { ptBR } from './voices-copy.pt-BR.ts';
import { it } from './voices-copy.it.ts';
import { ru } from './voices-copy.ru.ts';
import { pl } from './voices-copy.pl.ts';
import { tr } from './voices-copy.tr.ts';
import { vi } from './voices-copy.vi.ts';

/**
 * 模型 › 语音合成 › 我的声音（设计稿 settings-voices.jsx）的文字。页标题与导语在 models-copy.ts 的 `VOICES_COPY`；
 * 这里是列表、对话框与提示，克隆新音色的几步，以及克隆没建成时的原因与补救。
 * 英文是键与类型的来源，译文在 `voices-copy.<语言>.ts`。
 */
const en = {
  myVoices: {
    offline: 'Voices appear once the Runtime is connected.',
    add: 'Add voice',
    fromFile: 'New from audio file…',
    fromFileHint: 'WAV, MP3 or FLAC, up to 20 MB; 10–30 seconds of one person speaking clearly also works for cloud cloning',
    importPackage: 'Import voice pack…',
    importHint: 'A .bcvoice someone exported',
    noPicker: 'This window can’t open the system file dialog; use the desktop app.',
    pickAudioTitle: 'Choose a reference recording',
    pickAudioFilter: 'Audio (WAV, MP3, FLAC)',
    pickPackageTitle: 'Choose a voice pack',
    pickPackageFilter: 'Voice pack',
    pickButton: 'Choose',
    notAudio: 'Reference recordings must be WAV, MP3 or FLAC files.',
    imported: (name: string) => `Imported “${name}” · available when generating speech and voice-overs`,
    importFailed: (text: string) => `Couldn't import: ${text}`,
    foot:
      'A voice = a reference recording + what it says + a consent statement. The reference recording stays on this computer; an exported voice pack (name.bcvoice) includes the recording and can be sent to others to import, but clones don’t travel with it. ' +
      'Voices without a statement on whether they’re the speaker’s own are never uploaded to any third party.',
    // 一行
    play: (name: string) => `Preview ${name}`,
    stop: (name: string) => `Stop previewing ${name}`,
    playFailed: (text: string) => `Couldn't preview: ${text}`,
    more: (name: string) => `More · ${name}`,
    edit: 'Edit…',
    cloneTo: (label: string) => `Upload to ${label} to clone…`,
    recloneTo: (label: string) => `Upload to ${label} again…`,
    recloneHint: 'The reference recording changed, so the old clone is out of date',
    removeClone: (label: string) => `Delete clone from ${label}…`,
    export: 'Export voice pack…',
    remove: 'Delete…',
    cloning: (label: string) => `Uploading to ${label} to clone…`,
    /** 克隆在跑时跟在后面的一句：要多久、能不能走开。 */
    cloningEta: 'Usually done within a minute; it keeps going if you leave this page.',
    /** 克隆失败那一块的标题；下面是原因、怎么办与一键补救。 */
    cloneFailedTitle: (label: string) => `Couldn’t create the clone on ${label}`,
    loadingMeta: 'Loading…',
    // 新建与编辑
    createTitle: 'New voice',
    editTitle: (name: string) => `Edit “${name}”`,
    referenceFile: (file: string) => `Reference recording: ${file}`,
    name: 'Name',
    language: 'Language',
    languageHint: 'The language spoken in the reference recording',
    transcript: 'Transcript',
    transcriptHint: 'What’s said in the reference recording. Some engines need it to clone; leave it empty if you’re not sure.',
    consentHint: 'You can save without checking this, but the voice won’t be uploaded to any third party for cloning.',
    save: 'Save as voice',
    saveEdit: 'Save',
    cancel: 'Cancel',
    loading: 'Loading voice…',
    loadFailed: (text: string) => `Couldn't load this voice: ${text}`,
    saved: (name: string) => `Saved “${name}” · available when generating speech and voice-overs`,
    updated: (name: string) => `Saved “${name}”`,
    unchanged: 'No changes',
    // 克隆
    uploadTitle: (label: string) => `Upload to ${label}?`,
    upload: 'Upload',
    cloneStarted: (label: string) => `Uploading to ${label} · progress shows under the voice`,
    cloneRejected: (label: string) => `Couldn’t start uploading to ${label} · what happened and what to do is shown under the voice`,
    removeCloneTitle: (label: string) => `Delete the clone from ${label}?`,
    removeCloneBody: (label: string) =>
      `${label} will be asked to delete this cloned voice. To use this voice on ${label} afterwards, you’ll need to upload it again.`,
    removeCloneConfirm: 'Delete clone',
    cloneRemoved: (label: string) => `Deleted the clone from ${label}`,
    cloneGoneRemote: (label: string) => `${label} no longer has this clone; the record on this computer was cleared too`,
    cloneRemoveFailed: (text: string) => `Couldn't delete the clone: ${text}`,
    // 导出
    exportTitle: 'Export voice pack',
    exportButton: 'Export',
    exported: (path: string) => `Exported to ${path}`,
    exportFailed: (text: string) => `Couldn't export: ${text}`,
    exportExists: 'BaoCut doesn’t overwrite existing files. Choose another name or location and export again.',
    /** 目标已存在时的整句（`exportFailed` 加上 `exportExists`）。 */
    exportFailedExists: (text: string) =>
      `Couldn't export: ${text}. BaoCut doesn’t overwrite existing files. Choose another name or location and export again.`,
    // 删除
    deleteTitle: (name: string) => `Delete “${name}”?`,
    deleteConfirm: 'Delete',
    deleted: (name: string) => `Deleted “${name}”`,
    deleteFailed: (text: string) => `Couldn't delete: ${text}`,
    localOnlyTitle: (label: string) => `The clone on ${label} wasn't deleted`,
    localOnlyBody: (label: string, text: string) =>
      `${text}\n\nThe voice is still here. You can try again later, or delete only the record and voice on this computer. The clone in your ${label} account will then remain, and you’ll need to delete it on ${label} yourself.`,
    localOnlyConfirm: 'Delete only on this computer',
    later: 'Try again later',
  },
  /** 我的声音 › 克隆新音色（设计稿 settings-voice-capture.jsx）、补录授权声明、行上的 ID 与模型页那一行。 */
  capture: {
    newVoice: 'Clone a new voice',
    newVoiceHint: 'Record or upload a sample, then pick the models it’s for',
    back: 'My voices',
    steps: 'Steps',
    stepModels: 'Choose models',
    stepSample: 'Record a sample',
    stepConsent: 'Consent statement',
    stepSave: 'Save',
    modelsLede:
      'Pick the models this voice is for. Local engines only need the sample and keep the same speaker with a fixed seed; cloud providers get the sample to create a clone and keep its voice ID. Some providers also need the speaker to read a consent statement. You can add any of this later from the voice’s ⋯ menu.',
    local: 'On this computer',
    cloud: 'Cloud',
    needsConsent: 'needs consent statement',
    notConnected: 'not connected',
    /** 一定要逐字稿的本机引擎：采集存下的逐字稿是空的。 */
    needsTranscript: 'needs a transcript · add it in Edit after saving',
    noLocal: 'No installed local model can clone yet',
    noCloud: 'No provider here can clone',
    modelsNote:
      'Cloud providers you pick get the sample right after you save, to create the clone. Providers without a key can be picked too: the sample is kept, and you can upload it from the voice’s ⋯ menu once connected. Picking nothing is fine as well.',
    /** `limit` 是 `limitMinutes` / `limitSeconds` 写好的上限。 */
    sampleLede: (min: number, good: number, target: number, limit: string) =>
      `About ${target} seconds of one person speaking in a quiet room. ${min} seconds is enough to save; cloud providers need ${good} seconds or more. Longer is fine too, up to ${limit}.`,
    language: 'Language',
    scriptTail: (target: number, limit: string) =>
      `After these lines, keep talking (introduce yourself, describe your day). ${target} seconds is enough; keep going if you like, up to ${limit}.`,
    limitMinutes: (n: number) => (n === 1 ? '1 minute' : `${n} minutes`),
    limitSeconds: (n: number) => (n === 1 ? '1 second' : `${n} seconds`),
    source: 'Source',
    mic: 'Microphone',
    upload: 'Upload a file',
    device: 'Input device',
    defaultDevice: 'System default',
    level: 'Input level',
    start: 'Start recording',
    stop: 'Stop',
    again: 'Record again',
    otherFile: 'Choose another',
    play: 'Play back',
    stopPlay: 'Stop playback',
    progress: 'Recording progress',
    needMore: (seconds: string) => `${seconds} s more needed`,
    enoughBest: (target: string) => `Enough · best at ${target}`,
    /** 到了目标：够了，想多说可以接着说。 */
    plenty: 'That’s enough · keep going if you like',
    left: (seconds: string) => `${seconds} s left`,
    autoStop: 'Stops automatically',
    stoppedAtMax: (limit: string) => `Stopped at ${limit} · play it back and record again if you’re not happy`,
    checkTake: 'Play it back: listen for noise or misread words, and record again if you’re not happy.',
    pickFile: 'Choose an audio file',
    uploadHint: (min: number, target: number, limit: string) =>
      `WAV, MP3, M4A or FLAC · ${min} s or more, ${target} s is best, up to ${limit} is used · one person speaking, no music`,
    trimmed: (limit: string) => `Longer than ${limit}, so only the first ${limit} is used`,
    reading: 'Reading the audio…',
    readFailed: (message: string) => `Couldn’t read this audio: ${message}`,
    micFailed: (message: string) => `Couldn’t start the microphone: ${message}`,
    micDenied: 'BaoCut can’t use the microphone. Allow it in system settings, or upload a recording instead.',
    sampleShort: (seconds: string, min: number) => `Only ${seconds} seconds; at least ${min} seconds are needed. Record again.`,
    sampleLocal: 'Enough for local engines · a little longer and cloud providers can use it too',
    /** 选中的云端里有的收得更长：点名谁、要多长。 */
    sampleShortFor: (names: string, min: number) => `Enough for local engines · ${names} needs ${min} seconds or more, so record a little longer`,
    sampleOk: (target: number) => `Enough · ${target} seconds is best`,
    sampleBest: 'Enough',
    /** 样本比这几家收的长：只用前面这几秒（Runtime 截短再上传）。 */
    usesFirst: (names: string, seconds: number) => `${names} uses the first ${seconds} seconds`,
    consentLede: (names: string) =>
      `${names} needs the same person to read a fixed consent statement, and checks that it matches the sample. Recording with the same microphone in the same room helps it pass.`,
    consentLedeAny:
      'Some providers need the same person to read a fixed consent statement and check that it matches the sample. Recording with the same microphone in the same room helps it pass.',
    recommended: 'recommended',
    moreLanguages: 'More languages',
    custom: 'Custom sentence',
    customLabel: 'Custom consent statement',
    customPlaceholder: 'Write a sentence granting consent, then read it aloud',
    customWarning: 'Providers that check consent only accept the official text, so a custom sentence won’t pass. It’s kept for other providers.',
    flaky: 'Officially supported, but it often fails the check in practice. If you’re not in a hurry, read the English one.',
    untested: 'Officially supported, not tested yet. If you’re not in a hurry, read the English one.',
    consentHint: 'Read the whole sentence in one go; no need to rush',
    consentShort: (seconds: string) => `Only ${seconds} seconds · read the whole sentence`,
    consentGood: 'Play it back; reading the whole sentence clearly is enough',
    /** 录音中电平下面那一行（model/voice-capture.ts `liveTakeHint`）。 */
    takeLive: {
      clipping: 'Clipping · move back from the microphone or speak more softly',
      silent: 'No sound yet · check that the right microphone is selected, or move closer',
      quiet: 'Too quiet · move closer to the microphone',
      noisy: 'A bit noisy · turn off fans or air conditioning if you can',
      waiting: 'Read the text above',
      ok: 'Good level',
    },
    /** 停下后的毛病（短名，也用在保存前那条提醒里）与各自的办法。 */
    takeIssue: {
      silent: 'almost nothing recorded',
      clipping: 'clipping',
      quiet: 'too quiet',
      noisy: 'background noise',
      pauses: 'mostly pauses',
    },
    takeFix: {
      silent: 'Check that the right microphone is selected and not muted, then record again',
      clipping: 'Move a hand’s width back from the microphone or turn down the input volume in system settings, then record again',
      quiet: 'Move closer to the microphone and speak at your normal volume, then record again',
      noisy: 'Turn off fans and air conditioning, or move to a quieter room, then record again',
      pauses: 'Keep talking; don’t pause for long in the middle',
    },
    /** 几样毛病连成判词的标题（各语言自己拼）。 */
    takeTitle: (issues: readonly string[]) => {
      const text = issues.join(', ');
      return text.charAt(0).toLocaleUpperCase('en') + text.slice(1);
    },
    takeOk: 'Sounds good',
    takeOkFix: 'Good level, no clipping, and quiet enough',
    /** 授权声明这一步：现在选的麦克风和录样本的不是同一只。 */
    micNow: (sample: string, used: string, names: string) =>
      `The sample was recorded with “${sample}”, and “${used}” is selected now. With a different microphone, ${names} may not recognize both recordings as the same person.`,
    /** 授权声明已经用另一只麦克风录好了。 */
    micTaken: (sample: string, used: string, names: string) =>
      `The sample was recorded with “${sample}”, but this was recorded with “${used}”. With a different microphone, ${names} may not recognize both recordings as the same person; switch back and record again to be safe.`,
    switchMic: (label: string) => `Switch back to ${label}`,
    /** 麦克风菜单里录样本用的那一只。 */
    sampleMic: 'Used for the sample',
    /** 保存前那条提醒：只提醒，不拦。 */
    warnTitle: (names: string) => `${names} may reject this voice`,
    warnTitleLocal: 'The cloned voice will pick up these problems too',
    warnSample: (issues: readonly string[]) => `Sample: ${issues.join(', ')}`,
    warnConsent: (issues: readonly string[]) => `Consent statement: ${issues.join(', ')}`,
    warnMic: 'The consent statement and the sample were recorded with different microphones',
    warnBody: 'You can still save; if it’s rejected, you’ll see why. Recording again is safer.',
    warnBodyLocal: 'You can still save; recording again is better.',
    redoSample: 'Re-record sample',
    skipConsent: 'Skip for now and save',
    name: 'Name',
    namePlaceholder: 'My voice',
    seed: 'Seed',
    reroll: 'New seed',
    rerollLabel: (engine: string) => `New seed for ${engine}`,
    seedNote:
      'Local engines have no voice ID: the same reference plus this seed gives the same speaker every time, one seed per engine. Cloud providers keep the voice ID they return.',
    landingLocal: (names: string) => `${names} · this sample is the reference, each with its own fixed seed`,
    /** 一定要逐字稿的本机引擎：存好后在「编辑」里补。 */
    landingTranscript: (names: string) => `${names} needs a transcript: after saving, add what’s said in the sample under “Edit”`,
    /** 保存这一步每家云端一行：这次会不会上传。 */
    landingUpload: 'Uploaded right after saving to create the clone · keeps the voice ID',
    /** 样本比这家收的长：跟在 `landingUpload` 后面。 */
    firstOnly: (seconds: number) => `uses the first ${seconds} seconds`,
    landingOffline: 'Not connected · not uploaded this time; once connected, upload it from the voice’s ⋯ menu',
    landingUndeclared: 'Not declared as your own voice · nothing is sent; check the statement above to upload it too',
    landingNoClip: 'Consent statement skipped · not uploaded this time; record it later from the voice’s ⋯ menu to upload',
    landingTooShort: (seconds: string, min: number) => `The sample is ${seconds} s and at least ${min} s is needed · not uploaded this time`,
    prev: 'Back',
    next: 'Next',
    save: 'Save voice',
    /** 保存后会立即上传：按钮直接说会发生什么。 */
    saveUpload: (names: string) => `Save and upload to ${names}`,
    cancel: 'Cancel',
    footModels: (names: string) => `For ${names}`,
    footModelsNone: 'Nothing picked: the voice is still saved and can be used later',
    footSample: 'The sample is the base of this voice: cloud providers clone from it, local engines use it as the reference',
    footSampleTaken: (seconds: string) => `Sample ${seconds} s`,
    footConsent: (names: string) => `You can skip this and save; it just won’t be uploaded to ${names} this time`,
    outflowNone: 'Stays on this computer only; nothing is sent to any provider.',
    /** 保存按钮旁边的一句：保存时会发出去什么、发给谁。 */
    outflow: (sampleTo: string, consentTo: string | null) =>
      consentTo
        ? `Saving sends the sample to ${sampleTo} and the consent recording to ${consentTo} to create the clone. Nothing else leaves this computer.`
        : `Saving sends the sample to ${sampleTo} to create the clone. Nothing else leaves this computer.`,
    saved: (name: string) => `Saved “${name}”`,
    savedUploading: (name: string, names: string) => `Saved “${name}” · uploading to ${names}, progress shows under the voice`,
    saveFailed: (message: string) => `Couldn’t save: ${message}`,
    consentTitle: (name: string) => `Record consent statement · ${name}`,
    consentTitleRedo: (name: string) => `Re-record consent statement · ${name}`,
    saveClip: 'Save recording',
    /** 从克隆失败那一块过来：存好后自动重新上传，按钮照实说。 */
    saveClipUpload: (label: string) => `Save and upload to ${label} again`,
    sameSpeaker: (names: string) =>
      `It must be the same person as in the sample. If the sample came from a video, the speaker has to record this part, otherwise ${names} can’t be used.`,
    sameSpeakerAny: 'It must be the same person as in the sample. If the sample came from a video, the speaker has to record this part.',
    consentSaved: (name: string) => `Saved the consent statement for “${name}”`,
    consentSavedUploading: (name: string, label: string) => `Saved the consent statement for “${name}” · uploading to ${label} again`,
    ids: 'Seeds and voice IDs',
    seedGroup: (value: number, engines: string) => `Seed ${value} (${engines})`,
    otherEngines: 'other local engines',
    allEngines: 'local engines',
    voiceIdStale: 'reference changed',
    consentClip: (language: string, seconds: string) => `Consent statement ${language} ${seconds} s`,
    consentClipNoLength: (language: string) => `Consent statement ${language}`,
    customLanguage: 'custom',
    reseed: (engine: string) => `Change seed · ${engine}`,
    reseedNow: (value: number) => `Now ${value}`,
    recordConsent: 'Record consent statement',
    redoConsent: 'Re-record consent statement',
    consentMenuHint: 'Needed by providers that check the speaker’s consent',
    reseeded: (engine: string, value: number) => `${engine} now uses seed ${value}`,
    reseedFailed: (message: string) => `Couldn’t change the seed: ${message}`,
    lineLabel: 'Cloned voices',
    lineNone: 'None yet',
    lineNoneCloud: 'None created with this provider yet',
    lineNew: 'Clone a new voice',
    lineFirst: 'Clone one',
    lineSeed: (value: number) => `seed ${value}`,
    lineSeedRandom: 'random seed',
    handoffFromModel: (name: string) => `From the “${name}” models page · you can go back once it’s saved`,
    handoffSavedModel: (name: string) => `Saved · go back to “${name}”`,
    /** 从模型页那一家云端过来、存好后：克隆在跑、建好了、没建成、这次没上传。 */
    handoffUploading: (label: string) => `Saved · uploading to ${label} to create the clone…`,
    handoffReady: (voice: string, label: string) => `“${voice}” is ready on ${label}`,
    handoffFailed: (voice: string, label: string) => `“${voice}” is saved, but the clone on ${label} wasn’t created · what to do is shown under the voice`,
    handoffNotUploaded: (label: string) => `Saved · not uploaded to ${label} yet; when you’re ready, upload it from the voice’s ⋯ menu`,
    backTo: (name: string) => `Back to “${name}”`,
  },
  /**
   * 克隆没建成（我的声音那一行、回程条）：原因、怎么办与一键补救。按 Runtime 报的错误码与 `details.reason`
   * （命令协议规范 §5 的 `voiceClone` 失败原因）选句子，认不出的给这家通用的建议。
   */
  cloneFailure: {
    /** Provider 的原话，放在最后、字小一些。 */
    detail: (message: string) => `Details: ${message}`,
    speakerMismatch: 'The consent recording and the sample weren’t recognized as the same person.',
    speakerMismatchAdvice:
      'Have the same person record the consent statement again with the same microphone in the same room, in their normal voice. If the sample came from a video, the person in it has to record the statement.',
    consentUnrecognized: 'The consent statement wasn’t recognized.',
    consentUnrecognizedAdvice:
      'Read the official text word for word in one go, without adding or skipping anything; English is the most reliable. A custom sentence won’t pass.',
    sourceDuration: (label: string, range: string | null) =>
      range ? `The sample length doesn’t fit ${label}: it takes ${range}.` : `The sample length doesn’t fit ${label}.`,
    sourceDurationAdvice: (min: number) =>
      `Record a new sample of at least ${min} seconds of one person speaking naturally; longer is fine, the extra is cut off before uploading.`,
    rangeSeconds: (min: number, max: number) => `${min}–${max} seconds`,
    synthetic: 'The sample or consent recording was treated as synthetic or AI-generated audio.',
    syntheticAdvice:
      'Use a real recording of the person: record with the microphone instead of using generated speech or audio taken from a video with music or effects.',
    audioInvalid: (label: string) => `${label} couldn’t read the audio.`,
    audioInvalidAdvice: 'Record a new sample with the microphone, or upload a clean WAV or FLAC file.',
    voiceLimit: (label: string) => `Your ${label} account has reached its limit of cloned voices.`,
    voiceLimitAdvice: 'Delete clones you no longer use (from a voice’s ⋯ menu or in the provider’s console), then upload again.',
    voiceLimitAdviceGoogle:
      'A Google Cloud project holds up to 200 cloned voices. Delete ones you no longer use (from a voice’s ⋯ menu or in the Google console), then upload again.',
    feature: (label: string) => `This ${label} account can’t create cloned voices.`,
    featureAdvice: 'Check the account’s plan, billing and region in the provider’s console, or connect another account.',
    featureAdviceGoogle:
      'Voice cloning needs a paid Google Cloud project (Tier 1 or above) with billing enabled, in a supported region. Upgrade the project or connect another key.',
    auth: (label: string) => `${label} didn’t accept the key.`,
    authAdvice: 'The key may be wrong, expired or restricted. Check it under “API providers”.',
    quota: (label: string) => `${label} is limiting requests right now.`,
    quotaAdvice: 'Wait a minute and upload again. If it keeps happening, check the account’s quota in the provider’s console.',
    unavailable: (label: string) => `${label} didn’t respond properly.`,
    unavailableStatus: (label: string, status: number) => `${label} didn’t respond properly (HTTP ${status}).`,
    unavailableAdvice: 'It’s usually temporary. Check your network and upload again in a moment.',
    consentRequired: 'This voice isn’t marked as your own voice or used with permission, so it wasn’t uploaded.',
    consentRequiredAdvice: 'Check the statement in “Edit”, then upload again.',
    clipRequired: (label: string) => `${label} needs a recording of the speaker reading the consent statement, and this voice doesn’t have one.`,
    clipRequiredAdvice: 'Record it with the same person as in the sample; it’s uploaded right after saving.',
    notConfigured: (label: string) => `${label} isn’t set up on this computer.`,
    notConfiguredAdvice: 'Enable it and add an account under “API providers”, then upload again.',
    grant: (label: string) => `Sending recordings to ${label} isn’t allowed right now.`,
    grantAdvice: 'Check the outbound grant for this provider under Settings › Privacy and permissions, then upload again.',
    budget: (label: string) => `The spending limit for ${label} has been reached.`,
    budgetAdvice: 'Check the limit under Settings › Privacy and permissions, then upload again.',
    unsupported: (label: string) => `This Runtime can’t clone on ${label}.`,
    rejected: (label: string) => `${label} turned down the clone.`,
    failed: (label: string) => `Creating the clone on ${label} failed.`,
    adviceGoogle: (min: number, max: number) =>
      `${min}–${max} seconds of one adult speaking naturally in a quiet room usually works. Record the consent statement with the same microphone in the same room, read the official text word for word (English is the most reliable), and use real recordings only. The Google Cloud project also has to be on a paid tier (Tier 1 or above) and hold fewer than 200 cloned voices.`,
    advice: 'Use a clean recording of one person speaking naturally in a quiet room, then upload again.',
    fixReconsent: 'Re-record the consent statement and upload again',
    fixRecordConsent: 'Record the consent statement and upload',
    fixResample: 'Record a new sample',
    fixRetry: (label: string) => `Upload to ${label} again`,
    fixProvider: (label: string) => `Open ${label} settings`,
    fixPrivacy: 'Open Privacy and permissions',
    fixEdit: 'Edit voice',
  },
};

export type VoicesMessages = typeof en;

const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

export const MY_VOICES_COPY = live(() => M.myVoices);
export const CAPTURE_COPY = live(() => M.capture);
export const CLONE_FAILURE_COPY = live(() => M.cloneFailure);
