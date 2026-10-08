import type { JobsTranslateSubtitlesMessages } from './translate-subtitles.ts';
import { pluralForm } from '../../i18n.ts';

export const it: JobsTranslateSubtitlesMessages = {
  label: 'Traduci file di sottotitoli',
  description: 'Traduce un file di sottotitoli SRT o WebVTT in un’altra lingua, sottotitolo per sottotitolo, e scrive un nuovo file. Il numero dei sottotitoli e i timecode rimangono invariati; il risultato può essere bilingue o in un altro formato. Il video non viene modificato.',
  stepRead: 'Leggi sottotitoli', stepTranslate: 'Traduci', stepCheck: 'Verifica', stepPublish: 'Pubblica',
  noStructuredOutput: (p) => `Il modello ${p.model} non supporta l’output strutturato e non può essere usato per la traduzione`,
  artifactGone: (p) => `Il risultato ${p.artifactId} non esiste più`,
  paramNotAbsolute: (p) => `Il parametro ${p.key} deve essere un percorso assoluto`, inputNotSubtitle: 'Il parametro input deve essere un file .srt o .vtt',
  languageInvalid: (p) => `Il parametro ${p.key} deve essere un tag di lingua BCP 47`, bilingualInvalid: 'Il parametro bilingual deve essere true o false',
  fileNotFound: (p) => `Impossibile trovare il file di sottotitoli ${p.file}`,
  fileTooLarge: (p) => `Il file dei sottotitoli ha ${p.bytes} B, oltre il limite di ${p.limit}`,
  noText: 'Il file dei sottotitoli non ha testo da tradurre', allEmpty: 'Ogni sottotitolo è vuoto',
  markupStripped: (p) => pluralForm('it', p.count, { one: `${p.count} sottotitolo aveva marcatori inline (corsivo, colore, posizione ecc.) non conservati nella traduzione`, other: `${p.count} sottotitoli avevano marcatori inline (corsivo, colore, posizione ecc.) non conservati nella traduzione` }),
  cueNoTranslation: (p) => `Il sottotitolo ${p.n} non ha una traduzione`, rereadFailed: 'Impossibile rileggere i sottotitoli scritti',
  cueCountMismatch: (p) => `Scritti ${pluralForm('it', p.written, { one: `${p.written} sottotitolo`, other: `${p.written} sottotitoli` })}; il file originale ne ha ${p.original}`,
  timingChanged: (p) => `Il timecode del sottotitolo ${p.n} è cambiato: ${p.from} → ${p.to}`,
  cannotMatch: 'La traduzione non può essere scritta come sottotitoli che corrispondano uno a uno al file originale',
  settingsDropped: (p) => `Convertito in SRT: cue settings di ${pluralForm('it', p.settings, { one: `${p.settings} sottotitolo`, other: `${p.settings} sottotitoli` })} e ${pluralForm('it', p.blocks, { one: `${p.blocks} blocco`, other: `${p.blocks} blocchi` })} NOTE, STYLE e REGION non rientrano e non sono stati conservati`,
};
