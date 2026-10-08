import type { ToolsTextMessages } from './tools-text.ts';

export const it: ToolsTextMessages = {
  emptyInput: "Inserisci prima cosa generare",
  tooLong: (max) => `Fino a ${max} caratteri alla volta`,
  sample: "Scrivi un doppiaggio di 30 secondi per un video di una passeggiata in città. Mantieni un tono naturale e metti in risalto le strade, i caffè e il crepuscolo.",
  counter: (n, max) => `${n} / ${max} caratteri`,
  connectTextModel: "Connetti prima un modello di testo",
  connectFirst: (provider) => `Connetti prima ${provider}`,
  effortFixed: "Intensità di ragionamento · non regolabile per questo modello",
  effort: (label) => `Intensità di ragionamento · ${label} (predefinito impostato nella pagina Modelli)`,
  auto: "Automatico",
  headerChip: (provider) => `Online · ${provider} · addebito per token`,
  fileStem: "Testo generato",
  chars: (n) => `${n} caratteri`,
  outputTokens: (n) => `Token di output: ${n}`,
  truncated: "Raggiunto il limite di output; il resto è stato troncato",
};
