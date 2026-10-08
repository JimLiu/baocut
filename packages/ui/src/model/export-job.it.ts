import type { ExportJobMessages } from './export-job.ts';
import { pluralForm } from '@baocut/protocol';

export const it: ExportJobMessages = {
  tabVideo: 'Video', tabAudio: 'Audio', tabSubtitles: 'Sottotitoli', tabTranscript: 'Trascrizione', tabProject: 'File del progetto', export: 'Esporta', queued: 'Esportazione in coda', exporting: 'Esportazione in corso…', exportingPct: (pct: number) => `Esportazione · ${pct}%`,
  formats: { md: 'Markdown', txt: 'Testo semplice', xmeml: 'FCP7 XML' },
  titleVideo: (format: string) => `Esporta video · ${format}`, titleAudio: (format: string) => `Esporta audio · ${format}`, titleSubtitles: (format: string) => `Esporta sottotitoli · ${format}`, titleTranscript: (format: string) => `Esporta trascrizione · ${format}`, titlePortable: 'Esporta pacchetto portatile', titleProject: (format: string) => `Esporta file del progetto · ${format}`,
  generating: { video: 'Codifica in corso', audio: 'Mixaggio in corso', subtitles: 'Scrittura dei file', transcript: 'Scrittura dei file', portable: 'Creazione del pacchetto', project: 'Scrittura del file del progetto' },
  retrying: 'Nuovo tentativo automatico dopo un errore', saving: 'Salvataggio dei file',
  framesOf: (done: string, total: string) => `Fotogrammi renderizzati: ${done} / ${total}`, frames: (done: string) => `Fotogrammi renderizzati: ${done}`,
  secondsOf: (done: string, total: string) => `Elaborato: ${done} / ${total}`, seconds: (done: string) => `Elaborato: ${done}`,
  outputsOf: (done: number, total: number) => pluralForm('it', total, { one: `Scritto ${done} / ${total} file`, other: `Scritti ${done} / ${total} file` }),
  outputs: (done: number) => pluralForm('it', done, { one: `${done} file scritto`, other: `${done} file scritti` }),
  bytesOf: (done: string, total: string) => `Incluso nel pacchetto: ${done} / ${total}`, bytes: (done: string) => `Incluso nel pacchetto: ${done}`,
  mono: 'Mono', stereo: 'Stereo',
  entries: (n: number) => pluralForm('it', n, { one: `${n} voce`, other: `${n} voci` }), files: (n: number) => `${n} file`,
  assetRevisions: (n: number) => pluralForm('it', n, { one: `${n} versione del materiale`, other: `${n} versioni dei materiali` }), missing: (n: number) => pluralForm('it', n, { one: `${n} mancante`, other: `${n} mancanti` }), clips: (n: number) => `${n} clip`,
  omitted: (n: number) => pluralForm('it', n, { one: `${n} elemento non scritto nel file del progetto`, other: `${n} elementi non scritti nel file del progetto` }),
  doneMany: (n: number, total: string) => `${n} file · ${total} totali`,
  cancelledKept: (n: number) => n === 1 ? 'Il file salvato viene conservato · Il video non cambia' : pluralForm('it', n, { other: `I ${n} file salvati vengono conservati · Il video non cambia` }),
  cancelledRemoved: 'I file non completati sono stati eliminati · Il video non cambia',
};
