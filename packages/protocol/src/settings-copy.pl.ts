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
  'models.downloadEndpoint': "Źródło modeli lokalnych (bazowy URL serwera lustrzanego, http(s)://); null używa publicznego repozytorium. BAOCUT_MODELS_ENDPOINT ma pierwszeństwo",
  'models.dir':
    "Folder modeli lokalnych (ścieżka bezwzględna); null używa models w folderze danych. BAOCUT_MODELS_DIR ma pierwszeństwo. Zmieniaj przez models.setDir, nie settings set",
  'tools.downloadEndpoint':
    "Źródło zarządzanych narzędzi zewnętrznych (yt-dlp) (bazowy URL serwera lustrzanego, http(s)://, pliki w <base>/<tool>/<version>/<file>); null używa oficjalnego URL wydania. BAOCUT_TOOLS_ENDPOINT ma pierwszeństwo",
  'fonts.autoDownload': "Automatycznie pobieraj czcionki wymagane do układu, nieobecne na komputerze i dostępne w katalogu (podgląd i eksport); po wyłączeniu używa zastępczej czcionki i powiadamia",
  'fonts.cssEndpoint': "Bazowy URL CSS API czcionek (serwer lustrzany, https://); null używa https://fonts.googleapis.com",
  'fonts.fileEndpoint': "Bazowy URL plików czcionek (serwer lustrzany, https://; pliki tylko spod niego); null używa https://fonts.gstatic.com",
  'space.trashRetentionDays': "Dni przechowywania w koszu Space (1–3650): wpisy bez odwołań i usunięte wideo starsze niż okres są okresowo usuwane trwale",
  'resources.capacity':
    "Zaawansowane: zasoby maszyny do planowania { memoryMiB, gpuMemoryMiB, cpuThreads }; pole null wykrywane automatycznie; całość null wykrywa wszystko (pamięć i CPU z systemu, GPU Apple silicon szacowane z pamięci zunifikowanej)",
  'runtime.idleExitMinutes':
    "Minuty bezczynności Runtime uruchomionego przez CLI do samoczynnego wyjścia (1–1440): brak połączeń, zadań i usług zewnętrznych. Aplikacja komputerowa i ręczne uruchomienie bez zmian",
  'updates.autoCheck': "Sprawdzaj aktualizacje aplikacji automatycznie",
  'updates.autoDownload': "Pobieraj nowe wersje w tle (bez automatycznej instalacji)",
  'diagnostics.enabled': "Wysyłaj anonimowe statystyki użycia i podsumowania wydajności (bez multimediów, tekstu i ścieżek)",
  'offline.strict': "Ścisły offline: nie wysyłaj nic do usług online",
};
