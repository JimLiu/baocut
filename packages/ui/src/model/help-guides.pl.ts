import type { HelpGuidesMessages } from './help-guides.ts';



export const pl: HelpGuidesMessages = {
  guides: {
    import: {
      title: "Utwórz wideo i zaimportuj materiały",
      short: "Tworzenie i import",
      summary: "Utwórz wideo w Space, a następnie dodaj materiały do biblioteki materiałów i na oś czasu.",
      keywords: "nowy utwórz plik materiał biblioteka materiałów import przeciągnij upuść audio obraz import wideo materiał",
      steps: [
        [
          "Utwórz wideo",
          "Otwórz „Space” po lewej, kliknij „Nowe” → „Nowe puste wideo”, wybierz projekt, a następnie proporcje w Home i kliknij „Utwórz puste wideo”. Jeśli masz już plik wideo lub audio, kliknij „Nowe wideo z pliku”; Home otworzy się z tym plikiem i pozwoli wybrać dodanie napisów albo transkrypcję i tłumaczenie. Jeśli nie masz jeszcze projektu, najpierw otwórz folder projektu w Home lub poproś agenta w sesji o utworzenie projektu.",
        ],
        [
          "Zaimportuj materiały do biblioteki",
          "W prawym panelu edytora otwórz „Wideo”, „Audio” lub „Obrazy”, kliknij „Importuj” i wybierz pliki albo przeciągnij je do pola z przerywaną ramką. Import jedynie kopiuje pliki do folderu wideo; oryginalne pliki pozostają bez zmian.",
        ],
        [
          "Umieść je na osi czasu",
          "Kliknij „+” po prawej stronie wiersza materiału, aby umieścić go przy głowicy odtwarzania. Możesz też przeciągnąć materiał na wiersz osi czasu lub plik z komputera bezpośrednio na oś czasu.",
        ],
      ],
      tip: "Import i umieszczenie na osi czasu to dwa kroki: nowy materiał pozostaje w bibliotece materiałów i jeszcze nie pojawia się w obrazie.",
      cta: "Nowe wideo z pliku",
    },
    subtitle: {
      title: "Dodaj napisy i sprawdź je wiersz po wierszu",
      short: "Dodaj napisy",
      summary: "Zaimportuj plik napisów lub zleć agentowi transkrypcję, a następnie odsłuchaj materiał i popraw napisy.",
      keywords: "transkrybuj transkrypcja rozpoznawanie srt vtt webvtt ass literówka podziel scal znajdź zamień transkrypcja napisy",
      steps: [
        [
          "Najpierw uzyskaj napisy",
          "Otwórz „Napisy” po prawej. Jeśli wideo ma materiały, kliknij „Utwórz napisy”, aby wykonać transkrypcję modelem mowy na urządzeniu lub połączoną usługą w chmurze; po zakończeniu napisy automatycznie pojawią się w obrazie. Zwinięte „Ustawienia transkrypcji” pod przyciskiem pozwalają zmienić język, model mowy i wskazówki rozpoznawania. Jeśli masz plik napisów, kliknij „Importuj plik napisów”; obsługiwane są SRT, WebVTT i ASS. Aby oznaczyć mówców, użyj „Narzędzia › Transkrybuj”: rozwiń „Więcej opcji” pod modelem mowy i włącz „Rozpoznaj mówców”. MOSS Transcribe sam rozróżnia mówców, więc opcja pozostaje włączona; inne modele lokalne wymagają „Diaryzacji mówców”, której pobranie będzie proponowane przy pierwszym włączeniu.",
        ],
        [
          "Kliknij wiersz i go edytuj",
          "Kliknij czas wiersza, aby przenieść do niego głowicę odtwarzania; kliknij tekst, aby go edytować. Enter dzieli wiersz na dwa, Backspace na początku łączy go z poprzednim, Shift+Enter dodaje podział wewnątrz wiersza, a Esc odrzuca edycję.",
        ],
        [
          "Odsłuchaj ponownie i popraw wiele miejsc naraz",
          "Po wyjściu z pola tekstowego naciśnij Space, aby odtwarzać i porównać tekst z mową. U góry panelu widać liczbę wierszy przekraczających tempo czytania. Gdy ten sam błąd występuje w wielu miejscach, użyj znajdowania i zamiany (⌘F / Ctrl+F).",
        ],
      ],
      tip: "Tylko transkrypcje uruchomione przez „Utwórz napisy” automatycznie trafiają do obrazu. Gdy agent transkrybuje w sesji, wynik najpierw zapisuje się jako transkrypcja; wróć do „Napisów” i kliknij „Utwórz napisy”, aby go użyć. Jeśli oś czasu ma kilka ścieżek napisów, wybierz właściwą z listy w nagłówku „Napisy”.",
      cta: "Otwórz napisy",
    },
    translate: {
      title: "Dodaj tłumaczenie do dwujęzycznych napisów",
      short: "Tłumaczenie i dwa języki",
      summary: "W panelu napisów wybierz język docelowy i model tekstowy; tłumaczenie trafi do obrazu jako nowa ścieżka napisów.",
      keywords: "przetłumacz tłumaczenie angielski chiński dwujęzyczny język źródło obok słownik model tekstowy tłumaczenie dwa języki",
      steps: [
        [
          "Najpierw sprawdź oryginał",
          "Tłumaczenie przebiega zdanie po zdaniu przez transkrypcję, więc najpierw popraw nazwy, terminy i oczywiste błędy rozpoznawania. Napisy do tłumaczenia muszą pochodzić z transkrypcji: importowane pliki nie mają czasu poszczególnych słów i nie można ich tłumaczyć bezpośrednio.",
        ],
        [
          "Kliknij „+ Przetłumacz na…” na pasku ścieżek",
          "Otwórz „Napisy” po prawej, kliknij „+ Przetłumacz na…” na pasku ścieżek, wybierz język docelowy i model tekstowy, w razie potrzeby dodaj wskazówkę stylu lub zaznacz słownik, a następnie kliknij przycisk uruchomienia na dole. Jeśli model tekstowy nie jest jeszcze dostępny, najpierw połącz usługę w „Modele › Generowanie tekstu”; modele online są rozliczane za tokeny.",
        ],
        [
          "Sprawdź tłumaczenie i układ dwóch języków",
          "Po zakończeniu tłumaczenie automatycznie trafia do obrazu, a karta wyniku pozwala je cofnąć jednym kliknięciem. W „Liście” przełącz na „Oryginał + tłumaczenie”, aby porównywać wiersze; kliknij przetłumaczony wiersz, aby go poprawić. Zaznacz napis: sekcja „Dwujęzyczny” we „Właściwościach napisów” ustawia kolejność wierszy i odstęp między nimi.",
        ],
      ],
      tip: "Chcesz pokazać tylko tłumaczenie? Przed rozpoczęciem wyłącz „Pokaż oba języki” albo kliknij „×” przy oryginale na pasku ścieżek, aby usunąć go z obrazu; oryginał nie jest kasowany. Po edycji oryginału zależne tłumaczenia są oznaczane jako „Nieaktualne”: poprawienie wiersza usuwa oznaczenie. Możesz też kliknąć „Odśwież nieaktualne tłumaczenia” w powiadomieniu aplikacji desktopowej lub wpisać /refresh w sesji, aby agent przetłumaczył te wiersze ponownie.",
      cta: "Otwórz napisy",
    },
    export: {
      title: "Wyeksportuj wideo, napisy lub transkrypcję",
      short: "Eksport",
      summary: "Wybierz potrzebny wynik; dla wideo i audio możesz też eksportować wybrane rozdziały lub segmenty.",
      keywords:
        "eksport zapisz pobierz mp4 wav mp3 m4a srt vtt ass json markdown transkrypcja rozdział segment głośność plik projektu premiere davinci resolve pakiet przenośny eksport",
      steps: [
        [
          "Kliknij „Eksportuj” na pasku wideo",
          "Kliknij „Eksportuj” po prawej stronie paska wideo w edytorze. Każdy z pięciu wyników ma własną stronę: Wideo (MP4), Audio (WAV, MP3 lub M4A), Napisy (SRT, VTT, ASS lub JSON), Transkrypcja (Markdown lub zwykły tekst) i Plik projektu (XML dla Premiere Pro i DaVinci Resolve lub przenośny pakiet BaoCut).",
        ],
        [
          "Wybierz zakres i sprawdź ustawienia",
          "Wideo i audio można eksportować w całości, według rozdziałów, segmentów lub własnego początku i końca; napisy, transkrypcje i pliki projektu obejmują całą sekwencję. Na stronie wideo sprawdź też rozdzielczość, rozmiar pliku i wtopienie napisów w obraz, a w razie potrzeby włącz normalizację głośności. Na stronie napisów zaznacz dwie ścieżki, aby połączyć je w jeden dwujęzyczny plik.",
        ],
        [
          "Uruchom eksport i poczekaj na zakończenie",
          "Pliki domyślnie trafiają do exports/ w projekcie; możesz najpierw kliknąć „Wybierz lokalizację”. Podczas eksportu możesz zamknąć okno i pracować dalej; postęp widać na przycisku „Eksportuj” oraz w „Zadaniach w tle”. Po zakończeniu kliknij „Pokaż w folderze”, aby znaleźć plik; przy błędzie okno poda przyczynę i następny krok.",
        ],
      ],
      tip: "Plik napisów i wideo z napisami to dwa różne wyniki: pierwszy służy do wczytania w innym programie, drugi można od razu odtwarzać i udostępniać.",
    },
    workspace: {
      title: "Poznaj edytor",
      short: null,
      summary: "Zobacz wynik w podglądzie, znajdź momenty na osi czasu i zmieniaj zawartość w prawym panelu.",
      keywords: "scena płótno podgląd oś czasu panel inspektor właściwości ścieżka odtwarzanie nie mogę znaleźć",
      steps: [
        [
          "Środek: podgląd",
          "Pokazuje obraz przy głowicy odtwarzania, a nad nim rozmiar wideo i liczbę klatek na sekundę. Sterowanie poniżej pozwala odtwarzać, przechodzić klatka po klatce, cofać i ponawiać oraz dzielić przy głowicy.",
        ],
        [
          "Dół: oś czasu",
          "Kliknij oś czasu, aby przenieść głowicę. Przeciągnij klip, aby zmienić czas jego pojawienia lub przenieść go na inną ścieżkę; przeciągnij końce, aby go przyciąć. Menu pod prawym przyciskiem pozwala podzielić, skopiować, wyłączyć lub usunąć klip.",
        ],
        [
          "Prawa strona: zawartość i właściwości",
          "Pionowy pasek od góry zawiera: Transkrypcję, Napisy, Elementy, Tekst, Obrazy, Wideo, Audio, Markę i Inspektor. Zaznaczenie klipu przełącza na jego właściwości; bez zaznaczenia Inspektor pokazuje „Właściwości wideo” dla całego wideo.",
        ],
      ],
      tip: "Błąd? Najpierw cofnij (⌘Z / Ctrl+Z). „Wersje” na pasku wideo otwierają historię, w której można osobno cofnąć pojedynczą zmianę.",
    },
    style: {
      title: "Zmień wygląd napisów",
      short: null,
      summary: "Zaznacz napis i zmień pozycję, styl tekstu oraz czas w Inspektorze.",
      keywords: "styl czcionka rozmiar kolor kontur obrys tło cień poświata pozycja dwujęzyczny odstęp wiersze interpunkcja styl czcionka",
      steps: [
        [
          "Zaznacz napis",
          "Kliknij napis na osi czasu, a prawy panel przełączy się na „Właściwości napisów”. Zmieniasz tu styl, więc wszystkie napisy używające tego samego stylu zmienią się razem.",
        ],
        [
          "Dostosuj pozycję i styl tekstu",
          "„Pozycja” ustawia położenie pionowe i poziome oraz szerokość; „Styl tekstu” ustawia czcionkę, rozmiar, kolor i wyrównanie, a także tło, obrys, poświatę i cień. Obraz zmienia się podczas przeciągania, a zmiana zapisuje się po puszczeniu.",
        ],
        [
          "Dostosuj czas",
          "„Wcześniej” i „Później” w sekcji „Wyświetlanie” określają, jak długo przed mową pojawia się wiersz i jak długo po niej znika; „Interpunkcja” może zastąpić przecinki i kropki spacjami.",
        ],
      ],
      tip: "Gdy oś czasu zawiera oryginalne i przetłumaczone napisy, sekcja „Dwujęzyczny” we „Właściwościach napisów” ustawia kolejność wierszy i odstęp między nimi. Jeśli coś pójdzie nie tak, cofnij (⌘Z / Ctrl+Z).",
      cta: "Otwórz właściwości napisów",
    },
    elements: {
      title: "Dodaj tekst, naklejki i kształty",
      short: null,
      summary: "Dodaj elementy do obrazu z prawego panelu, a potem dostosuj pozycję i styl w Inspektorze.",
      keywords: "elementy naklejka kształt wizualizator pasek postępu timer odliczanie przebieg fali tekst pole tekstowe tytuł dolna tercja preset elementy naklejka kształt tekst",
      steps: [
        [
          "Wybierz element",
          "„Elementy” po prawej dzielą się na naklejki, kształty i wizualizatory; można je przeszukiwać. Wizualizatory obejmują paski postępu, timery i przebiegi fali. Kliknij element, aby dodać go na oś czasu: większość zaczyna się przy głowicy, a takie jak paski postępu obejmują całe wideo.",
        ],
        ["Dodaj tekst", "W „Tekście” po prawej kliknij „Dodaj pole tekstowe” albo wybierz preset, np. „Proste”, „Tytuł” lub „Dolna tercja”."],
        [
          "Dostosuj czas i pozycję",
          "Każdy dodany element zajmuje odcinek na osi czasu; przeciągnij go, aby zmienić moment pojawienia. Po zaznaczeniu prawy panel pokazuje właściwości; w „Geometrii” ustaw pozycję, rozmiar, obrót i odbicie za pomocą wartości.",
        ],
      ],
      tip: "Po zaznaczeniu elementu prawy panel pokazuje jego właściwości; naciśnij Esc, aby odznaczyć, a Inspektor wróci do „Właściwości wideo”.",
    },
    reframe: {
      title: "Zmień poziome wideo na pionowe",
      short: null,
      summary: "Zmień proporcje we właściwościach wideo; klipy w obrazie skalują się wraz z płótnem.",
      keywords: "pionowy poziomy portretowy krajobrazowy proporcje 9:16 1:1 4:3 16:9 płótno kadrowanie pionowe proporcje",
      steps: [
        ["Otwórz właściwości wideo", "Naciśnij Esc, aby odznaczyć klip, a następnie otwórz „Inspektor” po prawej; teraz pokazuje „Właściwości wideo”."],
        [
          "Wybierz inne proporcje",
          "„Proporcje” oferują 16:9, 9:16, 1:1 i 4:3. Krótszy bok pozostaje bez zmian; klipy w obrazie przesuwają się i skalują proporcjonalnie z płótnem, wypełniające płótno nadal je wypełniają, a zablokowane nie ruszają się.",
        ],
        ["Dostosuj kadrowanie każdego klipu", "Zaznacz klip wymagający kadrowania i dostosuj pozycję oraz rozmiar w „Geometrii” jego właściwości."],
      ],
      tip: "Zmiana proporcji to zwykła edycja; jeśli wynik Ci nie odpowiada, cofnij (⌘Z / Ctrl+Z). Nie ma tu inteligentnego kadrowania automatycznie znajdującego główny obiekt, więc ustawiasz kadr samodzielnie.",
    },
    aitools: {
      title: "Zleć agentowi uporządkowanie transkrypcji",
      short: null,
      summary:
        "Redakcja, rozdziały, mówcy, znajdowanie cięć, tłumaczenie, dubbing i teksty do publikacji zaczynają się od / w sesji lub przycisku właściwego panelu i domyślnie trafiają do agenta.",
      keywords:
        "AI narzędzia ukośnik redakcja akapit rozdział mówca wypełniacz pauza ponowna transkrypcja nieaktualne tłumaczenie dubbing podsumowanie blog tytuł opis okładka redakcja rozdziały mówcy porządkowanie",
      steps: [
        [
          "Wpisz / w sesji",
          "Wpisz / na początku wiadomości w sesji (lub wybierz „Użyj narzędzia” pod „+”), aby zobaczyć narzędzia dla tego wideo: Popraw transkrypcję, Wygeneruj rozdziały, Rozpoznaj mówców, Transkrybuj ponownie, Znajdź fragmenty do wycięcia, Przetłumacz napisy, Odśwież nieaktualne tłumaczenia, Przetłumacz dubbing, Napisz podsumowanie, Napisz wpis na blog, Zaproponuj tytuły, Napisz opis, Utwórz okładkę i Eksportuj. Wybierz narzędzie, dopisz wymagania i wyślij; agent rozpocznie pracę. Dla wideo otwartego z Space sesja znajduje się w prawym dolnym rogu; te narzędzia nie są dostępne w wersji webowej.",
        ],
        [
          "Albo otwórz kartę Narzędzia AI",
          "Karta „Narzędzia AI” po prawej stronie edytora grupuje narzędzia: poprawianie transkrypcji, tworzenie rozdziałów, rozpoznawanie mówców, ponowna transkrypcja i szukanie cięć, a potem podsumowanie, wpis na bloga, tytuły, opis i okładka. „Znajdź cięcia” na pasku podpowiedzi trybu cięcia otwiera tę samą stronę. Wybierz narzędzie, potem zakres i opcje. Pole tekstowe poniżej układa z nich prośbę z dołączonym skillem narzędzia; możesz je edytować. W wierszu „Sesja” wybierz nową lub bieżącą sesję i kliknij „Przekaż agentowi”. Tłumaczenie napisów jest w „+ Przetłumacz na…” w panelu Napisy, a tłumaczenie dubbingu w panelu Audio i menu ścieżki dubbingu; przy tych dwóch wybierasz model na stronie ustawień i zaczynasz od razu.",
        ],
        [
          "Sprawdź wyniki",
          "Za każdym razem, gdy agent zmienia wideo, w sesji pojawia się karta zmiany, którą można bezpośrednio cofnąć. Popraw transkrypcję przed generowaniem rozdziałów, aby grupowały się według akapitów. Teksty do publikacji służą do czytania, wyboru i kopiowania w sesji; nie zmieniają transkrypcji. Po edycji oryginału użyj „Odśwież nieaktualne tłumaczenia”, aby ponownie tłumaczyć tylko wiersze oznaczone „Nieaktualne”.",
        ],
      ],
      tip: "Jeśli czegoś nie ma na liście, po prostu napisz to w sesji. Inteligentne kadrowanie i podział na krótkie wideo nie są dostępne w tej wersji.",
    },
    agent: {
      title: "Zleć agentowi pracę nad wideo",
      short: null,
      summary: "Opisz jednym zdaniem, czego chcesz, obserwuj kolejne kroki i sprawdź wynik.",
      keywords: "AI asystent agent sesja czat automatyczne zatwierdzenie uprawnienie cofanie codex claude agent",
      steps: [
        [
          "Najpierw połącz agenta",
          "Otwórz „Ustawienia › Dostawcy agentów”. BaoCut wykrywa Claude Code i Codex na tym komputerze; jeśli agent nie jest zainstalowany, wykonaj kroki na jego karcie, zainstaluj i zaloguj się, a następnie wróć i sprawdź ponownie.",
        ],
        [
          "Opisz w sesji, czego chcesz",
          "Rozpocznij sesję w Home albo otwórz wideo w Space: pływająca sesja, domyślnie rozwinięta, jest w prawym dolnym rogu, więc pisz tam. Po zminimalizowaniu staje się ikoną w tym rogu; kliknij, aby znów rozwinąć. Określ zakres i to, co zachować, np.: „Sprawdź literówki w napisach tego wywiadu, ale zachowaj potoczne sformułowania”.",
        ],
        [
          "Obserwuj proces i sprawdź wynik",
          "Każdy krok agenta można rozwinąć. Zależnie od wybranego trybu dostępu przed uruchomieniem poleceń lub zmianami prosi o zgodę lub odmowę; każda zmiana wideo daje kartę w sesji, którą możesz bezpośrednio cofnąć.",
        ],
      ],
      tip: "Agent może używać tylko wideo z folderu sesji (folderu projektu lub własnego folderu roboczego sesji). Gdy wysyłasz wiadomość, takie wideo otwarte w edytorze jest dołączane wraz z zaznaczeniem i głowicą; możesz usunąć odwołanie nad polem wpisywania.",
      cta: "Otwórz ustawienia agenta",
    },
    missing: {
      title: "Dlaczego nie widzę napisów w obrazie?",
      short: null,
      summary: "Sprawdź kolejno, czy napisy są na osi czasu, gdzie jest głowica odtwarzania i jak ustawione są przełączniki ścieżek.",
      keywords: "nie widać brak ukryte wyłączone puste nie widzę napisy transkrypcja",
      steps: [
        [
          "Upewnij się, że napisy są na osi czasu",
          "Transkrypcje agenta lub wiersza poleceń zapisują tylko wynik jako transkrypcję i nie zmieniają osi czasu. Otwórz „Napisy” po prawej: jeśli widać „Brak napisów”, kliknij „Utwórz napisy”, zaimportuj plik lub poproś agenta o umieszczenie transkrypcji na osi czasu.",
        ],
        [
          "Przejdź do wiersza z mową",
          "Kliknij czas wiersza w „Napisach”, a głowica przeskoczy do niego. Przerwy bez mowy nie mają napisów.",
        ],
        [
          "Sprawdź przełączniki ścieżek i klipów",
          "Spójrz na nagłówek ścieżki napisów: jeśli ikona oka jest wyłączona, ścieżki nie widać w podglądzie. Wyłączone klipy także są pomijane; kliknij klip prawym przyciskiem i wybierz „Włącz ten klip”.",
        ],
      ],
      tip: "Nadal nic nie widać? Zaznacz napis i sprawdź pozycję oraz kolor we „Właściwościach napisów”: tekst mógł wyjść poza obraz albo zlać się z tłem.",
      cta: "Sprawdź napisy",
    },
    model: {
      title: "Transkrypcja lub generowanie nie ruszyły. Co teraz?",
      short: null,
      summary: "Najpierw sprawdź przyczynę w zadaniach w tle, a potem dodaj brakującą usługę modeli.",
      keywords: "niepowodzenie błąd transkrypcja transkrybuj synteza mowy generowanie obrazu model usługa komponent sieć zadanie model",
      steps: [
        [
          "Otwórz zadania w tle",
          "„Zadania w tle” po lewej pokazują wszystko działające w tle: z edytora, przepływu Home, agenta lub wiersza poleceń. Kliknij „Szczegóły” zadania: jeśli się nie powiodło, tytuł czerwonego pola podaje przyczynę.",
        ],
        [
          "Uzupełnij brak wskazany w szczegółach",
          "Szczegóły podają następny krok zależny od przyczyny: zainstalowanie komponentu, konfigurację modelu w chmurze, wybór modelu domyślnego lub sprawdzenie ustawień agenta.",
        ],
        [
          "Wróć i spróbuj ponownie",
          "Po naprawieniu wróć i spróbuj ponownie: kliknij znów „Utwórz napisy” w panelu napisów lub poproś agenta w sesji o ponowne wysłanie. Gdy usługa jest niedostępna, agent najpierw wskaże, którą włączyć.",
        ],
      ],
      tip: "Transkrypcja, synteza mowy i generowanie obrazów wymagają usługi modeli. Pomoc jest dostępna offline, ale usługi w chmurze wymagają sieci.",
      cta: "Zobacz modele",
    },
  },
};
