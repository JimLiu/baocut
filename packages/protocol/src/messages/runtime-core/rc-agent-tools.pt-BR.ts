import type { RcAgentToolsMessages } from './rc-agent-tools.ts';

import { pluralForm } from '../../i18n.ts';
const plural = (n: number, one: string, many: string) => `${n} ${pluralForm('pt-BR', n, { one, other: many })}`;
function exportKindLabel(kind: string): string { return ({ subtitles: 'legendas', transcript: 'transcrição', audio: 'áudio', video: 'arquivo de vídeo', portable: 'pacote portátil', project: 'arquivo de projeto' } as Record<string, string>)[kind] ?? kind; }
function linkImportAfter(p: { target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean }): string {
 const recognition = `${p.language ? `, idioma ${p.language}` : ''}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : ''}`;
 if (p.target === 'create') return `, criar vídeo${p.name ? ` “${p.name}”` : ' (nomeado pelo título da página)'} e adicionar à linha do tempo${p.transcribe ? `, depois transcrever${recognition}${p.captions ? ' e criar camada de legendas' : ''}` : ''}`;
 if (p.target === 'video') return `, importar no vídeo${p.transcribe ? ' e transcrever' : ''}`;
 if (p.target === 'project') return `, salvar em downloads/ do projeto${p.transcribe ? ' e transcrever em TXT e SRT' : ''}`;
 if (p.target === 'download') return `, salvar na pasta Downloads${p.transcribe ? ' e transcrever em TXT e SRT' : ''}`;
 return '';
}

