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
 * 这里是列表、对话框与提示。录音与「从视频里分人取一段」还没有接上，置灰的原因写成如实的一句。
 * 英文是键与类型的来源，译文在 `voices-copy.<语言>.ts`。
 */
const en = {
  myVoices: {
    offline: 'Voices appear once the Runtime is connected.',
    add: 'Add voice',
    fromFile: 'New from audio file…',
    fromFileHint: 'WAV, MP3 or FLAC, up to 20 MB; one full sentence of 5–12 seconds works best',
    importPackage: 'Import voice pack…',
    importHint: 'A .bcvoice someone exported',
    record: 'Record with microphone',
    recordWhy:
      'Recording in the app isn’t available yet: a recording has to be saved as a file before it can go to the Runtime, and that step isn’t built. Record with another app first (WAV, MP3 or FLAC), then use “New from audio file”.',
    /** `recordWhy` 加上导入音色包为什么不可用（窗口不能打开文件对话框时）。 */
    recordWhyNoPicker:
      'Recording in the app isn’t available yet: a recording has to be saved as a file before it can go to the Runtime, and that step isn’t built. Record with another app first (WAV, MP3 or FLAC), then use “New from audio file”. Importing a voice pack: this window can’t open the system file dialog; use the desktop app.',
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
    cloneFailed: (label: string, text: string) => `The last clone on ${label} didn't succeed: ${text}`,
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
    cloneStarted: (label: string) => `Uploading to ${label} · progress is in Background tasks`,
    cloneRejected: (text: string) => `Couldn't start cloning: ${text}`,
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
};

export type VoicesMessages = typeof en;

const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

export const MY_VOICES_COPY = live(() => M.myVoices);
