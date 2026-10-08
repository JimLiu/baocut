import { pluralForm } from '@baocut/protocol';
import type { VideoInfoMessages } from './video-info-copy.ts';

export const pl: VideoInfoMessages = {
  section: { media: "Źródło i multimedia", source: "Informacje o źródle" },
  speakers: (count: number) => pluralForm('pl', count, { one: `${count} mówca`, few: `${count} mówców`, many: `${count} mówców`, other: `${count} mówcy` }),
  chapters: (count: number) => pluralForm('pl', count, { one: `${count} rozdział`, few: `${count} rozdziały`, many: `${count} rozdziałów`, other: `${count} rozdziału` }),
  paragraphs: (count: number) => pluralForm('pl', count, { one: `${count} akapit`, few: `${count} akapity`, many: `${count} akapitów`, other: `${count} akapitu` }),
  list: (names: readonly string[]) => names.join(", "),
  sourceKind: {
    'link-import': "Zaimportowane z URL",
    'user-import': "Plik lokalny",
    generated: "Wygenerowane",
    library: "Biblioteka użytkownika",
  },
  row: {
    contents: "Zawartość",
    translation: "Tłumaczenie",
    location: "Lokalizacja",
    file: "Plik",
    media: "Multimedia",
    transcript: "Transkrypcja",
    channel: "Kanał",
    published: "Opublikowano",
    platform: "Platforma",
    mediaId: "ID wideo",
    url: "Adres URL",
    title: "Oryginalny tytuł",
    description: "Opis",
  },
};
