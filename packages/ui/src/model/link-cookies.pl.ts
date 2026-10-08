const andList = (items: readonly string[]) => new Intl.ListFormat('pl', { style: 'long', type: 'conjunction' }).format(items);
import type { LinkCookiesMessages } from './link-cookies.ts';

export const pl: LinkCookiesMessages = {
  noneChecked: "Pozostaw wszystko niezaznaczone, aby pobierać anonimowo. Jeśli strona wymaga logowania lub weryfikacji, najpierw zaloguj się w przeglądarce, a potem ją zaznacz.",
  oneChecked: (name: string) => `Używa ${name} – cookie do dostępu do strony.`,
  manyChecked: (names: readonly string[]) => `Próbuje ${names.join(" → ")} w tej kolejności: jeśli nie można odczytać cookie lub strona nadal wymaga logowania, przechodzi do następnej i zatrzymuje się na pierwszej działającej. Wynik wskazuje użytą przeglądarkę.`,
  privacy: "Odczytywane są tylko zaznaczone przeglądarki. yt-dlp odczytuje cookie na tym komputerze i używa ich tylko do dostępu do strony; BaoCut zapamiętuje tylko nazwy przeglądarek, nigdy cookie.",
  keychain: (names: readonly string[]) => `macOS raz zapyta o dostęp do Pęku kluczy dla ${names.length > 1 ? `każdej z ${andList(names)}` : names[0]}. Wybierz „Zawsze zezwalaj”, aby nie pytać ponownie.`,
  safariAccess: "Aby odczytać cookie Safari, zezwól na BaoCut w Ustawienia systemowe › Prywatność i ochrona › Pełny dostęp do dysku.",
  chromiumLocked: (names: readonly string[]) => names.length > 1
      ? `Gdy ${andList(names)} są otwarte, ich bazy cookie są zablokowane i nieczytelne. Przed pobieraniem zamknij je całkowicie, także działające w tle.`
      : `Gdy ${names[0]} jest otwarta, baza cookie jest zablokowana i nieczytelna. Przed pobieraniem zamknij ją całkowicie, także jeśli działa w tle.`,
  appBound: (names: readonly string[]) => `W Windows ${andList(names)} zwykle ${names.length > 1 ? "chronią" : "chroni"} cookie przez App-Bound Encryption, co może uniemożliwić yt-dlp odczyt nawet po zamknięciu przeglądarki.`,
  firefoxTip: " Jeśli wymagane jest logowanie, zaloguj się na stronie w Firefox i zaznacz Firefox.",
  noBrowsers: "Nie znaleziono cookie przeglądarek na tym komputerze, więc możliwe jest tylko anonimowe pobieranie. Po zalogowaniu się na stronie w przeglądarce kliknij „Wykryj przeglądarki ponownie”.",
  used: (name: string) => `Użyto ${name} – cookie`,
};
