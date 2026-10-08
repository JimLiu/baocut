import type { JobsLinkUrlMessages } from './link-url.ts';

export const de: JobsLinkUrlMessages = {
  startsWithDash: "Ein Link darf nicht mit - beginnen",
  invalidLink: "Kein gültiger Link",
  httpOnly: "Nur http(s)://-Links werden akzeptiert",
  credentials: "Links dürfen keinen Benutzernamen oder Passwort enthalten",
  noHost: "Der Link hat keinen Hostnamen",
  privateAddress: "Import von lokalen, Link-Local- oder privaten Netzwerkadressen nicht möglich",
  redacted: "[Link]",
  unresolvable: (p: { host: string }) => `Hostname konnte nicht aufgelöst werden: ${p.host}: Netzwerk und Link prüfen`,
  noAddresses: (p: { host: string }) => `Hostname ${p.host} hat keine Adressen`,
  resolvesPrivate: (p: { host: string }) => `${p.host} wird in eine lokale, Link-Local- oder private Netzwerkadresse aufgelöst; Import ist nicht möglich`,
};
