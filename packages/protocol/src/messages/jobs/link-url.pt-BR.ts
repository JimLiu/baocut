import type { JobsLinkUrlMessages } from './link-url.ts';

export const ptBR: JobsLinkUrlMessages = {
  startsWithDash: "Um link não pode começar com -",
  invalidLink: "Não é um link válido",
  httpOnly: "Só são aceitos links http(s)://",
  credentials: "Links não podem incluir nome de usuário ou senha",
  noHost: "O link não tem nome de host",
  privateAddress: "Não é possível importar de endereços locais, locais de link ou de redes privadas",
  redacted: "[link]",
  unresolvable: (p: { host: string }) => `Não é possível resolver o nome do host ${p.host}: verifique a rede e o link`,
  noAddresses: (p: { host: string }) => `O nome do host ${p.host} não tem endereços`,
  resolvesPrivate: (p: { host: string }) => `${p.host} resolve para um endereço local, local de link ou de rede privada; não é possível importar dele`,
};
