import type { ExportSettingsMessages } from './export-settings.ts';

export const it: ExportSettingsMessages = {
  quality: { small: 'File più piccolo', standard: 'Standard', high: 'Alta qualità' },
  qualityNote: { small: 'Compressione maggiore, un po’ meno dettagli, file più piccolo', standard: 'Qualità e dimensione predefinite', high: 'Più dettagli, file più grande' },
  loudnessOn: (lufs: string, truePeak: string) => `Normalizza l’intero mix a ${lufs} LUFS, con picco reale non superiore a ${truePeak} dBTP.`,
  loudnessOff: 'Disattivato: esporta il mix così com’è nel video.',
  audioFormatNote: { wav: 'Senza perdita · File più grande · Usalo per ulteriore post-produzione', mp3: 'Universale · Funziona con piattaforme podcast, autoradio e dispositivi meno recenti', m4a: 'AAC · Un po’ più chiaro di MP3 allo stesso bitrate · Nativo sui dispositivi Apple' },
  dubGroup: (language: string | null) => language ? `Doppiaggio in ${language}` : 'Questo gruppo di doppiaggio',
  mix: 'Mix dell’esportazione', mixNote: 'Uguale a quello che senti ora nella timeline',
  originalOnly: 'Solo audio originale', originalOnlyNote: 'Rimuove tutti i doppiaggi e ripristina l’audio originale che avevano disattivato',
  dubOnly: (label: string) => `Solo ${label}`, dubOnlyNote: 'Conserva solo questo gruppo di doppiaggio, senza audio originale, musica o altri doppiaggi',
  mono: 'Mono', stereo: 'Stereo',
  subtitleFormatNote: { srt: 'Universale: funziona con quasi tutti i lettori e le piattaforme', vtt: 'Per lettori web, con indicazioni di posizione', ass: 'Mantiene lo stile dei sottotitoli (font, contorno, posizione); supportato da meno lettori', json: 'Timestamp delle singole parole per ogni voce, per script e strumenti' },
  transcription: 'Trascrizione', plainText: 'Testo semplice',
  transcriptFormatNote: { md: 'Intestazione front matter facoltativa, capitoli come titoli, parlanti in grassetto, traduzioni come citazioni · Incolla in note o documenti', txt: 'Senza marcatori di formattazione · Titoli dei capitoli su una riga a sé' },
};
