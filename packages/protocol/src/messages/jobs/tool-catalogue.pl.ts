import type { JobsToolCatalogueMessages } from './tool-catalogue.ts';

export const pl: JobsToolCatalogueMessages = {
  transcribeLabel: "Transkrybuj",
  transcribeDescription:
    "Transkrybuj lokalny plik multimediów lub wideo w Space. Dla wideo zapisuje nową transkrypcję i tworzy warstwę napisów; dla pliku zapisuje TXT i SRT w lokalizacji zapisu lub może utworzyć nowe wideo.",
  translateSubtitlesLabel: "Przetłumacz napisy",
  translateSubtitlesDescription:
    "Przetłumacz transkrypcję wideo zdanie po zdaniu na inny język i zapisz w wideo jako nowe tłumaczenie. Może też tłumaczyć plik SRT / VTT (lokalny lub wpis napisów w Space) do nowego pliku.",
  dubLabel: "Tłumaczony dubbing",
  dubDescription: "Syntezuj mowę w języku docelowym zdanie po zdaniu z transkrypcji (najpierw tłumacząc, jeśli brak tłumaczenia), dopasuj czas i zapisz w wideo jako nową grupę dubbingu.",
  synthesizeSpeechLabel: "Generuj mowę",
  synthesizeSpeechDescription: "Syntezuj mowę z tekstu; wynik jest audio. Może też odczytać dokument lub wpis napisów w Space (napisy bez kodów czasowych).",
  generateTextLabel: "Generuj tekst",
  generateTextDescription: "Generuj tekst z promptu (opcjonalnie według JSON Schema); wynik jest tekstem. Dokumenty lub wpisy napisów w Space można dołączyć jako materiały.",
  generateImageLabel: "Generuj obraz",
  generateImageDescription: "Generuj obraz z opisu; wynik jest obrazem.",
  linkImportLabel: "Pobierz wideo",
  linkImportDescription: "Pobierz wideo na ten komputer przez yt-dlp. Można użyć cookie przeglądarki i transkrybować pobrane wideo na transkrypcję i napisy.",
  compressVideoLabel: "Kompresuj wideo",
  compressVideoDescription: "Kompresuj pliki wideo pojedynczo: plik do pliku, bez tworzenia wideo i nadpisywania istniejących plików.",
  mergeVideoLabel: "Scal wideo",
  mergeVideoDescription: "Połącz kilka plików wideo w jeden w kolejności: plik do pliku, bez tworzenia wideo i nadpisywania istniejących plików.",
  extractAudioLabel: "Wyodrębnij audio",
  extractAudioDescription:
    "Wyodrębnij ścieżkę audio z pliku wideo lub audio. Kodeki zgodne z popularnym kontenerem są kopiowane bez zmian; inne kodowane ponownie do AAC. Plik do pliku, bez tworzenia wideo i nadpisywania istniejących plików.",
};
