import type { LinkCookiesMessages } from './link-cookies.ts';

const andList = (names: readonly string[]) => new Intl.ListFormat('fr', { type: 'conjunction' }).format(names);

export const fr: LinkCookiesMessages = {
  noneChecked: "Sans cases cochées, téléchargement anonyme. Si connexion ou vérification requise, connectez-vous dans le navigateur puis cochez-le.",
  oneChecked: (name: string) => `Utilise les cookies de ${name} pour accéder au site.`,
  manyChecked: (names: readonly string[]) =>
    `Essaie ${names.join(" → ")} dans cet ordre : cookies illisibles ou connexion encore demandée, passe au suivant et s’arrête au premier réussi. Résultat indiquant lequel.`,
  privacy: "Seuls les navigateurs cochés sont lus. yt-dlp utilise leurs cookies localement pour ce site seulement ; BaoCut mémorise seulement les noms, jamais les cookies.",
  keychain: (names: readonly string[]) =>
    `macOS demandera l’accès au trousseau une fois pour ${names.length > 1 ? `chacun de ${andList(names)}` : names[0]}. Choisissez « Toujours autoriser » pour éviter une nouvelle demande.`,
  safariAccess: "Pour Safari, autorisez BaoCut dans Réglages Système › Confidentialité et sécurité › Accès complet au disque.",
  chromiumLocked: (names: readonly string[]) =>
    names.length > 1
      ? `Tant que ${andList(names)} sont ouverts, bases de cookies verrouillées et illisibles. Fermez complètement ces navigateurs, processus en arrière-plan compris.`
      : `Tant que ${names[0]} est ouvert, base de cookies verrouillée et illisible. Fermez complètement ce navigateur, arrière-plan compris.`,
  appBound: (names: readonly string[]) =>
    `Sous Windows, ${andList(names)} habituellement ${names.length > 1 ? "protègent" : "protège"} les cookies avec App-Bound Encryption ; yt-dlp peut ne pas les lire même après fermeture.`,

  firefoxTip: " Si connexion nécessaire, connectez-vous dans Firefox et cochez Firefox.",
  noBrowsers: "Aucun cookie local trouvé, téléchargements anonymes seulement. Après connexion dans un navigateur, cliquez « Détecter à nouveau les navigateurs ».",
  used: (name: string) => `Utilisé : ${name} : cookies`,
};
