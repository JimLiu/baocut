import type { ModelsModelSelectionMessages } from './model-selection.ts';
export const es: ModelsModelSelectionMessages = {
 capTranscribe: 'Transcripción', capSynthesizeSpeech: 'Síntesis de voz', capGenerateImage: 'Generación de imágenes', capGenerateText: 'Generación de texto', capSeparateAudio: 'Separación de voces',
 noSuchProvider: (p) => `No existe ese proveedor: ${p.provider}`, noProviderForModel: (p) => `Ningún proveedor ofrece este modelo: ${p.model}`, ambiguousModel: (p) => `Varios proveedores tienen el modelo ${p.model}; especifica también provider`,
 noHint: (p) => `El modelo ${p.modelId} no admite una pista terminológica (hint)`, languageUnsupported: (p) => `El modelo ${p.modelId} no admite el idioma ${p.language}`, providerNoModel: (p) => `${p.provider} no tiene este modelo: ${p.modelId}`,
 defaultModelGone: (p) => `El modelo predeterminado ${p.modelId} ya no está entre los modelos de ${p.provider}`, missingCredential: (p) => `${p.name} aún no tiene una clave de API. Introduce la clave en Ajustes.`,
 localNotInstalled: (p) => `El paquete de modelos local ${p.model} no está instalado. Instálalo o usa otro servicio.`, nodeNotPaired: (p) => `El nodo ${p.name} no está emparejado. Empareja de nuevo o usa otro servicio.`,
 nodeNotConnected: (p) => `No se puede conectar al nodo ${p.name}. Comprueba que esté encendido y en la misma red; empareja de nuevo si es necesario.`,
 localDisabled: (p) => `El paquete de modelos local ${p.model} se desactivó después de varios errores. Actívalo de nuevo en Ajustes.`, providerDisabled: (p) => `${p.name} está desactivado. Activa el proveedor de nuevo en Ajustes.`,
 providerNotConfigured: (p) => `${p.name} aún no está configurado. Activa el proveedor en Ajustes e introduce la clave.`, agentNotInstalled: (p) => `No se ha instalado ${p.name}`, agentNotInstalledWith: (p) => `No se ha instalado ${p.name}: ${p.detail}`,
 agentSignedOut: (p) => `${p.name} no ha iniciado sesión`, agentSignedOutWith: (p) => `${p.name} no ha iniciado sesión: ${p.detail}`, agentOutdated: (p) => `La versión de ${p.name} es demasiado antigua`, agentOutdatedWith: (p) => `La versión de ${p.name} es demasiado antigua: ${p.detail}`,
 agentUnavailable: (p) => `${p.name} no se puede usar ahora`, agentUnavailableWith: (p) => `${p.name} no se puede usar ahora: ${p.detail}`,
 agentNotEnabled: (p) => `${p.name} aún no está activado. Activarlo acepta enviar prompts (e imágenes de referencia) a su cuenta, usando la cuota de la propia suscripción del usuario.`,
 defaultNodeUnpaired: (p) => `El nodo predeterminado ${p.node} ya no está emparejado. Empareja de nuevo o cambia el predeterminado para ${p.capability}.`, defaultProviderRemoved: (p) => `Se eliminó el predeterminado ${p.provider}. Configúralo de nuevo o cambia el predeterminado para ${p.capability}.`,
 setUsableAsDefault: (p) => `${p.provider} está disponible. Solo establécelo como predeterminado para ${p.capability}.`, noModelInstallSeparator: (p) => `Aún no hay un modelo disponible para ${p.capability}. Instala el paquete de modelos de separación local.`,
 noModelInstallLocal: (p) => `Aún no hay un modelo disponible para ${p.capability}. Instala un paquete de modelos local o configura un servicio en línea y establécelo como predeterminado.`,
 noModelConfigure: (p) => `Aún no hay un modelo disponible para ${p.capability}. Configura un servicio en Ajustes y establécelo como predeterminado.`, cannotUseFor: (p) => `${p.provider} no se puede usar para ${p.capability}. Cambia a otro servicio o modelo, o cambia el predeterminado.`,
};
