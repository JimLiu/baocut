import type { SystemAccessMessages } from './system-access-copy.ts';

export const fr: SystemAccessMessages = {
  cardTitle: (names) => `Autoriser BaoCut à lire les cookies de ${names}`,
  cardBody: "macOS exige d’abord d’accorder à BaoCut l’« Accès complet au disque ». Cliquez sur « Ouvrir Réglages Système » et BaoCut vous mène directement à cette page. BaoCut ne lit que les navigateurs cochés, rien d’autre.",
  openedTitle: "Activez BaoCut dans Réglages Système, puis revenez ici",
  openedBody: "Activez le commutateur à côté de BaoCut. Quand macOS propose de quitter et rouvrir BaoCut, choisissez « Quitter et rouvrir ». Si BaoCut n’est pas dans la liste, cliquez sur « + » sous la liste pour l’ajouter. Si macOS ne propose pas de rouvrir, cliquez ci-dessous sur « Redémarrer BaoCut ».",
  open: "Ouvrir Réglages Système",
  openAgain: "Rouvrir Réglages Système",
  restart: "Redémarrer BaoCut",
  askTitle: (names) => `Autoriser d’abord l’accès aux cookies de ${names} ?`,
  askBody: (names) => `Ce téléchargement utilise votre connexion ${names}, et macOS exige d’abord d’accorder à BaoCut l’« Accès complet au disque ». Activez-le dans Réglages Système puis relancez le téléchargement, ou ignorez-le cette fois et continuez avec les autres navigateurs.`,
  skip: "Ignorer cette fois",
  settingLabel: "Accès complet au disque",
  settingAllowed: "Autorisé. BaoCut peut lire les fichiers des disques externes, du Bureau, des Documents et des Téléchargements, ainsi que les cookies de Safari, mais uniquement les médias, emplacements d’enregistrement et navigateurs que vous choisissez.",
  settingMissing: "Non autorisé. macOS empêche les apps de lire les disques externes, le Bureau, les Documents, les Téléchargements et les cookies de Safari. Une fois autorisé, BaoCut n’échouera plus à cause des permissions à ces emplacements. Il ne lit que les médias, emplacements d’enregistrement et navigateurs que vous choisissez.",
  openFailed: "Impossible d’ouvrir Réglages Système. Ouvrez vous-même Réglages Système › Confidentialité et sécurité › Accès complet au disque.",
};
