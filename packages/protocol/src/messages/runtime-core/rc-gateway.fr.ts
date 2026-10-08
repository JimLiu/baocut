import type { RcGatewayMessages } from './rc-gateway.ts';

export const fr: RcGatewayMessages = {
  helloTimeout: 'Le délai de la négociation a expiré', textFramesOnly: 'Seules les trames texte sont acceptées', frameNotJson: 'La trame n’est pas un JSON valide', frameUnrecognized: 'Trame non reconnue', unknownMethod: (p) => `Méthode inconnue : ${p.method}`,
  invalidParams: 'Paramètres invalides', helloRequired: 'La première trame doit être hello', invalidToken: 'Jeton invalide', protocolMismatch: (p) => `Versions du protocole incompatibles : client ${p.client}, Runtime ${p.runtime}`, internalError: 'Erreur interne', catalogLocalOnly: 'Le catalogue d’outils est uniquement disponible dans le CLI local et l’application de bureau',
};