export const ptBR: RcAgentToolsMessages = {
  instructionsNotSet: "As instruções da sessão não foram definidas: ordem de montagem do Runtime incorreta",


  listSeparator: ", ",

  clauseSeparator: "; ",

  createVideoSummary: (p: { name: string }) => `Criar vídeo “${p.name}”`,
  editsSummary: (p: { label: string; count: number; types: string }) =>
    `${p.label} (${plural(p.count, "operação", "operações")}: ${p.types})`,
  captionsSummary: (p) => `Adicionar camada de legendas${p.bilingual ? ' bilíngue' : ''} ao documento ${p.documentId}`,

  captionsLabel: "Adicionar camada de legendas",
  undoSummary: (p: { transactionId: string }) => `Desfazer edição ${p.transactionId}`,
  undoLatestSummary: "Desfazer a última edição",
  deleteVideoSummary: (p: { name: string; path: string; days: number }) =>
    `Excluir vídeo “${p.name}" (${p.path}): mover para a Lixeira, restaurável no Space por ${plural(p.days, "dia", "dias")}. Arquivos originais das mídias vinculadas permanecem no local`,
  importPackageSummary: (p: { file: string }) => `Abrir pacote portátil ${p.file}`,

  renameVideoLabel: "Renomear vídeo",
  putDocumentSummary: (p: { documentId: string }) => `Gravar nova versão do documento ${p.documentId}`,
  newDocumentSummary: (p: { kind: string }) => `Criar documento (${p.kind})`,

  updateDocumentLabel: (p: { name: string }) => `Atualizar documento “${p.name}”`,
  newDocumentLabel: (p: { name: string }) => `Criar documento “${p.name}”`,

  translationDocumentName: (p: { language: string }) => `${p.language} tradução`,
  importAssetSummary: (p: { name: string; place: boolean }) => `Importar mídia ${p.name}${p.place ? " e adicionar à linha do tempo" : ""}`,

  importAssetLabel: (p: { name: string; place: boolean }) => `Importar ${p.name}${p.place ? " e adicionar à linha do tempo" : ""}`,
  replaceCompositionSummary: (p: { name: string; clip: string }) => `Importar ${p.name} e substituir o clipe ${p.clip} na linha do tempo`,
  replaceCompositionLabel: (p: { name: string }) => `Substituir o gráfico animado por ${p.name}`,
  pruneAssetsSummary: (p) => `Remover do vídeo as mídias sem uso (${p.count}): ${p.names}`,
  pruneAssetsLabel: (p) => `Remover mídias sem uso (${p.count})`,
  adoptChaptersSummary: (p) =>
    `Usar os capítulos da origem de ${p.asset} (${p.count})${p.existing ? `, substituindo os capítulos atuais (${p.existing})` : ''}`,
  adoptChaptersLabel: 'Usar capítulos da origem',

  transcribePurpose: (p: { assetId: string }) => `Transcrever mídia ${p.assetId}`,
  transcribeSummary: (p: { assetId: string; provider: string | null; model: string | null }) =>
    `Transcrever mídia ${p.assetId}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ""})` : ""}`,
  speechPurpose: (p: { chars: number }) => `Sintetizar fala (${plural(p.chars, "caractere", "caracteres")})`,
  speechSummary: (p: { chars: number; provider: string | null; voice: string | null }) =>
    `Sintetizar fala (${plural(p.chars, "caractere", "caracteres")}${p.provider ? `, ${p.provider}` : ""}${p.voice ? `, voz ${p.voice}` : ""})`,
  imagePurpose: (p: { prompt: string }) => `Gerar imagem: ${p.prompt}`,
  imageSummary: (p: { count: number; size: string | null; provider: string | null; prompt: string }) =>
    `Gerar ${plural(p.count, "imagem", "imagens")}${p.size ? `, ${p.size}` : ""}${p.provider ? `, ${p.provider}` : ""}: ${p.prompt}`,
  cancelJobSummary: (p: { jobId: string }) => `Cancelar tarefa ${p.jobId}`,
  retryPipelineSummary: (p: { jobId: string; pipeline: string; attempt: number }) =>
    `Executar novamente o fluxo ${p.jobId} (${p.pipeline}, tentativa ${p.attempt}) a partir da etapa que falhou`,
  saveArtifactSummary: (p: { artifactId: string; path: string }) => `Salvar resultado ${p.artifactId} como ${p.path}`,
  overwriteArtifactSummary: (p: { artifactId: string; path: string }) =>
    `Sobrescrever o arquivo existente ${p.path} com o resultado ${p.artifactId}`,

  exportSummary: (p: {
    kind: string;
    format: string;
    rangeStart: number | null;
    rangeEnd: number | null;
    rangeCount: number | null;
    width: number | null;
    height: number | null;
    originalOnly: boolean;
    dubGroupId: string | null;
    fileName: string | null;
    overwrite: boolean;
  }) => {
    const range =
      p.rangeStart !== null ? `, ${p.rangeStart}–${p.rangeEnd} s` : p.rangeCount !== null ? `, ${plural(p.rangeCount, "intervalo", "intervalos")}` : "";
    const size =
      p.width !== null && p.height !== null
        ? `, ${p.width}×${p.height}`
        : p.width !== null
          ? `, largura ${p.width}`
          : p.height !== null
            ? `, altura ${p.height}`
            : "";
    const source = p.originalOnly ? ", só áudio original" : p.dubGroupId ? `, dublagem ${p.dubGroupId} somente` : "";
    return `Exportar ${exportKindLabel(p.kind)} (${p.format}${range}${size}${source})${p.fileName ? ` como ${p.fileName}` : ""}${p.overwrite ? ", sobrescrevendo o arquivo existente" : ""}`;
  },

  installToolSummary: (p: { tool: string; version: string; size: string; estimated: boolean; license: string; url: string; host: string }) =>
    `Instalar ${p.tool} ${p.version} (${p.estimated ? `cerca de ${p.size}` : p.size}, ${p.license}) de ${p.url} para baixar vídeos de links; downloads de ${p.host} precisam dele`,
  linkImportSummary: (p: { tool: string; version: string; host: string; url: string; target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean }) =>
    `Baixar de ${p.host} com ${p.tool}${p.version ? ` ${p.version}` : ""}: ${p.url}${linkImportAfter(p)}`,
  linkImportConsentSummary: (p: {
    tool: string;
    version: string;
    path: string;
    host: string;
    url: string;
    target: string;
    name: string | null;
    transcribe: boolean;
    language: string | null;
    provider: string | null;
    model: string | null;
    captions: boolean;
  }) =>
    `Permitir que o BaoCut use ${p.tool}${p.version ? ` ${p.version}` : ""} neste computador${p.path ? ` (${p.path})` : ""} para baixar vídeos de sites, e baixar de ${p.host}: ${p.url}${linkImportAfter(p)}`,

  downloadSaveSummary: (p: { source: string; size: string; target: string }) =>
    `Copiar ${p.source} (${p.size}) da pasta de trabalho para Downloads: ${p.target} (nomes repetidos são numerados, nunca sobrescritos)`,

  grantSummary: (p: { recipients: string; items: string }) => `Compartilhar dados com ${p.recipients}: ${p.items}`,
  grantSummaryItem: (p: { purpose: string; maxCalls: number | null }) =>
    `${p.purpose} (${p.maxCalls === null ? "sem limite de chamadas" : `até ${plural(p.maxCalls, "chamada", "chamadas")}`})`,

  testModelSummary: (p: { bundleId: string }) => `Verificar pacote de modelo local ${p.bundleId}: executar do início ao fim com uma amostra fixa`,
  installModelSummary: (p: { bundleId: string; size: string; estimated: boolean; resumed: string | null; source: string; parts: string }) =>
    `Baixar modelo local ${p.bundleId}: ${p.estimated ? `cerca de ${p.size} (tamanho desconhecido, estimado)` : p.size}${p.resumed ? `, retomando ${p.resumed} já baixados` : ""}, de ${p.source} (${p.parts})`,

  registerProjectSummary: (p: { path: string; name: string | null }) =>
    `Registrar a pasta existente ${p.path} como projeto${p.name ? ` (${p.name})` : ""}`,
  createProjectSummary: (p: { path: string; name: string | null }) => `Criar pasta de projeto ${p.path}${p.name ? ` (${p.name})` : ""}`,
  adoptSessionSummary: (p: { name: string | null }) =>
    `Criar um projeto ${p.name ? `“${p.name}”` : 'com o nome do primeiro vídeo'} e mover para ele os vídeos e arquivos desta sessão`,
};
