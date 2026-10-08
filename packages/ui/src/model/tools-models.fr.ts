import { pluralForm } from '@baocut/protocol';
import type { ToolsModelsMessages } from './tools-models.ts';

export const fr: ToolsModelsMessages = {
  notConnected: 'Non connecté', unavailable: 'Indisponible', notDownloaded: 'Non téléchargé', unsupported: 'Indisponible sur cette plateforme ou dans cette version',
  auto: 'Automatique', anyLanguage: 'Plusieurs langues', languages: (named) => named.join(', '),
  languagesMore: (first, total) => `${first.join(', ')} et ${total - first.length} ${pluralForm('fr', total - first.length, { one: 'autre', other: 'autres' })}`,
};
