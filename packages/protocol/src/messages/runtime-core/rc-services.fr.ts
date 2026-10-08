import type { RcServicesMessages } from './rc-services.ts';

export const fr: RcServicesMessages = {
  mcpServiceLabel: 'Service MCP', nodeServiceLabel: 'Nœud LAN', serviceNotAvailable: (p) => `Cette version ne fournit pas encore le service « ${p.serviceId} »`, serviceNotFound: (p) => `Service « ${p.serviceId} » introuvable`, runtimeStopping: 'Arrêt du Runtime en cours', clientNotFound: 'Client introuvable', portInUse: (p) => `Le port ${p.port} est déjà utilisé`, cannotListen: (p) => `Impossible d’écouter sur le port ${p.port} : ${p.reason}`,
  configFileInvalid: (p) => `Le fichier de configuration des services est mal formé : ${p.file}`, routingOnlyForModelApi: 'routing et maxConcurrentPerClient s’appliquent uniquement au service d’API de modèles (model-api)', tokenPlaceholder: (p) => `<jeton pour ${p.client}>`, tokenPlaceholderGeneric: '<jeton>', mcpNotRunning: 'Le service MCP est désactivé : démarrez-le d’abord (baocut services start mcp), sinon les clients ne peuvent pas se connecter.', nodeServiceConfigure: 'Configurez le service du nœud avec nodes.share.* (baocut share …)', nodeServiceNotListening: 'Le service du nœud n’écoute pas',
};
