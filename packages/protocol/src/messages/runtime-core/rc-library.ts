import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-library.zh-Hans.ts';
import { zhHant } from './rc-library.zh-Hant.ts';
import { ja } from './rc-library.ja.ts';
import { ko } from './rc-library.ko.ts';
import { es } from './rc-library.es.ts';
import { fr } from './rc-library.fr.ts';
import { de } from './rc-library.de.ts';
import { nl } from './rc-library.nl.ts';
import { ptBR } from './rc-library.pt-BR.ts';
import { it } from './rc-library.it.ts';
import { ru } from './rc-library.ru.ts';
import { pl } from './rc-library.pl.ts';
import { tr } from './rc-library.tr.ts';
import { vi } from './rc-library.vi.ts';

/** 用户库与音色克隆（library/）的错误。英文是键与类型的来源，译文在 `rc-library.<语言>.ts`。 */
const en = {
  // 用户库（library-service）
  problemSeparator: '; ',
  referenceUndecodable: (p: { problems: string }) => `The reference recording can't be decoded: ${p.problems}`,
  clonesNotReady: "Voice cloning isn't ready yet",
  entryHasNoFile: "This entry doesn't have a file",
  notCopyable: (p: { library: string }) =>
    `${p.library === 'glossaries' ? 'Glossaries' : p.library === 'voices' ? 'Voices' : 'Colors'} can't be copied into a video directly: glossaries are chosen when transcribing and translating, voices when synthesizing speech, and colors when editing styles`,
  captionItemIdsStyleOnly: 'captionItemIds only applies to subtitle styles',
  addFromLibraryLabel: (p: { name: string }) => `Add "${p.name}" from the library`,
  duplicateGlossaries: (p: { step: string }) => `glossaries.${p.step} lists the same glossary more than once`,
  tooManyGlossaries: (p: { max: number }) => `Each step can use at most ${p.max} glossaries`,
  glossaryWrongStep: (p: { name: string; transcription: boolean; transcribeStep: boolean }) =>
    `"${p.name}" is a ${p.transcription ? 'transcription' : 'translation'} glossary and can't be used for ${p.transcribeStep ? 'transcription' : 'translation'}`,
  selectionDocumentName: 'Library items in use',
  changeSelectionLabel: 'Change library items in use',
  adoptDefaultsLabel: "Use the library's default items",
  noDocumentIdAfterWrite: "Didn't get a document ID after writing",
  speakerBoundTwice: (p: { speakerId: string }) => `Speaker ${p.speakerId} is assigned twice`,
  noSuchDocument: (p: { documentId: string }) => `The video has no document ${p.documentId}`,
  documentNotSpeech: (p: { documentId: string; kind: string }) =>
    `Document ${p.documentId} is ${p.kind}; speakers only exist in transcripts (speech)`,
  speakerNotInTranscript: (p: { documentId: string; speakerId: string }) =>
    `Transcript ${p.documentId} has no speaker ${p.speakerId}`,
  libraryVoiceNoProvider:
    "Library voices are swapped for the clone on the provider chosen for the voice-over: don't pass providerId",
  outputNotFound: "The output doesn't exist",
  pathNotAbsolute: 'The file path must be absolute',

  // 音色克隆（voice-clone-service）
  serviceClientNoLibraryVoice: "Clients of external services can't use voices from the library",
  clonerNotConfigured: (p: { label: string }) => `${p.label} isn't turned on or has no key, so voices can't be cloned`,
  cloneExists: (p: { name: string; label: string }) => `Voice "${p.name}" already has a valid clone on ${p.label}`,
  clonePurpose: (p: { name: string }) => `Clone voice "${p.name}"`,
  noClone: "This voice has no clone on this provider",
  remoteCloneNotDeleted: (p: { label: string; reason: string }) =>
    `The clone on ${p.label} wasn't deleted, so the record was kept: ${p.reason}`,
  cloneUnsupported: (p: { providerId: string }) => `${p.providerId} has no voice cloning API (only ElevenLabs offers one for now)`,
  cloneVersionGone: 'The voice version to clone no longer exists',
  oldCloneNotDeleted: (p: { voiceId: string; label: string; reason: string }) =>
    `The replaced old clone (${p.voiceId}) wasn't deleted from ${p.label}: ${p.reason}`,
};

export type RcLibraryMessages = typeof en;

export const RcLibrary = defineCatalog('rcLibrary', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
