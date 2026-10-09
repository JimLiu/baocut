import type { ThreadMessages } from './thread-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const fr: ThreadMessages = {
  withDetail: (text, detail) => `${text} (${detail})`, copy: 'Copier', copied: 'Copié', copyFailed: 'Impossible de copier. Réessayez', copyCode: 'Copier le code', copyReply: 'Copier cette réponse',
  change: {
    added: (n) => `${n} ${pluralForm('fr', n, { one: 'ajouté', other: 'ajoutés' })}`, updated: (n) => `${n} ${pluralForm('fr', n, { one: 'modifié', other: 'modifiés' })}`, deleted: (n) => `${n} ${pluralForm('fr', n, { one: 'supprimé', other: 'supprimés' })}`, duration: (clock) => `Durée ${clock}`, durationChange: (before, after) => `Durée ${before} → ${after}`, revision: (before, after) => `Version ${before} → ${after}`, locked: 'La vidéo ne peut pas être modifiée pour le moment', undoStep: (videoName, label) => `Étape annulée dans « ${videoName} » : ${label}`, changed: (videoName, label) => `« ${videoName} » modifié : ${label}`, aria: (label) => `Modification vidéo : ${label}`,
  },
  message: { contextTitle: 'État de l’éditeur envoyé avec le message', context: (videoName, revision, playhead, selected) => `« ${videoName} » · Version ${revision} · Tête de lecture ${playhead}${selected ? ` · ${selected} ${pluralForm('fr', selected, { one: 'clip sélectionné', other: 'clips sélectionnés' })}` : ''}` },
  output: { aria: (name, detail) => `${name}, ${detail}` },
  steps: { more: (n) => `${n} en cours`, failed: (n) => `${n} en échec`, thinking: 'Réflexion', viewFile: (name) => `Afficher ${name}`, input: 'Entrée', error: 'Erreur', output: 'Résultat', waiting: 'En attente du résultat', noOutput: 'Aucun résultat' },
};
