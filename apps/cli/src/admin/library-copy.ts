import { defineMessages, type LibraryName, type VoiceCloneRemoveResult } from '@baocut/protocol';
import { zhHans } from './library-copy.zh-Hans.ts';
import { zhHant } from './library-copy.zh-Hant.ts';
import { ja } from './library-copy.ja.ts';
import { ko } from './library-copy.ko.ts';
import { es } from './library-copy.es.ts';
import { fr } from './library-copy.fr.ts';
import { de } from './library-copy.de.ts';
import { nl } from './library-copy.nl.ts';
import { ptBR } from './library-copy.pt-BR.ts';
import { it } from './library-copy.it.ts';
import { ru } from './library-copy.ru.ts';
import { pl } from './library-copy.pl.ts';
import { tr } from './library-copy.tr.ts';
import { vi } from './library-copy.vi.ts';

/** 管理桶 `baocut library …` 的文案（英文是键与类型的来源，译文在 `library-copy.<语言>.ts`）。 */
const en = {
  help: `Usage:
  baocut library import <file>     Import an exchange file, with its type detected by content (not
                                   extension): Markdown glossaries, .bcvoice voice packs, brand kit
                                   color and subtitle style JSON, Lottie stickers, images, videos, fonts
  baocut library export <library> <id> <path>
                                   Export the current version: glossaries as Markdown, voices as .bcvoice,
                                   brand assets as the original file; an existing target isn't overwritten
  baocut library remove <library> <id>
                                   Delete an entry (content already copied into videos isn't affected)
  baocut library voice-clone <voice id> --provider <id> [--name <name>]
                                   Upload the voice's reference recording to the provider to create a clone
                                   (only elevenlabs for now): requires a consent statement and a data-sharing
                                   grant covering "audio" (baocut grants create); runs as a task, Ctrl-C cancels
  baocut library voice-clone-remove <voice id> --provider <id> [--local-only]
                                   Delete a clone: asks the provider to delete it first, then clears
                                   the record on success; --local-only only clears the local record
  baocut library video-selection <video id> [options]
                                   Library entries enabled in the video (stored in the video, undoable): shown when no
                                   options are given; the parts given are replaced as a whole, the rest stay as they are.
                                   New videos automatically enable glossaries marked "on by default" in the library
    --transcribe-glossaries <id,…> Transcription glossaries (used when a transcription
                                   doesn't specify one); an empty string clears them
    --translate-glossaries <id,…>  Translation glossaries (used by translate and by
                                   dub's translation); an empty string clears them
    --speaker-voice <transcript id>:<speaker>=<voice>[@<Provider>]
                                   A speaker's voice (repeatable, replaced as a whole):
                                   library:<id> or a provider's voice ID (then with @Provider)
    --clear-speaker-voices         Clear speaker voices`,
  importUsage: 'Usage: baocut library import <file>',
  exportUsage: 'Usage: baocut library export <glossaries|voices|brand> <id> <path>',
  removeUsage: 'Usage: baocut library remove <glossaries|voices|brand> <id>',
  voiceCloneUsage: 'Usage: baocut library voice-clone <voice id> --provider <id> [--name <name>]',
  voiceCloneRemoveUsage: 'Usage: baocut library voice-clone-remove <voice id> --provider <id> [--local-only]',
  videoSelectionUsage: 'Usage: baocut library video-selection <video id> [--translate-glossaries <id,…>] [--speaker-voice …]…',
  imported: (label: string, id: string, name: string) => `Imported into ${label}: ${id}  ${name}`,
  exported: (id: string, version: string | number, file: string, bytes: number) =>
    `Exported ${id} version ${version} to ${file} (${bytes} ${bytes === 1 ? 'byte' : 'bytes'})`,
  deleted: (id: string) => `Deleted ${id}`,
  remoteCloneOutcome: {
    deleted: 'deleted remotely',
    'not-found': 'the voice was already gone remotely',
    skipped: 'remote not contacted',
  } satisfies Record<VoiceCloneRemoveResult['remote'], string>,
  voiceCloneRemoved: (id: string, provider: string, remote: string) => `Deleted the clone of ${id} on ${provider} (${remote})`,
  libraryLabels: { glossaries: 'Glossary', voices: 'Voice', brand: 'Brand kit' } satisfies Record<LibraryName, string>,
  unknownLibrary: (text: string | undefined) => `No such library: ${text ?? '(missing)'}. Available: glossaries, voices, brand`,
  speakerVoiceFormat: (text: string) => `--speaker-voice takes <transcript id>:<speaker>=<voice>[@<Provider>]; got ${text}`,
  listSep: ', ',
  none: '(none)',
  selectionHead: (videoId: string, documentId: string | null, revision: string | number | null) =>
    `Video ${videoId}${documentId ? ` (library-selection document ${documentId} version ${revision})` : ' (nothing enabled yet)'}`,
  transcribeGlossaries: (list: string) => `Transcription glossaries: ${list}`,
  translateGlossaries: (list: string) => `Translation glossaries: ${list}`,
  speakerVoicesNone: 'Speaker voices: (none)',
  speakerVoice: (documentId: string, speakerId: string, voice: string, providerId: string | null) =>
    `Speaker voice: ${documentId}:${speakerId} = ${voice}${providerId ? ` (only on ${providerId})` : ''}`,
};

export type LibraryMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
