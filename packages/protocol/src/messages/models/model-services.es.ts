import type { ModelsModelServicesMessages } from './model-services.ts';
export const es: ModelsModelServicesMessages = {
 noSuchProvider: (p) => `No existe ese proveedor: ${p.provider}`, noConfigureNeeded: 'Este ordenador y los nodos no necesitan configuración; solo los proveedores en línea tienen un interruptor y una clave',
 cannotRemove: 'Solo se pueden quitar proveedores de servicios en línea; este ordenador, los nodos y los proveedores de agentes no', noAccounts: 'Solo los proveedores de servicios en línea tienen cuentas; este ordenador, los nodos y los proveedores de agentes no',
 noCapabilityParameters: (p) => `${p.capability} no tiene parámetros de capacidad`, noRefresh: 'Solo los proveedores en línea tienen una lista de modelos que se puede actualizar', clearWithModel: 'No proporciones un modelo al quitar el predeterminado',
 capabilityNotOffered: (p) => `${p.provider} no ofrece esta capacidad: ${p.capability}`, noSelectableModel: (p) => `${p.provider} no tiene un modelo que elegir; especifica modelId`, providerNoModel: (p) => `${p.provider} no tiene este modelo: ${p.model}`,
 providerNodeConflict: 'provider y node apuntan a proveedores diferentes', modelBundleMismatch: 'model y bundleId no coinciden', cannotTranscribe: (p) => `${p.provider} no puede transcribir. Cambia de servicio.`,
 cannotUseCapability: (p) => `${p.provider} no se puede usar para esta capacidad. Cambia de servicio.`, cannotGenerateText: (p) => `${p.provider} no se puede usar para generar texto. Cambia de servicio.`,
};
