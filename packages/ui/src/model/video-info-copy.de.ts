import { pluralForm } from '@baocut/protocol';
import type { VideoInfoMessages } from './video-info-copy.ts';

export const de: VideoInfoMessages = {
  section: { media: "Quelle und Medien", source: "Quellinformationen" },
  speakers: (count: number) => `${count} ${pluralForm('de', count, { one: "Sprecher", other: "Sprecher" })}`,
  chapters: (count: number) => `${count} ${pluralForm('de', count, { one: "Kapitel", other: "Kapitel" })}`,
  paragraphs: (count: number) => `${count} ${pluralForm('de', count, { one: "Absatz", other: "Absätze" })}`,

  list: (names: readonly string[]) => names.join(", "),
  sourceKind: {
    'link-import': "Von URL importiert",
    'user-import': "Lokale Datei",
    generated: "Erzeugt",
    library: "Benutzerbibliothek",
  },
  row: {
    contents: "Inhalt",
    translation: "Übersetzung",
    location: "Speicherort",
    file: "Datei",
    media: "Material",
    transcript: "Transkription",
    channel: "Kanal",
    published: "Veröffentlicht",
    platform: "Plattform",
    mediaId: "Video-ID",
    url: "URL",
    title: "Originaltitel",
    description: "Beschreibung",
  },
};
