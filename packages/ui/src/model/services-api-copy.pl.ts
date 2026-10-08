import { pluralForm } from '@baocut/protocol';
import type { ServicesApiMessages } from './services-api-copy.ts';

export const pl: ServicesApiMessages = {
  capabilities: {
    transcribe: "Transkrybuj",
    synthesizeSpeech: "Synteza mowy",
    generateImage: "Generowanie obrazów",
    generateText: "Generuj tekst",
  },
  endpoints: {
    models: "Lista modeli",
    model: "Pobierz model",
    info: "Informacje o usłudze i wersja interfejsu",
    transcriptions: "Transkrybuj audio",
    speech: "Synteza mowy",
    images: "Generowanie obrazów",
    chat: "Generuj tekst (czat)",
  },
  routing: {
    online: { label: "Usługi online", desc: "Przekazuj żądania połączonym usługom w chmurze (może kosztować; dane opuszczają ten komputer)" },
    nodes: { label: "Węzły sieci lokalnej", desc: "Przekazuj żądania innym sparowanym komputerom" },
    agent: { label: "Agenci", desc: "Przekazuj żądania środowiskom agentów zalogowanym na tym komputerze (na przykład Codex)" },
  },
  modelsAvailable: (n) => pluralForm('pl', n, { one: `Dostępny ${n} model`, few: `Dostępne ${n} modele`, many: `Dostępnych ${n} modeli`, other: `Dostępne ${n} modelu` }),
  notRouted: "Modele są dostępne, ale routing ich kategorii jest wyłączony; żądania otrzymują na razie 503",
  noModels: "Nie ma jeszcze dostępnych modeli; żądania otrzymują na razie 503",
  defaultModel: "Domyślny model",
  target: (provider, model) => `${provider} · ${model}`,
  aliasProviderMissing: "Nie można znaleźć dostawcy; żądania otrzymują 404",
  aliasNotRouted: "Routing tej kategorii jest wyłączony; żądania otrzymują 404",
  aliasProviderUnavailable: "Ten dostawca jest teraz niedostępny",
  aliasModelUnavailable: "Ten model jest teraz niedostępny",
  targetNotRouted: "Routing wyłączony",
  targetUnavailable: "Teraz niedostępne",
  aliasNameEmpty: "Wpisz nazwę, na przykład whisper-1",
  aliasNameSlash: "Nazwy nie mogą zawierać „/”: <provider>/<model> to postać kanoniczna i aliasy nie mogą z nią kolidować",
  aliasNameChars: "Używaj tylko liter, cyfr i . _ : -, zaczynając od litery lub cyfry",
  aliasNameTaken: (name) => `„${name}” już istnieje; aby zmienić cel, najpierw usuń ten wiersz`,
};
