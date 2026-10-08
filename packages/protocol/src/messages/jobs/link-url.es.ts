import type { JobsLinkUrlMessages } from './link-url.ts';
export const es: JobsLinkUrlMessages = {
 startsWithDash: 'Un enlace no puede empezar con -', invalidLink: 'No es un enlace válido', httpOnly: 'Solo se aceptan enlaces http(s)://', credentials: 'Los enlaces no pueden incluir un nombre de usuario ni una contraseña',
 noHost: 'El enlace no tiene un nombre de host', privateAddress: 'No se puede importar desde direcciones locales, de enlace local o de redes privadas', redacted: '[enlace]',
 unresolvable: (p) => `No se puede resolver el nombre de host ${p.host}: comprueba la red y el enlace`, noAddresses: (p) => `El nombre de host ${p.host} no tiene direcciones`,
 resolvesPrivate: (p) => `${p.host} se resuelve a una dirección local, de enlace local o de red privada; no se puede importar desde ella`,
};
