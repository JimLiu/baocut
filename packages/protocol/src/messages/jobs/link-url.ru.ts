import type { JobsLinkUrlMessages } from './link-url.ts';

export const ru: JobsLinkUrlMessages = {
  startsWithDash: "Ссылка не может начинаться с -",
  invalidLink: "Недопустимая ссылка",
  httpOnly: "Принимаются только ссылки http(s)://",
  credentials: "Ссылки не могут содержать имя пользователя или пароль",
  noHost: "В ссылке нет имени хоста",
  privateAddress: "Нельзя импортировать с локальных адресов, адресов link-local или частных сетей",
  redacted: "[ссылка]",
  unresolvable: (p: { host: string }) => `Не удалось разрешить имя хоста ${p.host}: проверьте сеть и ссылку`,
  noAddresses: (p: { host: string }) => `Имя хоста ${p.host} не имеет адресов`,
  resolvesPrivate: (p: { host: string }) => `${p.host} разрешается в локальный адрес, адрес link-local или частной сети; импорт невозможен`,
};
