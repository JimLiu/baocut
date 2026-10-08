import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const ptBR: ModelsModelServiceStoreMessages = {
  notMigrated: "As chaves da versão 1 ainda não foram migradas",
  orderMismatch: "order deve listar cada conta existente deste provedor de serviço exatamente uma vez",
  credentialNotSaved: (p: { reason: string }) => `A credencial não foi salva: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} não tem esta conta: ${p.account}`,
};
