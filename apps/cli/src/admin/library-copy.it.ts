import type { LibraryMessages } from './library-copy.ts';

export const it: LibraryMessages = {
  help: `Uso:
  baocut library import <file>     Importa un file di scambio, rilevandone il tipo dal contenuto (non dall’estensione):
                                   glossari Markdown, pacchetti voce .bcvoice, JSON di colori e stili dei sottotitoli
                                   del kit del brand, adesivi Lottie, immagini, video, font
  baocut library export <library> <id> <path>
                                   Esporta la versione attuale: glossari come Markdown, voci come .bcvoice,
                                   materiali del brand come file originale; non sovrascrive una destinazione esistente
  baocut library remove <library> <id>
                                   Elimina una voce (i contenuti già copiati nei video non cambiano)
  baocut library voice-clone <voice id> --provider <id> [--name <name>]
                                   Carica la registrazione di riferimento della voce sul provider per creare un clone
                                   (per ora solo elevenlabs): richiede una dichiarazione di consenso e un’autorizzazione
                                   alla condivisione che includa "audio" (baocut grants create); esegue come attività, Ctrl-C annulla
  baocut library voice-clone-remove <voice id> --provider <id> [--local-only]
                                   Elimina un clone: prima chiede al provider di eliminarlo, poi cancella
                                   il registro in caso di successo; --local-only cancella solo il registro locale
  baocut library video-selection <video id> [options]
                                   Voci della libreria attivate nel video (memorizzate nel video, annullabili): mostrate senza
                                   opzioni; le parti indicate vengono sostituite interamente, le altre rimangono invariate.
                                   I nuovi video attivano automaticamente i glossari indicati nella libreria come attivi per impostazione predefinita
    --transcribe-glossaries <id,…> Glossari di trascrizione (usati quando la trascrizione non ne
                                   specifica uno); una stringa vuota li cancella
    --translate-glossaries <id,…>  Glossari di traduzione (usati da translate e dalla traduzione
                                   di dub); una stringa vuota li cancella
    --speaker-voice <transcript id>:<speaker>=<voice>[@<Provider>]
                                   Voce di un parlante (ripetibile, sostituita interamente):
                                   library:<id> o ID voce di un provider (con @Provider)
    --clear-speaker-voices         Cancella le voci dei parlanti`,
  importUsage: 'Uso: baocut library import <file>', exportUsage: 'Uso: baocut library export <glossaries|voices|brand> <id> <path>', removeUsage: 'Uso: baocut library remove <glossaries|voices|brand> <id>', voiceCloneUsage: 'Uso: baocut library voice-clone <voice id> --provider <id> [--name <name>]', voiceCloneRemoveUsage: 'Uso: baocut library voice-clone-remove <voice id> --provider <id> [--local-only]', videoSelectionUsage: 'Uso: baocut library video-selection <video id> [--translate-glossaries <id,…>] [--speaker-voice …]…',
  imported: (label: string, id: string, name: string) => `Importato in ${label}: ${id}  ${name}`, exported: (id: string, version: string | number, file: string, bytes: number) => `Esportato ${id} versione ${version} in ${file} (${bytes} byte)`, deleted: (id: string) => `Eliminato: ${id}`, remoteCloneOutcome: { deleted: 'eliminato da remoto', 'not-found': 'la voce non esisteva più da remoto', skipped: 'servizio remoto non contattato' }, voiceCloneRemoved: (id: string, provider: string, remote: string) => `Clone di ${id} su ${provider} eliminato (${remote})`, libraryLabels: { glossaries: 'Glossario', voices: 'Voce', brand: 'Kit del brand' }, unknownLibrary: (text: string | undefined) => `Nessuna libreria corrispondente: ${text ?? '(mancante)'}. Disponibili: glossaries, voices, brand`, speakerVoiceFormat: (text: string) => `--speaker-voice accetta <transcript id>:<speaker>=<voice>[@<Provider>]; ricevuto ${text}`, listSep: ', ', none: '(nessuno)',
  selectionHead: (videoId: string, documentId: string | null, revision: string | number | null) => `Video ${videoId}${documentId ? ` (documento library-selection ${documentId} versione ${revision})` : ' (nessuna voce ancora attivata)'}`, transcribeGlossaries: (list: string) => `Glossari di trascrizione: ${list}`, translateGlossaries: (list: string) => `Glossari di traduzione: ${list}`, speakerVoicesNone: 'Voci dei parlanti: (nessuna)', speakerVoice: (documentId: string, speakerId: string, voice: string, providerId: string | null) => `Voce del parlante: ${documentId}:${speakerId} = ${voice}${providerId ? ` (solo su ${providerId})` : ''}`,
};
