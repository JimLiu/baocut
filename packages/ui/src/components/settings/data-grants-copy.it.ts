import type { DataGrantsMessages } from './data-grants-copy.ts';

export const it: DataGrantsMessages = {
  title: "Autorizzazioni alla condivisione dei dati",
  showEnded: (count: number) => `Mostra terminate (${count})`,
  lead: "I dati inviati ai provider cloud richiedono un’autorizzazione: ne viene concessa una per impostazione predefinita quando attivi un provider e un’altra quando scegli «Consenti sempre» durante l’approvazione. Dopo la revoca, le nuove chiamate non inviano dati; i dati e gli addebiti già inviati non possono essere annullati. I modelli locali non richiedono autorizzazioni.",
  loading: "Caricamento delle autorizzazioni…",
  disconnected: "Non connesso al Runtime",
  revoke: "Revoca",
  noActive: "Nessuna autorizzazione attiva",
  none: "Nessuna autorizzazione ancora presente",
  emptyDesc: "Le autorizzazioni compaiono qui quando attivi un provider cloud o scegli «Consenti sempre» durante l’approvazione.",
  revokeTitle: (name: string) => `Revocare «${name}»?`,
  revokeFailed: (message: string) => `Impossibile revocare: ${message}`,
  cancel: "Annulla",
};
