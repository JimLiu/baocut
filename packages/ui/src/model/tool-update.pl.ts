import type { ToolUpdateMessages } from './tool-update.ts';

export const pl: ToolUpdateMessages = {
  standalone: "Oficjalny samodzielny plik wykonywalny",
  updateInTerminal: "Zaktualizuj w terminalu",
  unknownInstall: "Nie można ustalić sposobu instalacji yt-dlp. Uruchom polecenie zgodne z metodą instalacji, a potem kliknij „Sprawdź ponownie”.",
  cannotRun: "BaoCut nie może uruchomić tego polecenia za Ciebie.",
  thenRecheck: "Następnie kliknij „Sprawdź ponownie”.",
  runThenRecheck: "Uruchom to polecenie w terminalu, a potem kliknij „Sprawdź ponownie”.",
  updateWith: (method) => `Zaktualizuj przez ${method}`,
  stoppedTitle: "Aktualizacja zatrzymana",
  stoppedBody: "Polecenie mogło wykonać się tylko częściowo. Sprawdź wynik poniżej, a potem kliknij „Sprawdź ponownie”, aby potwierdzić obecną wersję yt-dlp.",
  failedTitle: (exitCode) => (exitCode === null ? "Aktualizacja nie została ukończona" : `Aktualizacja nie została ukończona (kod zakończenia ${exitCode})`),
  failedBody: (error) => `${error ? `${error.replace(/[。.]$/, "")}. ` : ""}Istniejący yt-dlp pozostaje bez zmian. Wynik jest poniżej; możesz też skopiować polecenie, uruchomić w terminalu, a potem kliknąć „Sprawdź ponownie”.`,
  updatedTo: (version) => `Zaktualizowano do ${version}`,
  upToDate: (version) => (version ? `Już aktualne (${version})` : "Już aktualne"),
  logTruncated: "… (pominięto wcześniejszy wynik; pełny wynik jest w zapisie zadania)\n",
  logStopped: "(Zatrzymano)",
  logExitCode: (exitCode) => `(Kod zakończenia ${exitCode})`,
};
