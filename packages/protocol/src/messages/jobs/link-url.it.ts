import type { JobsLinkUrlMessages } from './link-url.ts';

export const it: JobsLinkUrlMessages = {
  startsWithDash: "Un link non può iniziare con -",
  invalidLink: "Non è un link valido",
  httpOnly: "Sono accettati solo link http(s)://",
  credentials: "I link non possono includere un nome utente o una password",
  noHost: "Il link non ha un nome host",
  privateAddress: "Impossibile importare da indirizzi locali, link-local o di reti private",
  redacted: "[link]",
  unresolvable: (p: { host: string }) => `Impossibile risolvere il nome host ${p.host}: controlla la rete e il link`,
  noAddresses: (p: { host: string }) => `Il nome host ${p.host} non ha indirizzi`,
  resolvesPrivate: (p: { host: string }) => `${p.host} si risolve in un indirizzo locale, link-local o di rete privata; impossibile importare da questo indirizzo`,
};
