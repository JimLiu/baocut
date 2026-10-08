import type { ExportRejectionMessages } from './export-rejection.ts';

export const ptBR: ExportRejectionMessages = {
  portableReason: { missing: 'Arquivo não encontrado', changed: 'Conteúdo diferente de quando foi adicionado', unreadable: 'Não é possível ler' },
  titles: {
    VIDEO_NOT_OPEN: 'O vídeo não está aberto', EXPORT_KIND_UNSUPPORTED: 'Esta versão ainda não pode exportar este tipo de conteúdo', EXPORT_SOURCE_UNSUPPORTED: 'Este documento não pode ser exportado assim', EXPORT_NOTHING_TO_EXPORT: 'Nada no intervalo pode ser exportado', EXPORT_SOURCE_NOT_FOUND: 'Nenhum documento pode ser exportado', EXPORT_SOURCE_AMBIGUOUS: 'Vários documentos podem ser exportados', EXPORT_TOOL_MISSING: 'Falta neste computador uma ferramenta necessária para exportar', EXPORT_UNSUPPORTED_CONTENT: 'Algum conteúdo não pode ser renderizado para exportação', ASSET_MISSING: 'Algumas mídias não podem ser lidas', ASSET_CHANGED: 'Algumas mídias mudaram', ENTITY_NOT_FOUND: 'A sequência não existe', DUB_GROUP_NOT_FOUND: 'Não é possível encontrar este grupo de dublagem', EXPORT_PACKAGE_LOCAL_PATH: 'Alguns documentos contêm caminhos deste computador', EXPORT_PACKAGE_UNSUPPORTED: 'Alguns arquivos não podem entrar em um pacote portátil', EXPORT_INSUFFICIENT_SPACE: 'Espaço insuficiente no disco do local de exportação', EXPORT_DESTINATION_EXISTS: 'Já existe um arquivo com o mesmo nome', EXPORT_DESTINATION_UNWRITABLE: 'Não é possível gravar no local de exportação', EXPORT_RENDER_FAILED: 'Não foi possível renderizar o vídeo', EXPORT_VALIDATION_FAILED: 'O arquivo exportado não passou na validação', EXPORT_PUBLISH_FAILED: 'Não foi possível salvar os arquivos no local de exportação', EXPORT_PARTIALLY_PUBLISHED: 'Somente alguns arquivos foram salvos', RESOURCE_ADMISSION_UNSATISFIABLE: 'Este computador não tem recursos suficientes para esta exportação',
  },
  resources: { memory: 'Memória', gpuMemory: 'Memória da GPU', cpuThreads: 'Threads de CPU', scratchDisk: 'Espaço em disco para arquivos temporários' },
  problemSeparator: '; ', fileProblems: (file: string, problems: string) => `${file}: ${problems}`,
  notStarted: 'A exportação não iniciou', failed: 'A exportação falhou', missingTool: (tool: string) => `Ausente: ${tool}`,
  assetMissingHint: 'Encontre o arquivo ou vincule novamente em Mídias, depois exporte novamente.',
  assetChangedHint: 'Vincule esta mídia novamente ou recoloque o arquivo original, depois exporte novamente.',
  nothingHint: 'Escolha outro intervalo ou coloque algo na linha do tempo primeiro.',
  space: (required: string, available: string) => `Precisa de cerca de ${required}; restam somente ${available}`,
  notEnough: (resource: string) => `Insuficiente: ${resource}`, resourceHint: 'Exporte um intervalo menor ou escolha uma resolução inferior e tente novamente.',
};
