import type { JobsLinkUrlMessages } from './link-url.ts';

export const fr: JobsLinkUrlMessages = {
  startsWithDash: "Un lien ne peut pas commencer par -",
  invalidLink: "Lien invalide",
  httpOnly: "Seuls les liens http(s):// sont acceptés",
  credentials: "Les liens ne peuvent pas inclure de nom d’utilisateur ou mot de passe",
  noHost: "Le lien n’a aucun nom d’hôte",
  privateAddress: "Import impossible depuis des adresses locales, link-local ou privées",
  redacted: "[lien]",
  unresolvable: (p: { host: string }) => `Impossible de résoudre le nom d’hôte ${p.host} : vérifiez le réseau et le lien`,
  noAddresses: (p: { host: string }) => `Le nom d’hôte ${p.host} n’a aucune adresse`,
  resolvesPrivate: (p: { host: string }) => `${p.host} pointe vers une adresse locale, link-local ou privée ; import impossible`,
};
