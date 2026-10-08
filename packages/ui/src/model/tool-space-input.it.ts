import type { ToolSpaceInputMessages } from './tool-space-input.ts';

export const it: ToolSpaceInputMessages = {
  reasons: {
    trashed: "Nel Cestino",
    generating: "Generazione ancora in corso; puoi scegliere al termine",
    missing: "Il file manca; ricollegalo prima di scegliere",
    failed: "L’ultima generazione non è riuscita",
    textOnly: "È possibile leggere solo testo da documenti .txt e .md",
    subtitleOnly: "Sono accettati solo sottotitoli .srt e .vtt",
    noPath: "Questa voce non ha un file su questo computer; un nuovo video deve iniziare da un file locale",
  },
  joinKinds: (labels) => labels.join(", "),
};
