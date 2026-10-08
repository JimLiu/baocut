import type { ToolOutputsMessages } from './tool-outputs.ts';

export const it: ToolOutputsMessages = {
  actionLabel: { 'open-movie': "Apri nell’editor", 'new-movie': "Nuovo video da questo" },
  blockTextOnly: "Trascrizioni e sottotitoli richiedono un file video o audio per creare un nuovo video; non è ancora possibile farlo da qui",
  blockTrashed: "Ripristina prima questa voce dal Cestino",
  blockGenerating: "Generazione ancora in corso; disponibile al termine",
  blockMissing: "Impossibile trovare il file di questo risultato su questo computer",
  handover: {
    subtitle: "Traduci questi sottotitoli in un’altra lingua, mantenendo invariati i timecode.",
    document: "Scrivi un riepilogo di questa trascrizione.",
    audio: "Crea un video con questo audio.",
    image: "Crea un video con questa immagine come copertina.",
    'video-file': "Aggiungi sottotitoli a questo video.",
    export: "Aggiungi sottotitoli a questo video.",
    video: "Continua a modificare questo video.",
  },
  handoverDefault: "Continua a lavorare su questo risultato.",
};
