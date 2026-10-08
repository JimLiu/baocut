import type { LibraryMessages } from './library-copy.ts';
import { pluralForm } from '@baocut/protocol';
export const nl: LibraryMessages = {
 help: `Gebruik:
  baocut library import <file>     Een uitwisselingsbestand importeren; het type wordt bepaald door de inhoud (niet
                                   de extensie): Markdown-woordenlijsten, .bcvoice-stempakketten, JSON voor
                                   merkkitkleuren en ondertitelstijlen, Lottie-stickers, afbeeldingen, video’s en lettertypen
  baocut library export <library> <id> <path>
                                   De huidige versie exporteren: woordenlijsten als Markdown, stemmen als .bcvoice,
                                   merkmedia als het oorspronkelijke bestand; bestaande doelen worden niet overschreven
  baocut library remove <library> <id>
                                   Een item verwijderen (inhoud die al naar video’s is gekopieerd blijft ongewijzigd)
  baocut library voice-clone <voice id> --provider <id> [--name <name>]
                                   De referentieopname naar de aanbieder uploaden om een stem te klonen
                                   (nu alleen elevenlabs): vereist een toestemmingsverklaring en toestemming voor
                                   het delen van "audio" (baocut grants create); wordt een taak, Ctrl-C annuleert
  baocut library voice-clone-remove <voice id> --provider <id> [--local-only]
                                   Een kloon verwijderen: eerst de aanbieder vragen deze te verwijderen; daarna
                                   bij succes het record wissen; --local-only wist alleen het lokale record
  baocut library video-selection <video id> [options]
                                   Bibliotheekitems die in de video zijn ingeschakeld (in de video opgeslagen, ongedaan te maken): zonder
                                   opties getoond; opgegeven onderdelen worden volledig vervangen, de rest blijft staan.
                                   Nieuwe video’s schakelen woordenlijsten met "standaard aan" automatisch in
    --transcribe-glossaries <id,…> Transcriptiewoordenlijsten (gebruikt als een transcript
                                   er geen opgeeft); een lege tekst wist ze
    --translate-glossaries <id,…>  Vertaalwoordenlijsten (gebruikt door translate en door
                                   de vertaling van dub); een lege tekst wist ze
    --speaker-voice <transcript id>:<speaker>=<voice>[@<Provider>]
                                   Stem van een spreker (herhaalbaar, volledig vervangen):
                                   library:<id> of een stem-id van een aanbieder (dan met @Provider)
    --clear-speaker-voices         Sprekerstemmen wissen`,
 importUsage: 'Gebruik: baocut library import <file>', exportUsage: 'Gebruik: baocut library export <glossaries|voices|brand> <id> <path>', removeUsage: 'Gebruik: baocut library remove <glossaries|voices|brand> <id>', voiceCloneUsage: 'Gebruik: baocut library voice-clone <voice id> --provider <id> [--name <name>]', voiceCloneRemoveUsage: 'Gebruik: baocut library voice-clone-remove <voice id> --provider <id> [--local-only]', videoSelectionUsage: 'Gebruik: baocut library video-selection <video id> [--translate-glossaries <id,…>] [--speaker-voice …]…', imported: (label, id, name) => `Geïmporteerd in ${label}: ${id}  ${name}`, exported: (id, version, file, bytes) => `${id} versie ${version} geëxporteerd naar ${file} (${bytes} ${pluralForm('nl', bytes, { one: 'byte', other: 'bytes' })})`, deleted: (id) => `${id} verwijderd`, remoteCloneOutcome: { deleted: 'op afstand verwijderd', 'not-found': 'de stem was op afstand al weg', skipped: 'geen contact met de externe aanbieder' }, voiceCloneRemoved: (id, provider, remote) => `Kloon van ${id} bij ${provider} verwijderd (${remote})`, libraryLabels: { glossaries: 'Woordenlijst', voices: 'Stem', brand: 'Merkkit' }, unknownLibrary: (text) => `Onbekende bibliotheek: ${text ?? '(ontbreekt)'}. Beschikbaar: glossaries, voices, brand`, speakerVoiceFormat: (text) => `--speaker-voice accepteert <transcript id>:<speaker>=<voice>[@<Provider>]; ontvangen ${text}`, listSep: ', ', none: '(geen)', selectionHead: (videoId, documentId, revision) => `Video ${videoId}${documentId ? ` (library-selection-document ${documentId} versie ${revision})` : ' (nog niets ingeschakeld)'}`, transcribeGlossaries: (list) => `Transcriptiewoordenlijsten: ${list}`, translateGlossaries: (list) => `Vertaalwoordenlijsten: ${list}`, speakerVoicesNone: 'Sprekerstemmen: (geen)', speakerVoice: (documentId, speakerId, voice, providerId) => `Sprekerstem: ${documentId}:${speakerId} = ${voice}${providerId ? ` (alleen bij ${providerId})` : ''}`,
};
