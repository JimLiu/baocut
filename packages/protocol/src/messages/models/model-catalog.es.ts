import type { ModelsModelCatalogMessages } from './model-catalog.ts';
export const es: ModelsModelCatalogMessages = {
 backendUnsupported: (p) => `El backend ${p.backend} no admite ${p.platform}/${p.arch}`, relocating: 'La carpeta de modelos se está moviendo; no se puede usar hasta que termine', missingComponent: (p) => `${p.name} (${p.detail})`, listSeparator: ', ',
 incomplete: (p) => `Faltan componentes: ${p.names}. Instalar descarga solo los componentes que faltan`, workerMissing: 'No se encontró Model Worker (model-worker)', noManifest: (p) => `${p.repo} no tiene manifiesto`, wrongRevision: (p) => `La versión de ${p.repo} no es ${p.revision}`,
 missingFile: (p) => `Falta ${p.file} en ${p.repo}`, sizeMismatch: (p) => `El tamaño de ${p.file} en ${p.repo} no coincide`, noBundle: (p) => `No existe ese paquete de modelos: ${p.bundleId}`, moving: 'La carpeta de modelos se está moviendo', notInstalled: (p) => `El modelo ${p.repo} no está instalado`, noFilesInSubdir: (p) => `El modelo no tiene archivos en ${p.subdir}/`,
};
