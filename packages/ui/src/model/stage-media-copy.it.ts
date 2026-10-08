import type { StageMediaMessages } from './stage-media-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: StageMediaMessages = {
  titles: { missing: 'File di origine non trovato', changed: 'Il file di origine è cambiato', 'outside-project': 'Il file di origine è fuori dalla cartella del progetto', unplayable: 'Il file di origine non può essere riprodotto' },
  causes: { missing: 'Il file potrebbe essere stato spostato, rinominato o eliminato, oppure trovarsi su un’unità scollegata.', changed: 'Il file in questa posizione non è più quello importato (la dimensione non corrisponde). Potrebbe essere stato sovrascritto o esportato di nuovo.', 'outside-project': 'La posizione registrata è fuori dalla cartella del progetto che contiene questo video e BaoCut non legge i file in quella posizione.' },
  unplayable: (error: string) => `Il lettore non può aprire questo file: ${error}.`,
  tail: { video: 'I sottotitoli vengono ancora riprodotti; mancano solo immagine e audio originale.', audio: 'I sottotitoli vengono ancora riprodotti; semplicemente non sentirai questo audio.' },
  body: (cause: string, tail: string) => `${cause} ${tail}`,
  volume: (volume: string) => `Il file si trova su «${volume}». Collega quell’unità e verrà recuperato automaticamente.`,
  more: (count: number) => pluralForm('it', count, { one: `Anche ${count} altro materiale video o audio non può essere riprodotto.`, other: `Anche ${count} altri materiali video o audio non possono essere riprodotti.` }),
  relinkHint: 'Scegli il file originale per recuperarlo. BaoCut verifica i contenuti e non può ricollegare un file con contenuti diversi.',
  desktopOnly: 'Per recuperarlo, apri questo video nell’app desktop BaoCut e usa «Ricollega…» sull’area di lavoro per scegliere il file originale.',
  managed: 'Questo file era memorizzato nella cartella del video, quindi non può essere ricollegato a un’altra posizione.',
  oldRevision: 'La timeline usa una versione precedente di questo materiale; solo quella attuale può essere ricollegata.',
  relink: 'Ricollega…', relinking: 'Verifica in corso…',
  pickTitle: (name: string) => `Trova «${name}»`, pickButton: 'Ricollega', label: (name: string) => `Ricollega «${name}»`,
  relinkFailed: (message: string) => `Impossibile ricollegare: ${message}`,
  decodeFailed: 'Decodifica non riuscita', unsupported: 'Formato non supportato',
};
