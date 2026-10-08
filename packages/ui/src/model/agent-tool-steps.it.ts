import type { AgentToolStepsMessages } from './agent-tool-steps.ts';
import { pluralForm } from '@baocut/protocol';

export const it: AgentToolStepsMessages = {
  label: { translate: 'Traduci', cut: 'Taglia', importAssets: 'Importa materiali', editVideo: 'Modifica video', listVideos: 'Elenca video', newVideo: 'Nuovo video', readVideo: 'Leggi video', deleteVideo: 'Elimina video', readTranscript: 'Leggi trascrizione', undoEdit: 'Annulla modifica', captions: 'Crea livello di sottotitoli', transcribe: 'Trascrivi', dub: 'Traduci e doppia', mergeFiles: 'Unisci file', extractAudio: 'Estrai audio', compressFiles: 'Comprimi file', speech: 'Sintetizza voce', image: 'Genera immagini', models: 'Visualizza modelli', installModel: 'Scarica modello locale', export: 'Esporta', downloadVideo: 'Scarica video', saveToDownloads: 'Salva in Download', viewTask: 'Visualizza attività', cancelTask: 'Annulla attività', saveOutput: 'Salva risultato', browseSpace: 'Esplora Space', searchSpace: 'Cerca in Space', readSkill: 'Leggi skill', requestGrant: 'Richiedi autorizzazione', readContract: 'Leggi contratto dell’attività', refineContract: 'Dettaglia contratto dell’attività', recordCheck: 'Registra verifica di accettazione' },
  exportKind: { subtitles: 'Sottotitoli', transcript: 'Trascrizione', audio: 'Audio', video: 'Esportazione', portable: 'Pacchetto portatile', project: 'File del progetto' },
  places: (n: number) => pluralForm('it', n, { one: `${n} posizione`, other: `${n} posizioni` }),
  count: (n: number) => `${n}`, bilingual: 'Bilingue',
  images: (n: number) => pluralForm('it', n, { one: `${n} immagine`, other: `${n} immagini` }),
  files: (n: number) => `${n} file`,
};
