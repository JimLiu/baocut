import { pluralForm } from '@baocut/protocol';
import type { LibraryMessages } from './library-copy.ts';

export const pl: LibraryMessages = {
  help: "Użycie:\n  baocut library import <file>     Importuj plik wymiany; typ wykrywany z zawartości, nie rozszerzenia:\n                                   słowniki Markdown, głosy .bcvoice, kolory i style napisów JSON zestawu marki,\n                                   naklejki Lottie, obrazy, wideo, czcionki\n  baocut library export <library> <id> <path>\n                                   Eksportuj obecną wersję: słowniki Markdown, głosy .bcvoice,\n                                   materiały marki jako plik oryginalny; istniejący cel bez nadpisywania\n  baocut library remove <library> <id>\n                                   Usuń wpis (treść skopiowana do wideo bez zmian)\n  baocut library voice-clone <voice id> --provider <id> [--name <name>]\n                                   Prześlij nagranie referencyjne dostawcy, aby sklonować (na razie tylko elevenlabs):\n                                   wymaga oświadczenia zgody i uprawnienia wysyłania danych z \"audio\"\n                                   (baocut grants create); działa jako zadanie, Ctrl-C anuluje\n  baocut library voice-clone-remove <voice id> --provider <id> [--local-only]\n                                   Usuń klon: najpierw poproś dostawcę o usunięcie, potem wyczyść zapis\n                                   po sukcesie; --local-only czyści tylko zapis lokalny\n  baocut library video-selection <video id> [options]\n                                   Włączone w wideo elementy biblioteki (zapisane w wideo, można cofnąć): bez parametrów\n                                   pokazuje; podane części zastępuje w całości, resztę zachowuje.\n                                   Nowe wideo włącza słowniki z oznaczeniem „domyślnie włączone”\n    --transcribe-glossaries <id,…> Słowniki transkrypcji (jeśli transkrypcja nie podaje własnego);\n                                   pusty ciąg czyści\n    --translate-glossaries <id,…>  Słowniki tłumaczenia (dla translate i tłumaczenia dub);\n                                   pusty ciąg czyści\n    --speaker-voice <transcript id>:<speaker>=<voice>[@<Provider>]\n                                   Głos mówcy (powtarzalny, zastępowany w całości):\n                                   library:<id> lub ID głosu dostawcy (z @Provider)\n    --clear-speaker-voices         Wyczyść głosy mówców",
  importUsage: "Użycie: baocut library import <file>",
  exportUsage: "Użycie: baocut library export <glossaries|voices|brand> <id> <path>",
  removeUsage: "Użycie: baocut library remove <glossaries|voices|brand> <id>",
  voiceCloneUsage: "Użycie: baocut library voice-clone <voice id> --provider <id> [--name <name>]",
  voiceCloneRemoveUsage: "Użycie: baocut library voice-clone-remove <voice id> --provider <id> [--local-only]",
  videoSelectionUsage: "Użycie: baocut library video-selection <video id> [--translate-glossaries <id,…>] [--speaker-voice …]…",
  imported: (label, id, name) => `Zaimportowano do ${label}: ${id}  ${name}`,
  exported: (id, version, file, bytes) => `Wyeksportowano ${id} wersja ${version} do ${file} (${pluralForm('pl', bytes, { one: `${bytes} bajt`, few: `${bytes} bajty`, many: `${bytes} bajtów`, other: `${bytes} bajtu` })})`,
  deleted: (id) => `Usunięto: ${id}`,
  remoteCloneOutcome: { deleted: "usunięto zdalnie", 'not-found': "głos już nie istniał zdalnie", skipped: "bez kontaktu z usługą zdalną" },
  voiceCloneRemoved: (id, provider, remote) => `Usunięto klon głosu ${id} u dostawcy ${provider} (${remote})`,
  libraryLabels: { glossaries: "Słownik", voices: "Głos", brand: "Zestaw marki" },
  unknownLibrary: (text) => `Brak takiej biblioteki: ${text ?? '(missing)'}. Dostępne: glossaries, voices, brand`,
  speakerVoiceFormat: (text) => `--speaker-voice przyjmuje <transcript id>:<speaker>=<voice>[@<Provider>]; otrzymano ${text}`,
  listSep: ", ",
  none: "(brak)",
  selectionHead: (videoId, documentId, revision) => `Wideo ${videoId}${documentId ? ` (dokument library-selection ${documentId} wersja ${revision})` : " (nic jeszcze niewłączone)"}`,
  transcribeGlossaries: (list) => `Słowniki transkrypcji: ${list}`,
  translateGlossaries: (list) => `Słowniki tłumaczenia: ${list}`,
  speakerVoicesNone: "Głosy mówców: (brak)",
  speakerVoice: (documentId, speakerId, voice, providerId) => `Głos mówcy: ${documentId}:${speakerId} = ${voice}${providerId ? ` (tylko u dostawcy ${providerId})` : ""}`,
};
