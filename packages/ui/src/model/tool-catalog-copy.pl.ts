import type { ToolCatalogMessages } from './tool-catalog-copy.ts';

const artifactLabels = { audio: 'Audio', image: 'Obraz', doc: 'Dokument', final: 'Plik wideo', subtitle: 'Napisy' };

export const pl: ToolCatalogMessages = {
  inputLabels: {
    file: "Plik lokalny",
    space: "Space",
    link: "Link",
    text: "Tekst",
    video: "Wideo w Space",
    document: "Dokument",
  },
  outputLabels: { video: "Wideo", artifact: "Element w Space" },
  artifactLabels,
  tools: {
    transcribe: { name: "Transkrybuj", desc: "Przekształć plik wideo lub audio w transkrypcję i napisy; dla edytowalnego wideo zapisuje je w nim i dodaje warstwę napisów" },
    'translate-subtitles': { name: "Przetłumacz napisy", desc: "Przetłumacz napisy na inny język; dla transkrybowanego wideo dodaje tłumaczenie i warstwę napisów z oboma językami, zachowując oryginał" },
    dub: { name: "Tłumaczony dubbing", desc: "Dodaj nowy dubbing transkrybowanego wideo z tłumaczenia; oryginalne audio można przyciszyć, wyciszyć lub zachować" },
    'synthesize-speech': { name: "Generuj mowę", desc: "Odczytaj na głos tekst, dokumenty i napisy Space; użyj gotowego głosu, sklonuj nagranie lub opisz głos" },
    'generate-text': { name: "Generuj tekst", desc: "Opisz potrzebę i wywołaj bezpośrednio model tekstowy dla tekstów, scenariuszy lub podsumowań; dokumenty i napisy Space można załączyć jako materiały" },
    'generate-image': { name: "Generuj obraz", desc: "Opisz obraz i narysuj modelem w chmurze lub lokalnym; obrazy referencyjne, proporcje i liczba są opcjonalne" },
    'upscale-image': { name: "Powiększ obraz", desc: "Powiększaj obrazy 2–4× na tym komputerze za pomocą Real-ESRGAN, waifu2x lub wag Upscayl albo poproś model obrazów, by narysował je od nowa w większym rozmiarze" },
    'remove-object': { name: "Usuń obiekt", desc: "Zamaluj niechciane osoby lub rzeczy, a obszar zostanie uzupełniony na podstawie otoczenia" },
    'remove-watermark': { name: "Usuń znak wodny", desc: "Zaznacz ramką znak wodny, logo lub pasek napisów; obrazy z nim w tym samym miejscu można przetworzyć za jednym razem" },
    'repaint-image': { name: "Przemaluj obszar", desc: "Zamaluj obszar i napisz, czym ma się stać; zmieni się tylko ten obszar" },
    'expand-image': { name: "Rozszerz obraz", desc: "Rozszerz kadr do nowych proporcji; dodane krawędzie są kontynuacją oryginału" },
    'generate-music': { name: 'Wygeneruj muzykę', desc: 'Opisz styl i opcjonalnie tekst, a lokalny model muzyczny skomponuje piosenkę lub utwór instrumentalny; czas trwania i seed są opcjonalne' },
    'link-import': { name: "Pobierz wideo", desc: "Wklej link, aby pobrać wideo na komputer; można użyć cookie przeglądarki i transkrybować pobrane wideo na transkrypcję i napisy" },
    'compress-video': { name: "Kompresuj wideo", desc: "Przekoduj do docelowego rozmiaru lub jakości; zmniejsz przed wysłaniem lub przesłaniem" },
    'merge-video': { name: "Scal wideo", desc: "Połącz kilka wideo kolejno w jeden plik" },
    'extract-audio': { name: "Wyodrębnij audio", desc: "Usuń obraz i zachowaj ścieżkę audio; popularne kodeki są kopiowane bez ponownego kodowania" },
  },
  targetNone: "Utwórz tylko transkrypcję i napisy",
  targetCreate: "Utwórz wideo w projekcie",
  subtitleFile: "Lokalny plik napisów",
  groups: {
    speech: {
      label: "Mowa i napisy",
      desc: "Transkrybuj, tłumacz napisy, dodawaj dubbing i czytaj na głos. Wyniki to dokumenty, napisy i audio; wybór edytowalnego wideo w Space zapisuje w nim.",
    },
    'text-image': { label: "Tekst i obrazy", desc: "Wywołuj bezpośrednio modele tekstowe i obrazów. Wyniki to dokumenty i obrazy." },
    music: { label: 'Muzyka', desc: 'Generuj piosenki i muzykę w tle lokalnym modelem muzycznym. Wyniki to elementy audio.' },
    'video-file': {
      label: "Pliki wideo",
      desc: "Pobieraj, kompresuj, łącz wideo i wyodrębniaj audio przez yt-dlp i ffmpeg na tym komputerze. Wyniki to pliki wideo i audio.",
    },
  },
  artifactItems: (artifacts) => artifacts.length ? `${artifacts.map(a => artifactLabels[a]).join(' / ')} – elementy` : 'wyniki',
  resultWritesVideo: "Wynik: zapisany w wybranym wideo",
  resultInSpace: (items) => `Wynik: ${items} w Space`,
  resultAlsoCreate: "może też utworzyć nowe wideo",
  resultWritesEditable: "zapisuje w edytowalnym wideo po wybraniu",
  joinResult: (parts) => parts.join("; "),
};
