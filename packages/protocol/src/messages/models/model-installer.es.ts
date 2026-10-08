import type { ModelsModelInstallerMessages } from './model-installer.ts';
export const es: ModelsModelInstallerMessages = {
 noSpace: 'El disco de la carpeta de modelos no tiene espacio', noManifest: (p) => `No hay un manifiesto integrado para ${p.repo}@${p.revision}`, untrustedManifest: (p) => `Al manifiesto integrado de ${p.repo} le falta un sha256 fiable`, noBundle: (p) => `No existe ese paquete de modelos: ${p.bundleId}`,
};
