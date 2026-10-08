import type { NodesServerMessages } from './nodes-server.ts';

export const fr: NodesServerMessages = {
  taskRequestInvalid: 'Demande de tâche invalide', transcribeNotShared: 'Le nœud ne partage pas la transcription', bundleNotReady: 'Le paquet de modèle est indisponible sur le nœud', inputTooLarge: 'Le média dépasse la limite du nœud',
  diskLow: 'Le nœud manque d’espace disque', uploadExpired: 'L’envoi n’a pas été terminé à temps après la création de la tâche', notAwaitingUpload: 'La tâche n’attend pas d’envoi', lengthMismatch: 'La longueur envoyée ne correspond pas à la longueur déclarée',
  noLongerAwaitingUpload: 'La tâche n’attend plus d’envoi', digestMismatch: 'Le contenu envoyé ne correspond pas à l’empreinte déclarée', digestOrLengthMismatch: 'Le contenu envoyé ne correspond pas à l’empreinte ou à la longueur déclarée',
  notAccepted: 'Le nœud n’a pas pu accepter cette tâche', resultDeleted: 'Le résultat a été supprimé', taskNotFound: 'La tâche n’existe pas', taskNotCompleted: 'La tâche n’est pas terminée',
  idempotencyConflict: 'Même clientJobId mais contenu de demande différent', queueFull: 'Ce client a atteint sa limite de tâches', completedWithoutResult: 'La tâche s’est terminée sans résultat', sourceNotAllowed: 'L’adresse source n’est pas autorisée',
  protocolTooOld: 'La version du protocole est trop ancienne ou manquante', pairRequestInvalid: 'Demande d’appairage invalide', tokenInvalid: 'Le jeton est invalide ou révoqué', noEndpoint: 'Point de terminaison introuvable',
  methodNotAllowed: 'Ce point de terminaison ne prend pas en charge cette méthode', contentLengthRequired: 'Les envois doivent inclure Content-Length', badUrl: 'URL de requête invalide', requestFailed: 'Le traitement de la requête a échoué',
  bodyTooLarge: 'Le corps de la requête dépasse 64 Kio', bodyNotJson: 'Le corps de la requête n’est pas un JSON valide', sinceInvalid: 'since doit être un entier positif ou nul', runtimeStopping: 'Arrêt du Runtime en cours',
  sharingOff: 'Le partage est désactivé', clientNotFound: 'Client introuvable', listSeparator: ', ', capabilityNotShareable: (p) => `Le nœud ne peut pas partager cette capacité : ${p.capability} (partageable : ${p.shareable})`,
  pairingLocked: 'L’appairage est verrouillé', pairingCodeInvalid: 'Le code d’appairage est incorrect, expiré ou manquant', portInUse: (p) => `Le port ${p.port} est déjà utilisé`, cannotListen: (p) => `Le service du nœud ne peut pas écouter : ${p.code}`,
};
