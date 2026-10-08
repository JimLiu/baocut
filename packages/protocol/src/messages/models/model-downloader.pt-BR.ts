import type { ModelsModelDownloaderMessages } from './model-downloader.ts';

export const ptBR: ModelsModelDownloaderMessages = {
  remedyNoSpace: "O disco que contém a pasta de modelos está sem espaço. Libere espaço suficiente (ou mova a pasta de modelos para outro disco nas Configurações) e instale novamente",
  remedyNetwork: "Não é possível acessar a rede ou o download foi interrompido. Verifique a rede e instale novamente; o download continuará de onde parou. Você também pode trocar o espelho em “Fonte de download de modelos” em “Configurações › Geral”",
  remedyIntegrity: "Um arquivo baixado não corresponde ao tamanho ou sha256 do manifesto (a fonte ou o espelho tem conteúdo incorreto). O arquivo inválido foi excluído; mude a fonte de download e instale novamente",
  remedySource: "A fonte de download não tem este arquivo ou negou o acesso. Verifique se o espelho definido em “Fonte de download de modelos” em “Configurações › Geral” (ou na variável de ambiente BAOCUT_MODELS_ENDPOINT) está completo",
  remedyManifestIncomplete: "O manifesto integrado deste pacote de modelo não tem sha256 confiável, então não é possível instalá-lo. Aguarde uma atualização do BaoCut",
  downloadFailed: (p: { file: string; reason: string }) => `Não foi possível baixar ${p.file}: ${p.reason}`,
  integrityMismatch: (p: { file: string }) => `${p.file} tem tamanho ou sha256 que não corresponde ao manifesto`,
  sourceHttp: (p: { file: string; status: number }) => `A fonte de download para ${p.file} retornou HTTP ${p.status}`,
  diskFull: "O disco ficou cheio ao gravar os arquivos do modelo",
};
