import type { ThreadMessages } from './thread-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const fr: ThreadMessages = {
  videoTools: { videos_list: 'Lister les vidéos', videos_create: 'Nouvelle vidéo', videos_inspect: 'Lire la vidéo', edits_apply: 'Modifier la vidéo', edits_undo: 'Annuler les modifications' },
  toolTitle: (action, label) => `${action} : ${label}`,
  steps: { command: 'Exécuter une commande', read: 'Lire un fichier', edit: 'Modifier un fichier', search: 'Rechercher', other: 'Autre outil' },
  phrase: {
    command: 'commandes exécutées',
    read: (count) => `${count} ${pluralForm('fr', count, { one: 'fichier lu', other: 'fichiers lus' })}`,
    edit: (count) => `${count} ${pluralForm('fr', count, { one: 'fichier modifié', other: 'fichiers modifiés' })}`,
    search: 'recherche effectuée',
    video: (count) => `${count} ${pluralForm('fr', count, { one: 'modification vidéo validée', other: 'modifications vidéo validées' })}`,
    tool: 'outils appelés',
  },
  summary: (phrases) => { const text = phrases.join(', '); return text.charAt(0).toUpperCase() + text.slice(1); },
  thinking: 'Réflexion', stepsFallback: 'Étapes',
};
