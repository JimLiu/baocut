const voices = (n: number) => pluralForm('pl', n, { one: `${n} wbudowany głos`, few: `${n} wbudowane głosy`, many: `${n} wbudowanych głosów`, other: `${n} wbudowanego głosu` });
import { pluralForm } from '@baocut/protocol';
import type { TtsLocalMessages } from './models-tts-local-copy.ts';


export const pl: TtsLocalMessages = {
  languageShort: (code: string) => { try { return new Intl.DisplayNames(['pl'], { type: 'language' }).of(code) ?? code; } catch { return code; } },
  languagesAny: "Dowolny język",
  languagesMore: (shown, total) => `${shown.join(" / ")} i inne (${total} języków)`,
  summaryCloneDescribe: (builtins, byDuration) => `${voices(builtins)}, sklonuj głos z nagrania lub utwórz nowy, wybierając płeć, wiek i wysokość${
      byDuration ? "; może czytać do docelowej długości" : ""
    }`,
  summaryClone: (builtins, style) => `${voices(builtins)} lub sklonuj głos z nagrania${style ? "; jednolinijkowy prompt ustawia styl" : ""}`,
  summaryDescribe: (builtins) => builtins
      ? `Opisz głos jednym zdaniem, model go stworzy; można też użyć bezpośrednio ${voices(builtins)}`
      : "Opisz głos jednym zdaniem, model go stworzy",
  summaryPreset: (speakers, style) => pluralForm('pl', speakers, { one: `${speakers} gotowy głos; wybierz do odczytu${style ? '; jednolinijkowy prompt ustawia ton' : ''}`, few: `${speakers} gotowe głosy; wybierz do odczytu${style ? '; jednolinijkowy prompt ustawia ton' : ''}`, many: `${speakers} gotowych głosów; wybierz do odczytu${style ? '; jednolinijkowy prompt ustawia ton' : ''}`, other: `${speakers} gotowego głosu; wybierz do odczytu${style ? '; jednolinijkowy prompt ustawia ton' : ''}` }),
  modeCloneDescribe: "Wbudowane głosy / Klon / Opis",
  modeClone: "Wbudowane głosy / Klon",
  modeDescribe: "Głos z opisu",
  modePreset: "Gotowe głosy",
  factStyle: "Polecenie stylu",
  factSlow: "Wolniejszy",
  nonCommercialChip: "Tylko niekomercyjnie",
  licenseCommercial: (name) => `${name} · Użytek komercyjny dozwolony`,
  licenseNonCommercial: (name, owner) => `${name} · Tylko niekomercyjnie · Dla użytku komercyjnego wystąp do ${owner} osobno`,
  familyDesc: {
    'qwen3-tts':
      "Qwen3-TTS: CustomVoice ma 9 gotowych mówców i ustawia ton jednolinijkowym promptem; Base klonuje nagranie; 1.7B VoiceDesign tworzy głos z opisu. 1.7B brzmi lepiej, ale jest wolniejszy.",
    indextts2: "IndexTTS: osiem wbudowanych głosów lub klon własnego nagrania; bierze tylko barwę, nie odczytuje transkrypcji. IndexTTS 2.5 zmienia też tempo mowy.",
    'gpt-sovits': "GPT-SoVITS: osiem wbudowanych głosów lub klon własnego nagrania; brzmi podobniej z transkrypcją nagrania, wtedy musi mieć 3–10 sekund.",
    voxcpm2: "VoxCPM2: osiem wbudowanych głosów lub klon własnego nagrania; najbliższy z transkrypcją, styl ustawia jednolinijkowy prompt; wynik 48 kHz.",
    omnivoice: "OmniVoice: osiem wbudowanych głosów, klon własnego nagrania lub nowy głos z płcią, wiekiem i wysokością ze słownika; czyta najwięcej języków. Tylko niekomercyjnie.",
  },
  quickDescribe: "Głos wynika całkowicie z opisu: zmień opis, a otrzymasz inną osobę",
  quickVoxcpm: "Około czasu rzeczywistego: generowanie zdania trwa tyle co odczyt; pierwsze wczytanie około 5 sekund",
  quickNonCommercial: (license) => `Tylko niekomercyjnie (${license}): dla treści komercyjnych wybierz inny model`,
  quickSlow: "Duży model: synteza wolniejsza od podobnych, pierwsze wczytanie dłuższe",
};
