import type { VoicesLibraryMessages } from './voices-library-copy.ts';

export const fr: VoicesLibraryMessages = {
  consentStatement: 'C’est ma propre voix, ou j’ai l’autorisation du locuteur', uploading: (label) => `Envoi vers ${label}…`,
  noConsent: 'Voix personnelle ou autorisation du locuteur non déclarée ; aucun envoi à un tiers. Cochez d’abord la déclaration dans « Modifier ».',
  cannotClone: (label) => `Ce Runtime ne peut pas cloner sur ${label}`,
  providerOff: (label, detail) => `${label} est indisponible pour le moment${detail ? ` (${detail})` : ''} : activez-le d’abord et saisissez la clé dans « Modèles cloud »`,
  consentUnstated: 'Consentement non déclaré', cloned: (label) => `Cloné sur ${label}`, cloneStale: (label) => `Clone sur ${label} obsolète`, languageUnknown: 'Langue non précisée',
  recorded: 'Enregistré dans l’application', imported: 'Importé depuis un fichier', edited: (ago) => `Modifié ${ago}`, nameRequired: 'Donnez un nom à la voix',
  nameTooLong: (max) => `Les noms sont limités à ${max} caractères`, transcriptTooLong: (max) => `Les transcriptions sont limitées à ${max} caractères`, dontKnow: 'Je ne sais pas',
  deleteClones: (labels) => `Ses clones sur ${labels.join(', ')} sont supprimés d’abord ; si cela échoue, la voix est conservée.`,
  deleteBody: (clones) => `Les vidéos qui l’utilisent reviendront à la voix par défaut à la prochaine génération ; les doublages déjà générés restent inchangés. ${clones}`.trim(),
  uploadNotice: (name, size, label) => `L’enregistrement de référence de « ${name} »${size ? ` (${size})` : ''} sera envoyé à ${label} pour créer un clone. Ensuite, utiliser cette voix sur ${label} utilise directement son ID de voix ; supprimer la voix supprime d’abord ce clone.`,
  withRemedy: (message, remedy) => `${message.replace(/[。.]$/, '')}. ${remedy}`,
  remedyConsent: 'Les voix sans déclaration de consentement ne sont pas envoyées à des tiers : cochez d’abord la déclaration dans « Modifier ».',
  remedyConfigure: 'Activez ce fournisseur et saisissez sa clé dans « Modèles cloud ».',
  remedyConflict: 'Cette voix vient d’être modifiée ailleurs. La dernière version est affichée ci-dessous ; vérifiez-la avant d’enregistrer.',
  remedyGrant: 'Envoyer l’enregistrement de référence à un fournisseur nécessite une autorisation d’envoi : accordez-en une dans les Réglages, puis réessayez.',
};
