import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';
export const es: ModelsModelServiceStoreMessages = {
 notMigrated: 'Las claves de la versión 1 aún no se han migrado', orderMismatch: 'order debe listar cada cuenta existente de este proveedor de servicios exactamente una vez', credentialNotSaved: (p) => `La credencial no se guardó: ${p.reason}`, accountNotFound: (p) => `${p.provider} no tiene esta cuenta: ${p.account}`,
};
