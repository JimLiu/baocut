import type { LibraryMessages } from './library-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const de: LibraryMessages = {
  help: `Verwendung:
  baocut library import <file>     Austauschdatei anhand ihres Inhalts importieren (nicht anhand der
                                   Erweiterung): Markdown-Glossare, .bcvoice-Stimmenpakete, Farben und Untertitelstil-JSON
                                   für das Marken-Kit, Lottie-Sticker, Bilder, Videos und Schriften
  baocut library export <library> <id> <path>
                                   Aktuelle Version exportieren: Glossare als Markdown, Stimmen als .bcvoice,
                                   Markenmaterialien als Originaldatei; vorhandene Ziele werden nicht überschrieben
  baocut library remove <library> <id>
                                   Eintrag löschen (bereits in Videos kopierte Inhalte bleiben erhalten)
  baocut library voice-clone <voice id> --provider <id> [--name <name>]
                                   Referenzaufnahme an den Anbieter senden, um einen Klon zu erstellen
                                   (derzeit nur elevenlabs): benötigt Zustimmungserklärung und Datenweitergabeberechtigung
                                   für "audio" (baocut grants create); läuft als Aufgabe, Ctrl-C bricht ab
  baocut library voice-clone-remove <voice id> --provider <id> [--local-only]
                                   Klon löschen: zuerst den Anbieter um Löschung bitten, danach bei Erfolg den
                                   Beleg entfernen; --local-only entfernt nur den lokalen Beleg
  baocut library video-selection <video id> [options]
                                   Im Video aktivierte Bibliothekseinträge (im Video gespeichert, rückgängig machbar): ohne Optionen
                                   anzeigen; angegebene Bereiche werden vollständig ersetzt, der Rest bleibt gleich.
                                   Neue Videos aktivieren automatisch als "standardmäßig aktiv" markierte Glossare
    --transcribe-glossaries <id,…> Transkriptionsglossare (wenn bei der Transkription
                                   keine angegeben sind); eine leere Zeichenfolge entfernt sie
    --translate-glossaries <id,…>  Übersetzungsglossare (für translate und die
                                   Übersetzung von dub); eine leere Zeichenfolge entfernt sie
    --speaker-voice <transcript id>:<speaker>=<voice>[@<Provider>]
                                   Stimme eines Sprechers (wiederholbar, vollständig ersetzt):
                                   library:<id> oder Anbieter-Stimmen-ID (dann mit @Provider)
    --clear-speaker-voices         Sprecherstimmen entfernen`, importUsage: 'Verwendung: baocut library import <file>', exportUsage: 'Verwendung: baocut library export <glossaries|voices|brand> <id> <path>', removeUsage: 'Verwendung: baocut library remove <glossaries|voices|brand> <id>', voiceCloneUsage: 'Verwendung: baocut library voice-clone <voice id> --provider <id> [--name <name>]', voiceCloneRemoveUsage: 'Verwendung: baocut library voice-clone-remove <voice id> --provider <id> [--local-only]', videoSelectionUsage: 'Verwendung: baocut library video-selection <video id> [--translate-glossaries <id,…>] [--speaker-voice …]…', imported: (label, id, name) => `In ${label} importiert: ${id}  ${name}`, exported: (id, version, file, bytes) => `${id}, Version ${version}, nach ${file} exportiert (${bytes} ${pluralForm('de', bytes, { one: 'Byte', other: 'Bytes' })})`, deleted: (id) => `Gelöscht: ${id}`, remoteCloneOutcome: { deleted: 'entfernt gelöscht', 'not-found': 'Stimme war entfernt bereits gelöscht', skipped: 'Anbieter nicht kontaktiert' }, voiceCloneRemoved: (id, provider, remote) => `Klon von ${id} bei ${provider} gelöscht (${remote})`, libraryLabels: { glossaries: 'Glossar', voices: 'Stimme', brand: 'Marken-Kit' }, unknownLibrary: (text) => `Unbekannte Bibliothek: ${text ?? '(fehlt)'}. Verfügbar: glossaries, voices, brand`, speakerVoiceFormat: (text) => `--speaker-voice erwartet <transcript id>:<speaker>=<voice>[@<Provider>]; erhalten: ${text}`, listSep: ', ', none: '(keine)', selectionHead: (videoId, documentId, revision) => `Video ${videoId}${documentId ? ` (library-selection-Dokument ${documentId}, Version ${revision})` : ' (noch nichts aktiviert)'}`, transcribeGlossaries: (list) => `Transkriptionsglossare: ${list}`, translateGlossaries: (list) => `Übersetzungsglossare: ${list}`, speakerVoicesNone: 'Sprecherstimmen: (keine)', speakerVoice: (documentId, speakerId, voice, providerId) => `Sprecherstimme: ${documentId}:${speakerId} = ${voice}${providerId ? ` (nur bei ${providerId})` : ''}`,
};
