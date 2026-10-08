import type { DataGrantsMessages } from './data-grants-copy.ts';

export const fr: DataGrantsMessages = {
  title: 'Autorisations de partage de données', showEnded: (count) => `Afficher les terminées (${count})`,
  lead: 'L’envoi de données à des fournisseurs cloud nécessite une autorisation : une est accordée par défaut lorsque vous activez un fournisseur, et une autre lorsque vous choisissez « Toujours autoriser » pendant l’approbation. Après révocation, aucun nouvel appel n’envoie de données ; les données et frais déjà transmis ne peuvent pas être repris. Les modèles locaux n’ont pas besoin d’autorisation.',
  loading: 'Chargement des autorisations…', disconnected: 'Non connecté au Runtime', revoke: 'Révoquer', noActive: 'Aucune autorisation active', none: 'Aucune autorisation', emptyDesc: 'Les autorisations apparaissent ici lorsque vous activez un fournisseur cloud ou choisissez « Toujours autoriser » pendant l’approbation.',
  revokeTitle: (name) => `Révoquer « ${name} » ?`, revokeFailed: (message) => `Impossible de révoquer : ${message}`, cancel: 'Annuler',
};
