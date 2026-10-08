import type { JobsLinkUrlMessages } from './link-url.ts';

export const nl: JobsLinkUrlMessages = {
  startsWithDash: "Een link mag niet beginnen met -",
  invalidLink: "Geen geldige link",
  httpOnly: "Alleen http(s)://-links worden geaccepteerd",
  credentials: "Links mogen geen gebruikersnaam of wachtwoord bevatten",
  noHost: "De link heeft geen hostnaam",
  privateAddress: "Kan niet importeren vanaf lokale, link-local- of privénetwerkadressen",
  redacted: "[link]",
  unresolvable: (p: { host: string }) => `Kan de hostnaam niet omzetten: ${p.host}: controleer het netwerk en de link`,
  noAddresses: (p: { host: string }) => `Hostnaam ${p.host} heeft geen adressen`,
  resolvesPrivate: (p: { host: string }) => `${p.host} wordt omgezet naar een lokaal, link-local- of privénetwerkadres; importeren is niet mogelijk`,
};
