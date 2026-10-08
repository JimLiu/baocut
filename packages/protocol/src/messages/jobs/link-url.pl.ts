import type { JobsLinkUrlMessages } from './link-url.ts';

export const pl: JobsLinkUrlMessages = {
  startsWithDash: "Link nie może zaczynać się od -",
  invalidLink: "Nieprawidłowy link",
  httpOnly: "Akceptowane są tylko linki http(s)://",
  credentials: "Linki nie mogą zawierać nazwy użytkownika ani hasła",
  noHost: "Link nie ma nazwy hosta",
  privateAddress: "Nie można importować z adresów lokalnych, link-local ani sieci prywatnych",
  redacted: "[link]",
  unresolvable: (p: { host: string }) => `Nie można rozpoznać nazwy hosta ${p.host}: sprawdź sieć i link`,
  noAddresses: (p: { host: string }) => `Nazwa hosta ${p.host} nie ma adresów`,
  resolvesPrivate: (p: { host: string }) => `${p.host} wskazuje na adres lokalny, link-local lub sieci prywatnej; import jest niemożliwy`,
};
