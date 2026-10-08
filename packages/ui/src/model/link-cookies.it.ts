import type { LinkCookiesMessages } from './link-cookies.ts';

export const it: LinkCookiesMessages = {
  noneChecked: 'Lascia tutti deselezionati per scaricare in modo anonimo. Se il sito richiede l’accesso o una verifica, accedi prima in un browser, poi selezionalo.',
  oneChecked: (name: string) => `Usa i cookie di ${name} per accedere al sito.`,
  manyChecked: (names: readonly string[]) => `Prova ${names.join(' → ')} in questo ordine: se i cookie di un browser non sono leggibili o il sito richiede ancora l’accesso, passa al successivo e si ferma al primo che funziona. Il risultato indica quale è stato usato.`,
  privacy: 'Vengono letti solo i browser che selezioni. yt-dlp legge i cookie su questo computer e li usa solo per accedere al sito; BaoCut memorizza solo i nomi dei browser, mai i cookie.',
  keychain: (names: readonly string[]) => `macOS richiederà l’accesso al Portachiavi una volta per ${names.length > 1 ? `ciascuno di ${names.join(', ')}` : names[0]}. Scegli «Consenti sempre» e non verrà richiesto di nuovo.`,
  safariAccess: 'Per leggere i cookie di Safari, consenti prima BaoCut in Impostazioni di Sistema › Privacy e Sicurezza › Accesso completo al disco.',
  chromiumLocked: (names: readonly string[]) => names.length > 1 ? `Mentre ${names.join(', ')} sono aperti, i database dei cookie sono bloccati e non possono essere letti. Chiudi completamente questi browser prima del download, inclusi quelli in esecuzione in background.` : `Mentre ${names[0]} è aperto, il database dei cookie è bloccato e non può essere letto. Chiudi completamente questo browser prima del download, anche se è in esecuzione in background.`,
  appBound: (names: readonly string[]) => `Su Windows, ${names.join(', ')} di solito ${names.length > 1 ? 'proteggono' : 'protegge'} i cookie con la crittografia legata all’app, che yt-dlp potrebbe non riuscire a leggere anche dopo la chiusura del browser.`,
  firefoxTip: ' Se devi accedere, accedi al sito in Firefox e seleziona Firefox.',
  noBrowsers: 'Non sono stati trovati cookie di browser su questo computer, quindi i download possono essere solo anonimi. Dopo aver effettuato l’accesso al sito in un browser, fai clic su «Rileva di nuovo i browser».',
  used: (name: string) => `Usati i cookie di ${name}`,
};
