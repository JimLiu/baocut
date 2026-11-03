import type { SystemAccessMessages } from './system-access-copy.ts';

export const it: SystemAccessMessages = {
  cardTitle: (names) => `Consenti a BaoCut di leggere i cookie di ${names}`,
  cardBody: "macOS richiede di concedere prima a BaoCut l’“Accesso completo al disco”. Fai clic su “Apri Impostazioni di Sistema” e BaoCut ti porta direttamente a quella pagina. BaoCut legge solo i browser selezionati, nient’altro.",
  openedTitle: "Attiva BaoCut in Impostazioni di Sistema, poi torna qui",
  openedBody: "Attiva l’interruttore accanto a BaoCut. Quando macOS chiede di uscire e riaprire BaoCut, scegli “Esci e riapri”. Se BaoCut non è nell’elenco, fai clic su “+” sotto l’elenco per aggiungerlo. Se macOS non propone di riaprire, fai clic qui sotto su “Riavvia BaoCut”.",
  open: "Apri Impostazioni di Sistema",
  openAgain: "Riapri Impostazioni di Sistema",
  restart: "Riavvia BaoCut",
  askTitle: (names) => `Consentire prima l’accesso ai cookie di ${names}?`,
  askBody: (names) => `Questo download usa il tuo accesso a ${names} e macOS richiede di concedere prima a BaoCut l’“Accesso completo al disco”. Attivalo in Impostazioni di Sistema e scarica di nuovo, oppure salta questa volta e continua con gli altri browser.`,
  skip: "Salta questa volta",
  settingLabel: "Accesso completo al disco",
  settingAllowed: "Consentito. BaoCut può leggere i file su dischi esterni, Scrivania, Documenti e Download e i cookie di Safari, ma solo i contenuti, le posizioni di salvataggio e i browser che scegli.",
  settingMissing: "Non consentito. macOS impedisce alle app di leggere dischi esterni, Scrivania, Documenti, Download e i cookie di Safari. Una volta consentito, BaoCut non fallirà in questi percorsi per mancanza di permessi. Legge solo i contenuti, le posizioni di salvataggio e i browser che scegli.",
  openFailed: "Impossibile aprire Impostazioni di Sistema. Apri tu Impostazioni di Sistema › Privacy e sicurezza › Accesso completo al disco.",
};
