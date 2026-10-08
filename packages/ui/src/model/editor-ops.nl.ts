import type { EditorOpsMessages } from './editor-ops.ts';
import { pluralForm } from '@baocut/protocol';
const DUB_STATUS = { failed: 'Niet gesynthetiseerd', 'needs-fit': 'Te lang', stale: 'Vertaling verouderd', draft: 'Niet geplaatst' } as const;
const filesNl = (n: number) => `${n} ${pluralForm('nl', n, { one: 'bestand', other: 'bestanden' })}`;
const sentencesNl = (n: number) => `${n} ${pluralForm('nl', n, { one: 'zin', other: 'zinnen' })}`;
export const nl: EditorOpsMessages = { dubStatus: DUB_STATUS, dubStatusCount: (n, status) => `${sentencesNl(n)} ${{ failed: 'niet gesynthetiseerd', 'needs-fit': 'te lang', stale: 'met verouderde vertaling', draft: 'niet geplaatst' }[status]}`, stemVocals: 'Gescheiden spraak', stemBackground: 'Gescheiden achtergrond', background: 'Achtergrond', sentenceN: (n) => `Zin ${n}`, dub: 'Nasynchronisatie', files: filesNl, sentences: sentencesNl, muted: (n) => `${sentencesNl(n)} gedempt`, dubTitle: (language) => `Nasynchronisatie · ${language ?? 'Onbekende taal'}`, aside: (groups, files) => groups ? `${groups} ${pluralForm('nl', groups, { one: 'nasynchronisatiegroep', other: 'nasynchronisatiegroepen' })} · ${filesNl(files)}` : filesNl(files) };
