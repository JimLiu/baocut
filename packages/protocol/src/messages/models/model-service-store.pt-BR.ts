import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const ptBR: ModelsModelServiceStoreMessages = {
  notMigrated: "As chaves da versão 1 ainda não foram migradas",
  orderMismatch: "order deve listar cada conta existente deste provedor de serviço exatamente uma vez",
  credentialNotSaved: (p: { reason: string }) => `A credencial não foi salva: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} não tem esta conta: ${p.account}`,
  accountLinked: (p: { home: string }) => `Esta conta está vinculada de ${p.home}; altere ou remova a chave lá`,
  linkSameHome: 'Não é possível vincular contas da mesma pasta do BaoCut',
  linkSourceFileBacked: (p: { home: string }) => `${p.home} guarda as chaves em um arquivo, não nas chaves do sistema; só dá para vincular uma pasta que use as chaves do sistema`,
  linkSourceEmpty: (p: { home: string }) => `Nenhuma configuração de serviços de modelos do BaoCut encontrada em ${p.home}`,
  linkNoMatch: (p: { home: string }) => `${p.home} não tem nenhuma conta correspondente`,
  linkedHelperMissing: (p: { home: string }) => `Não dá para ler as chaves das contas vinculadas de ${p.home}: o assistente de credenciais do app BaoCut instalado não foi encontrado`,
  linkedSourceMissing: (p: { account: string; home: string }) => `A conta vinculada ${p.account} não está mais em ${p.home}`,
  linkedKeyMissing: (p: { account: string; home: string }) => `A chave da conta vinculada ${p.account} (de ${p.home}) não está nas chaves do sistema`,
  linkedUnreadable: (p: { account: string; home: string; reason: string }) => `Não dá para ler a chave da conta vinculada ${p.account} (de ${p.home}): ${p.reason}`,
};
