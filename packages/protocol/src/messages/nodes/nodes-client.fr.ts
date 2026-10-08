import type { NodesClientMessages } from './nodes-client.ts';

export const fr: NodesClientMessages = {
  badEventStream: (p) => `Le nœud ${p.label} a renvoyé une réponse de flux d’événements invalide`, badResultResponse: (p) => `Le nœud ${p.label} a renvoyé une réponse de résultat invalide`,
  badJson: (p) => `Le nœud ${p.label} n’a pas renvoyé un JSON valide`, responseTooLarge: (p) => `La réponse du nœud ${p.label} est trop volumineuse`, nodeReturnedStatus: (p) => `Le nœud a renvoyé ${p.status}`,
  timedOut: (p) => `Le nœud ${p.label} n’a pas répondu à temps`, idleTimeout: (p) => `La connexion au nœud ${p.label} a expiré pendant l’inactivité`,
  connectionFailed: (p) => `La connexion au nœud ${p.label} a échoué`, connectionFailedCode: (p) => `La connexion au nœud ${p.label} a échoué (${p.code})`,
  badStreamLine: 'Le flux d’événements contient une ligne invalide', noHeartbeat: 'Le flux d’événements n’envoie plus de signaux de présence', streamInterrupted: 'Le flux d’événements a été interrompu',
  streamInterruptedCode: (p) => `Le flux d’événements a été interrompu (${p.code})`, labelVersionIncompatible: (p) => `La version du protocole du nœud ${p.label} est incompatible avec cet ordinateur`,
  badPairResponse: (p) => `Le nœud ${p.label} a renvoyé une réponse d’appairage invalide`, pairedNodeNotFound: (p) => `Aucun nœud appairé : ${p.id}`, labelUnreachable: (p) => `Impossible de joindre le nœud ${p.label}`,
  pairRejected: (p) => `Le nœud ${p.label} a refusé l’appairage : ${p.message}`, pairFailed: (p) => `L’appairage avec le nœud ${p.label} a échoué`, nodeLabel: (p) => `Nœud ${p.alias}`,
  bundleLabel: (p) => `${p.bundleId} (${p.backend}/${p.device})`, tokenUnreadable: (p) => `Cet ordinateur ne peut pas lire le jeton de ce nœud : ${p.problem}`,
  unreachable: 'Impossible de joindre ce nœud', versionIncompatible: 'La version du protocole du nœud est incompatible avec cet ordinateur', pairingRevoked: 'Le nœud ne reconnaît plus cet appairage',
  transcribeSharingOff: 'Le nœud a désactivé le partage de la transcription. Activez-le sur cet ordinateur (baocut share capability transcribe on)', noTranscribeBundle: 'Le nœud n’a aucun paquet de modèle de transcription prêt',
  aliasTaken: (p) => `Un autre nœud utilise déjà cet alias : ${p.alias}`, aliasLength: (p) => `L’alias doit contenir entre 1 et ${p.max} caractères`, tokenNotSaved: (p) => `Le jeton du nœud n’a pas été enregistré : ${p.message}`,
  noNodeSpecified: 'Aucun nœud distant indiqué', nodeNotPaired: 'Ce nœud n’est plus dans la liste des nœuds appairés sur cet ordinateur', tokenUnreadableDefault: 'Impossible de lire le jeton',
  nodeTokenUnavailable: (p) => `Le jeton du nœud ${p.alias} est indisponible : ${p.reason}`, noToken: 'Cet ordinateur n’a pas de jeton pour ce nœud. Appairez-le à nouveau',
  mediaUnreadable: 'Impossible de lire le fichier multimédia', mediaTypeMissing: 'Le type du fichier multimédia est manquant', noBundle: 'Aucun paquet de modèle indiqué', remoteTaskFailed: 'La tâche a échoué sur le nœud',
  cancelledBySharingOff: 'Le nœud a arrêté le partage et annulé la tâche', nodeRestarted: 'Le nœud a redémarré et la tâche a été interrompue', completedWithoutOutput: 'Le nœud a annoncé la fin de la tâche sans fournir de résultat',
  resultMismatch: 'Le résultat téléchargé ne correspond pas à l’empreinte ou à la longueur annoncée par le nœud', badHealth: 'La réponse d’état du nœud est invalide', otherNodeAtAddress: 'Un autre nœud se trouve désormais à cette adresse',
  bundleNotReady: 'Le paquet de modèle est indisponible sur le nœud', capabilityDisabled: (p) => `Le nœud ${p.name} a désactivé le partage de la transcription. Activez-le sur cet ordinateur (baocut share capability transcribe on), ou transcrivez sur cet ordinateur ou un autre nœud`,
  taskGone: 'La tâche n’existe plus sur le nœud', streamEndedEarly: 'Le flux d’événements s’est terminé avant la fin de la tâche',
  reconnectFailed: (p) => `Connexion au nœud ${p.label} perdue ; toujours impossible de se reconnecter après ${p.seconds} secondes`, retryFailed: (p) => `Connexion au nœud ${p.label} perdue ; les nouvelles tentatives échouent toujours après ${p.seconds} secondes`,
};
