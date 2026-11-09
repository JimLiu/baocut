import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';
export const es: ModelsModelServiceStoreMessages = {
 notMigrated: 'Las claves de la versión 1 aún no se han migrado', orderMismatch: 'order debe listar cada cuenta existente de este proveedor de servicios exactamente una vez', credentialNotSaved: (p) => `La credencial no se guardó: ${p.reason}`, accountNotFound: (p) => `${p.provider} no tiene esta cuenta: ${p.account}`,
  accountLinked: (p: { home: string }) => `Esta cuenta está vinculada desde ${p.home}; cambia o elimina su clave allí`,
  linkSameHome: 'No se pueden vincular cuentas desde la misma carpeta de BaoCut',
  linkSourceFileBacked: (p: { home: string }) => `${p.home} guarda sus claves en un archivo, no en el llavero del sistema; solo se puede vincular una carpeta que use el llavero`,
  linkSourceEmpty: (p: { home: string }) => `No se encontró configuración de servicios de modelos de BaoCut en ${p.home}`,
  linkNoMatch: (p: { home: string }) => `${p.home} no tiene ninguna cuenta que coincida`,
  linkedHelperMissing: (p: { home: string }) => `No se pueden leer las claves de las cuentas vinculadas desde ${p.home}: no se encontró el asistente de credenciales de la app BaoCut instalada`,
  linkedSourceMissing: (p: { account: string; home: string }) => `La cuenta vinculada ${p.account} ya no está en ${p.home}`,
  linkedKeyMissing: (p: { account: string; home: string }) => `La clave de la cuenta vinculada ${p.account} (de ${p.home}) no está en el llavero del sistema`,
  linkedUnreadable: (p: { account: string; home: string; reason: string }) => `No se puede leer la clave de la cuenta vinculada ${p.account} (de ${p.home}): ${p.reason}`,
};
