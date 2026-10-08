import type { EditorOpsMessages } from './editor-ops.ts';
import { pluralForm } from '@baocut/protocol';
const filesFr = (n: number) => `${n} ${pluralForm('fr', n, { one: 'fichier', other: 'fichiers' })}`;
const sentencesFr = (n: number) => `${n} ${pluralForm('fr', n, { one: 'phrase', other: 'phrases' })}`;

export const fr: EditorOpsMessages = {
  dubStatus: { failed: 'Non synthétisé', 'needs-fit': 'Trop long', stale: 'Traduction obsolète', draft: 'Non placé' }, dubStatusCount: (n, status) => `${sentencesFr(n)} ${{ failed: pluralForm('fr', n, { one: 'non synthétisée', other: 'non synthétisées' }), 'needs-fit': pluralForm('fr', n, { one: 'trop longue', other: 'trop longues' }), stale: 'avec traduction obsolète', draft: pluralForm('fr', n, { one: 'non placée', other: 'non placées' }) }[status]}`, stemVocals: 'Voix séparées', stemBackground: 'Fond séparé', background: 'Arrière-plan', sentenceN: (n) => `Phrase ${n}`, dub: 'Doublage', files: filesFr, sentences: sentencesFr, muted: (n) => `${sentencesFr(n)} en sourdine`, dubTitle: (language) => `Doublage · ${language ?? 'Langue inconnue'}`, aside: (groups, files) => groups ? `${groups} ${pluralForm('fr', groups, { one: 'groupe de doublage', other: 'groupes de doublage' })} · ${filesFr(files)}` : filesFr(files),
};
