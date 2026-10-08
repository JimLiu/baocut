import { pluralForm } from '@baocut/protocol';
import type { VideoInfoMessages } from './video-info-copy.ts';

export const nl: VideoInfoMessages = {
  section: { media: "Bron en media", source: "Broninformatie" },
  speakers: (count: number) => `${count} ${pluralForm('nl', count, { one: "spreker", other: "sprekers" })}`,
  chapters: (count: number) => `${count} ${pluralForm('nl', count, { one: "hoofdstuk", other: "hoofdstukken" })}`,
  paragraphs: (count: number) => `${count} ${pluralForm('nl', count, { one: "alinea", other: "alinea’s" })}`,

  list: (names: readonly string[]) => names.join(", "),
  sourceKind: {
    'link-import': "Geïmporteerd van URL",
    'user-import': "Lokaal bestand",
    generated: "Gegenereerd",
    library: "Gebruikersbibliotheek",
  },
  row: {
    contents: "Inhoud",
    translation: "Vertaling",
    location: "Locatie",
    media: "Media",
    transcript: "Transcriptie",
    channel: "Kanaal",
    published: "Gepubliceerd",
    platform: "Platform",
    mediaId: "Video-ID",
    url: "URL",
  },
};
