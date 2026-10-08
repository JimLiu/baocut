import { pluralForm } from '@baocut/protocol';
import type { VideoCardsMessages } from './video-cards-copy.ts';

export const de: VideoCardsMessages = {

  earlier: (count: number) => `${count} frühere`,

  pending: (count: number) => (pluralForm('de', count, { one: "1 erfordert Aufmerksamkeit", other: `${count} erfordern Aufmerksamkeit` })),

  earlierWithPending: (count: number, pending: number) =>
    `${count} frühere, ${pluralForm('de', pending, { one: "1 erfordert Aufmerksamkeit", other: `${pending} erfordern Aufmerksamkeit` })}`,

  earlierList: "Frühere Einträge",
};
