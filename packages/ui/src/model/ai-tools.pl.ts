import { intlLocale } from '@baocut/protocol';
const scopeOf = (o: { scope: string | null; p: string }) => o.scope ? `${o.scope} w ${o.p}` : o.p;
import { pluralForm } from '@baocut/protocol';
import type { AiToolsMessages } from './ai-tools.ts';

const soonTail = 'Runtime nie ma jeszcze tego procesu ani nakładki kadrowania, więc formularz działania niedostępny.';

export const pl: AiToolsMessages = {
  groups: {
    frame: "Ramka",
    transcript: "Transkrypcja",
    translate: "Tłumaczenie",
    writing: "Pisanie",
    publish: "Publikowanie",
  },
  tools: {
    crop: {
      name: "Inteligentne kadrowanie",
      desc: "Zmień proporcje, zachowując mówców, tablice i kluczowe obiekty w kadrze",
      why: `Inteligentne kadrowanie musi śledzić mówców, tablice i kluczowe obiekty, potem przyciąć do nowych proporcji. ${soonTail}`,
    },
    shortscut: {
      name: "Potnij na krótkie filmy",
      desc: "Wybierz kilka segmentów wideo i zrób z każdego pionowy krótki film",
      why: `Krótkie filmy powstają przez wybór segmentów, pionowe przycięcie i dostosowanie kadrowania segment po segmencie. ${soonTail}`,
    },
    polish: {
      name: "Ulepsz transkrypcję",
      desc: "Popraw literówki, dodaj interpunkcję, podziel na akapity – bez przepisywania",
      setup: [
        "Popraw oczywiste literówki, dodaj interpunkcję i podziel na akapity według tematu.",
        "Tekst nie jest przepisywany ani usuwany – poprawiane tylko oczywiste błędy.",
      ],
    },
    chapters: {
      name: "Wygeneruj rozdziały",
      desc: "Dzieli długie wideo na rozdziały z tytułami",
      setup: ["Grupuj akapity w rozdziały według tematu i nadaj tytuły.", "Eksport i strona udostępniania używają tych samych rozdziałów."],
    },
    speakers: {
      name: "Zidentyfikuj mówców",
      desc: "Rozpoznaj mówcę; imiona w napisach i transkrypcji",
    },
    retranscribe: {
      name: "Transkrybuj ponownie",
      desc: "Ponów audio innym modelem – możesz jedną część lub segment",
      setup: [
        "Ponów innym modelem mowy i zastąp dane słów w zakresie.",
        "Transkrypcja, napisy i tłumaczenia poza zakresem bez zmian.",
      ],
    },
    cleanup: {
      name: "Znajdź cięcia",
      desc: "Znajdź wypełniacze, długie pauzy i złe ujęcia; sprawdź propozycje przed cięciem",
      setup: [
        "Znajdź wypełniacze, pauzy od 0,8 s i powtórzone początki zdań.",
        "Najpierw lista proponowanych cięć do potwierdzenia.",
      ],
    },
    translate: { name: "Przetłumacz napisy", desc: "Tłumacz zdanie po zdaniu i dopasuj kody czasowe według danych słów" },
    stale: {
      name: "Odśwież nieaktualne tłumaczenia",
      desc: "Tłumacz ponownie tylko zdania ze zmienionym lub wyciętym źródłem",
      setup: [
        "Tłumacz ponownie tylko zmienione zdania: edytowane lub z wyciętą częścią.",
        "Tłumacz z wyciętego źródła; tłumaczenia całkowicie wyciętych zdań są wycinane razem. Reszta bez zmian.",
      ],
    },
    dub: {
      name: "Przetłumacz dubbing",
      desc: "Wybierz język dubbingu głosem oryginalnego mówcy lub native speakera; ustawienia domyślne wystarczą",
    },
    summary: { name: "Napisz podsumowanie", desc: "Tekst i kluczowe punkty z czasem; kliknij czas, aby przejść" },
    blog: { name: "Napisz wpis na blog", desc: "Przepisz jako artykuł z perspektywy autora lub widza" },
    title: { name: "Zaproponuj tytuły", desc: "Uzyskaj kilka propozycji z różnych perspektyw i wybierz" },
    desc: { name: "Napisz opis", desc: "Opis do publikacji z kodami czasowymi rozdziałów i tagami" },
    cover: { name: "Zrób okładkę", desc: "Utwórz kilka okładek z klatek kluczowych i wybierz" },
  },
  unknownTool: (id: string) => `Brak takiego narzędzia AI: ${id}`,
  cleanup: {
    fillers: {
      label: "Wypełniacze",
      sub: "Słowa jak „yyy”, „eee”, „jakby” i „wiesz”",
      off: "wypełniacze",
    },
    pauses: { label: "Długie pauzy ≥ 0,8 s", sub: "Znalezione według czasu słów", off: "długie pauzy" },
    repeats: {
      label: "Powtórzone początki",
      sub: "Zdanie rozpoczęte dwa razy; późniejsze zachowane",
      off: "powtórzone początki",
    },
  },
  cleanupOff: (offs: readonly string[]) => `Nie szukaj ${new Intl.ListFormat(intlLocale(), { type: "conjunction" }).format(offs)}`,
  lengths: { short: "Krótko", medium: "Średnio", long: "Długo" },
  styles: {
    plain: "Sam tekst",
    pop: "Popularnonaukowo",
    sharp: "Zgryźliwie",
    light: "Luźno",
    pro: "Profesjonalnie",
    custom: "Niestandardowe…",
  },
  views: { auto: "Automatyczny", author: "Jestem autorem", viewer: "Jestem widzem" },
  coverText: {
    none: "Brak tekstu",
    phrase: "Krótka fraza",
    'phrase-sub': "Fraza i wiersz drobnego tekstu",
  },
  viewName: { author: "autor", viewer: "widz" },
  extraScope: (scope: string) => `Skup się tylko na ${scope}`,
  extraLength: (label: string) => `Długość: ${label}`,
  extraStyle: (style: string) => `Styl: ${style}`,
  extraLanguage: (language: string) => `Napisz po ${language}`,
  extraView: (view: string) => `Punkt widzenia: ${view}`,
  extraPlatform: (platform: string) => `Publikacja na: ${platform}. Przestrzegaj zasad i przypomnij sprawdzić po ukończeniu`,
  extraIdea: (idea: string) => `Główne przesłanie okładki: ${idea}`,
  extraRatio: (ratio: string) => `Proporcje ${ratio}`,
  extraCoverText: (label: string) => `Tekst okładki: ${label}`,
  titled: (title: string) => `„${title}”`,
  thisVideo: "tego wideo",
  sourceEdited: (n: number | null) => n === null ? "źródło zmienione" : pluralForm('pl', n, { one: `${n} zdanie zmienione w źródle`, few: `${n} zdania zmienione w źródle`, many: `${n} zdań zmienionych w źródle`, other: `${n} zdania zmienionego w źródle` }),
  sourceCut: (n: number | null) => n === null ? "źródło wycięte" : pluralForm('pl', n, { one: `${n} zdanie wycięte w źródle`, few: `${n} zdania wycięte w źródle`, many: `${n} zdań wyciętych w źródle`, other: `${n} zdania wyciętego w źródle` }),
  sourceJoin: (parts: readonly string[]) => parts.join(", "),
  intents: {
    stale: (o) => `Niektóre tłumaczenia w ${o.p} nieaktualne${o.why ? ` (${o.why})` : " przez zmianę źródła"}. Tłumacz ponownie tylko te zdania${o.cut ? "; wycięte tłumacz z wyciętego źródła, tłumaczenia całkowicie wyciętych zdań usuń razem" : ""}. Resztę pozostaw bez zmian.`,
    polish: (o) => `Popraw transkrypcję ${scopeOf(o)}: popraw literówki, dodaj interpunkcję i podziel na akapity tematyczne bez przepisywania.`,
    chapters: (o) => `Podziel ${o.p} na rozdziały tematyczne i nadaj krótkie tytuły.`,
    speakers: (o) => `Rozpoznaj mówców w ${scopeOf(o)}. Pokaż wyniki do potwierdzenia przed zapisem w wideo.`,
    retranscribe: (o) => `Transkrybuj ponownie ${scopeOf(o)} innym modelem mowy, zachowując wszystko poza zakresem.`,
    cleanup: (o) => `Znajdź wypełniacze, długie pauzy i powtórzone początki w ${scopeOf(o)}. Najpierw wymień; potwierdzę przed cięciem.`,
    summary: (o) => `Napisz kluczowe punkty z kodami czasowymi z transkrypcji ${o.p}.`,
    blog: (o) => `Przepisz ${o.p} jako gotowy wpis blogowy.`,
    title: (o) => `Zaproponuj ${o.count} propozycji tytułu dla ${o.p} z różnych perspektyw, z krótkim uzasadnieniem, i poleć jedną.`,
    desc: (o) => `Napisz opis ${o.p} do publikacji z kodami czasowymi rozdziałów i wierszem tagów.`,
    cover: (o) => `Utwórz ${o.count} propozycji okładki dla ${o.p}: najpierw wybierz klatki kluczowe, użyj różnych podejść do obrazu bazowego i sprawdź w małym rozmiarze przed pokazaniem.`,
  },
  endSentence: (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`),
  joinPrompt: (head: string, extra: readonly string[]) => [head, ...extra].join(" "),
};
