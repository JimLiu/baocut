import type { RuntimeStorageGrantsMessages } from './runtime-storage-grants.ts';

export const fr: RuntimeStorageGrantsMessages = {
  localNeedsNoGrant: "Le calcul local ne nécessite aucune autorisation",
  dataKindRequired: "Indiquez au moins un type de données",
  budgetCapRequired: "Une autorisation avec plafond de dépenses nécessite budgetCap",
  unknownCostNoCap: "Une autorisation au coût inconnu ne peut pas avoir de plafond. Utilisez estimate-cap pour en fixer un",
  expiryPassed: "La date d’expiration est déjà passée",
  grantNotFound: "Autorisation inconnue",
  grantRevoked: "L’autorisation a été révoquée et ne peut plus être modifiée. Accordez-en une autre",
  cannotRemoveCap: "Une autorisation avec plafond ne peut pas supprimer son plafond. Révoquez-la et accordez-en une au coût inconnu",
  unknownCostCannotCap: "Une autorisation au coût inconnu ne peut pas définir de plafond. Révoquez-la et accordez-en une avec estimate-cap",
  cannotChangeCurrency: "La devise ne peut pas être modifiée",
  expiryPassedRevoke: "La date d’expiration est déjà passée. Révoquez-la pour l’arrêter maintenant",
  revokeNote:
    "Après révocation, aucun nouvel appel ; les appels en file sont refusés au démarrage. Données déjà envoyées et coûts engagés ne peuvent pas être annulés localement ; les appels en cours se terminent normalement et comptent dans l’utilisation.",
  taskCallLimit: "La limite d’appels du budget de tâche doit être un entier positif",
  providerGrantPurpose: (p: { label: string }) => `Accordée par défaut à l’activation de ${p.label}`,
  invalidCurrency: (p: { currency: string }) => `La devise doit comporter trois lettres majuscules (ISO 4217) : ${p.currency}`,
};
