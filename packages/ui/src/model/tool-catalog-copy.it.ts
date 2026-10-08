import type { ToolCatalogMessages } from './tool-catalog-copy.ts';

const artifactLabels = { audio: 'audio', image: 'immagini', doc: 'documenti', final: 'file video', subtitle: 'sottotitoli' };

export const it: ToolCatalogMessages = {
  inputLabels: { file: 'File locale', space: 'Space', link: 'Link', text: 'Testo', video: 'Video nello Space', document: 'Documento' },
  outputLabels: { video: 'Video', artifact: 'Voce nello Space' },
  artifactLabels: { audio: 'Audio', image: 'Immagine', doc: 'Documento', final: 'File video', subtitle: 'Sottotitoli' },
  tools: {
    transcribe: { name: 'Trascrivi', desc: 'Trasforma un file video o audio in una trascrizione e sottotitoli; per un video modificabile, li scrive nel video e aggiunge un livello di sottotitoli' },
    'translate-subtitles': { name: 'Traduci sottotitoli', desc: 'Traduci i sottotitoli in un’altra lingua; per un video trascritto, aggiunge una traduzione e un livello di sottotitoli che può mostrare entrambe le lingue, lasciando invariato l’originale' },
    dub: { name: 'Doppiaggio tradotto', desc: 'Aggiungi un nuovo doppiaggio a un video trascritto dalla sua traduzione; l’audio originale può essere attenuato, disattivato o conservato' },
    'synthesize-speech': { name: 'Genera voce', desc: 'Leggi ad alta voce testo oppure documenti e sottotitoli nello Space; usa una voce preset, clona una registrazione o descrivi una voce' },
    'generate-text': { name: 'Genera testo', desc: 'Descrivi cosa ti serve e chiama direttamente un modello di testo per testi, sceneggiature o riepiloghi; puoi allegare documenti o sottotitoli nello Space come materiale' },
    'generate-image': { name: 'Genera immagine', desc: 'Descrivi un’immagine e disegnala con un modello di immagini cloud o locale; immagini di riferimento, rapporto d’aspetto e quantità sono facoltativi' },
    'link-import': { name: 'Scarica video', desc: 'Incolla un link per scaricare un video su questo computer; puoi usare i cookie del browser e trascrivere il download in una trascrizione e sottotitoli' },
    'compress-video': { name: 'Comprimi video', desc: 'Ricodifica a una dimensione o qualità desiderata; riducilo prima di inviarlo o caricarlo' },
    'merge-video': { name: 'Unisci video', desc: 'Unisci diversi video uno dopo l’altro in un unico file, in ordine' },
    'extract-audio': { name: 'Estrai audio', desc: 'Elimina l’immagine e conserva solo la traccia audio; i codec audio comuni vengono copiati senza modifiche, senza ricodifica' },
  },
  targetNone: 'Crea solo trascrizione e sottotitoli', targetCreate: 'Crea un video in un progetto', subtitleFile: 'File di sottotitoli locale',
  groups: {
    speech: { label: 'Voce e sottotitoli', desc: 'Trascrivi, traduci sottotitoli, aggiungi doppiaggi e leggi testo ad alta voce. I risultati sono voci di documenti, sottotitoli e audio; scegliendo un video modificabile nello Space li scrivi nel video.' },
    'text-image': { label: 'Testo e immagini', desc: 'Chiama direttamente modelli di testo e immagini. I risultati sono voci di documenti e immagini.' },
    'video-file': { label: 'File video', desc: 'Scarica, comprimi e unisci video ed estrai audio con yt-dlp e ffmpeg su questo computer. I risultati sono voci di file video e audio.' },
  },
  artifactItems: (artifacts) => artifacts.length ? `voci di ${artifacts.map((a) => artifactLabels[a]).join(' e ')}` : 'voci dei risultati',
  resultWritesVideo: 'Risultato: scritto nel video che scegli', resultInSpace: (items: string) => `Risultato: ${items} nello Space`, resultAlsoCreate: 'può anche creare un nuovo video', resultWritesEditable: 'scrive in un video modificabile quando ne scegli uno', joinResult: (parts: readonly string[]) => parts.join('; '),
};
