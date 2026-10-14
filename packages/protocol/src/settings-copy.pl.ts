import { LOCALES } from './i18n.ts';
import type { SettingDescriptionMessages } from './settings-copy.ts';

export const pl: SettingDescriptionMessages = {
  'agent.defaultDriver': "Agent nowych sesji; null używa wbudowanego domyślnego (codex). Ustalany przy tworzeniu sesji",
  'agent.defaultModel': "Model nowych sesji; null używa modelu zalecanego (Sonnet dla Claude Code, model -sol dla Codex), __agent-default__ nie przekazuje modelu i używa konfiguracji CLI agenta",
  'agent.defaultEffort': "Intensywność rozumowania nowych sesji; null używa domyślnej agenta",
  'agent.defaultAccessMode':
    "Dla sesji bez zmiany trybu dostępu: ask, autoAcceptEdits, auto, fullAccess lub plan (stare controlled i authorized traktowane jako ask i fullAccess)",
  'ui.language': `Język interfejsu: system używa języka systemu (angielski przy braku odpowiednika), lub kod języka (${LOCALES.join(", ")}). Tekst Runtime dla użytkowników także go używa`,
  'captions.maxLineLength': "Docelowa długość automatycznych podziałów wiersza (znaki): cjk dla chińskiego, japońskiego i koreańskiego, other dla reszty",
  'transcribe.afterComplete': "Po transkrypcji: open-video otwiera wideo, notify tylko powiadamia, nothing nic nie robi",
  'downloads.directory':
    "Lokalizacja zapisu wyników narzędzi bez wideo, multimediów z linków i plików downloads_save (ścieżka bezwzględna); null używa ~/Downloads na hoście niezależnie od projektu",
  'downloads.cookieBrowsers': 'Logowanie do witryny przy pobieraniu z linków (Pobieranie wideo, transkrypcja z linku oraz download i transcribe agenta): all używa wszystkich przeglądarek z magazynem cookie na tym hoście, od ostatnio używanej; lista id przeglądarek (chrome, edge, firefox, safari, brave, chromium, opera, vivaldi, whale) jest próbowana w tej kolejności; pusta lista pobiera anonimowo. Rozwijane według przeglądarek wykrytych na początku każdego pobierania',
  'models.downloadEndpoint': "Źródło modeli lokalnych (bazowy URL serwera lustrzanego, http(s)://); null używa publicznego repozytorium, https://www.modelscope.cn pobiera z ModelScope. BAOCUT_MODELS_ENDPOINT ma pierwszeństwo",
  'models.dir':
    "Folder modeli lokalnych (ścieżka bezwzględna); null używa models w folderze danych. BAOCUT_MODELS_DIR ma pierwszeństwo. Zmieniaj przez models.setDir, nie settings set",
  'tools.downloadEndpoint':
    "Źródło zarządzanych narzędzi zewnętrznych (yt-dlp) (bazowy URL serwera lustrzanego, http(s)://, pliki w <base>/<tool>/<version>/<file>); null używa oficjalnego URL wydania. BAOCUT_TOOLS_ENDPOINT ma pierwszeństwo",
  'models.downloadMirrors':
    "Dodane serwery lustrzane repozytorium modeli (lista { name, base }; base to URL http(s):// bez powtórzeń). Tylko lista do wyboru: pobieranie używa models.downloadEndpoint",
  'tools.downloadMirrors':
    "Dodane serwery lustrzane stron wydań (lista { name, base }; base to URL http(s):// bez powtórzeń). Tylko lista do wyboru: pobieranie używa tools.downloadEndpoint",
  'fonts.autoDownload': "Automatycznie pobieraj czcionki wymagane do układu, nieobecne na komputerze i dostępne w katalogu (podgląd i eksport); po wyłączeniu używa zastępczej czcionki i powiadamia",
  'fonts.cssEndpoint': "Bazowy URL CSS API czcionek (serwer lustrzany, https://); null używa https://fonts.googleapis.com",
  'fonts.fileEndpoint': "Bazowy URL plików czcionek (serwer lustrzany, https://; pliki tylko spod niego); null używa https://fonts.gstatic.com",
  'space.trashRetentionDays': "Dni przechowywania w koszu Space (1–3650): wpisy bez odwołań i usunięte wideo starsze niż okres są okresowo usuwane trwale",
  'cache.maxSizeMiB': 'Limit rozmiaru pamięci podręcznej w folderze danych, w MiB (256–1048576): po jego przekroczeniu usuwane są najstarsze pliki podręczne (analiza multimediów, kopie do odtwarzania), aż rozmiar spadnie do 90%. Indeks wyszukiwania między filmami nigdy nie jest usuwany',
  'resources.capacity':
    "Zaawansowane: zasoby maszyny do planowania { memoryMiB, gpuMemoryMiB, cpuThreads }; pole null wykrywane automatycznie; całość null wykrywa wszystko (pamięć i CPU z systemu, GPU Apple silicon szacowane z pamięci zunifikowanej)",
  'runtime.idleExitMinutes':
    "Minuty bezczynności Runtime uruchomionego przez CLI do samoczynnego wyjścia (1–1440): brak połączeń, zadań i usług zewnętrznych. Aplikacja komputerowa i ręczne uruchomienie bez zmian",
  'updates.autoCheck': "Sprawdzaj aktualizacje aplikacji automatycznie",
  'updates.autoDownload': "Pobieraj nowe wersje w tle (bez automatycznej instalacji)",
  'diagnostics.enabled': "Wysyłaj anonimowe statystyki użycia i podsumowania wydajności (bez multimediów, tekstu i ścieżek)",
  'offline.strict': "Ścisły offline: nie wysyłaj nic do usług online",
  'semantic.channels': 'Kanały indeksu semantycznego: text (wypowiedzi: transkrypcje, napisy, tłumaczenia, rozdziały); visual (klatka kluczowa co 8 sekund; wymaga multimodalnego pakietu modelu i trwa dłużej); audio nie jest jeszcze dostępne',
  'semantic.indexedProjects': 'Projekty, których wideo dostają indeks semantyczny: all albo lista id projektów (wideo spoza projektów tylko przy all)',
  'semantic.pauseOnBattery': 'Wstrzymuj budowanie indeksu semantycznego na baterii i wznawiaj po podłączeniu zasilania (zawsze wstrzymuje, gdy system zwalnia z powodu temperatury)',
  'semantic.translationMemory': 'Podczas tłumaczenia proponuj wcześniejsze tłumaczenia niemal identycznych zdań (wymaga modelu wyszukiwania tekstu)',
  'semantic.glossaryCandidates': 'Proponuj terminy słowniczka na podstawie niemal identycznych zapisów w transkrypcjach (wymaga modelu wyszukiwania tekstu)',
};
