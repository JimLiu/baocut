import type { RcAgentToolsMessages } from './rc-agent-tools.ts';
import { pluralForm } from '../../i18n.ts';

function exportKindLabel(kind: string): string {
  switch (kind) {
    case 'subtitles':
      return 'sottotitoli';
    case 'transcript':
      return 'trascrizione';
    case 'audio':
      return 'audio';
    case 'video':
      return 'file video';
    case 'portable':
      return 'pacchetto portatile';
    case 'project':
      return 'file del progetto';
    default:
      return kind;
  }
}

/** 从链接导入的摘要结尾：下载之后做什么。 */
function linkImportAfter(p: { target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean }): string {
  const recognition = `${p.language ? `, lingua ${p.language}` : ''}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : ''}`;
  if (p.target === 'create') {
    return `, crea il video${p.name ? ` «${p.name}»` : ' (con il titolo della pagina come nome)'} e aggiungilo alla timeline${p.transcribe ? `, poi trascrivilo${recognition}${p.captions ? ' e crea un livello di sottotitoli' : ''}` : ''}`;
  }
  if (p.target === 'video') return `, importalo nel video${p.transcribe ? ' e trascrivilo' : ''}`;
  if (p.target === 'project') return `, salva in downloads/ del progetto${p.transcribe ? ' e trascrivi in TXT e SRT' : ''}`;
  if (p.target === 'download') return `, salva nella cartella Download${p.transcribe ? ' e trascrivi in TXT e SRT' : ''}`;
  return '';
}

function plural(count: number, one: string, many: string): string {
  return pluralForm('it', count, { one: `${count} ${one}`, other: `${count} ${many}` });
}

export const it: RcAgentToolsMessages = {
  instructionsNotSet: 'Le istruzioni della sessione non sono state impostate: l’ordine di assemblaggio del Runtime è errato',

  /** 列表里各项之间的分隔。 */
  listSeparator: ', ',
  /** 几段说明之间的分隔。 */
  clauseSeparator: '; ',

  createVideoSummary: (p: { name: string }) => `Crea il video «${p.name}»`,
  editsSummary: (p: { label: string; count: number; types: string }) =>
    `${p.label} (${plural(p.count, 'operazione', 'operazioni')}: ${p.types})`,
  captionsSummary: (p: { documentId: string; bilingual: boolean }) =>
    `Aggiungi un livello di sottotitoli ${p.bilingual ? 'bilingue ' : ''}per il documento ${p.documentId}`,
  /** 建立字幕层这笔修改在视频历史与撤销里的说明。 */
  captionsLabel: 'Aggiungi livello di sottotitoli',
  undoSummary: (p: { transactionId: string }) => `Annulla la modifica ${p.transactionId}`,
  undoLatestSummary: 'Annulla l’ultima modifica',
  deleteVideoSummary: (p: { name: string; path: string; days: number }) =>
    `Elimina il video «${p.name}» (${p.path}): spostalo nel Cestino, da cui puoi ripristinarlo nello Space per ${plural(p.days, 'giorno', 'giorni')}. I file originali dei materiali collegati restano dove sono`,
  importPackageSummary: (p: { file: string }) => `Apri il pacchetto portatile ${p.file}`,
  /** 打开便携包时给了 name、改视频名这笔修改在视频历史里的说明。 */
  renameVideoLabel: 'Rinomina video',
  putDocumentSummary: (p: { documentId: string }) => `Scrivi una nuova versione del documento ${p.documentId}`,
  newDocumentSummary: (p: { kind: string }) => `Crea un documento (${p.kind})`,
  /** 写文档这笔修改在视频历史与撤销里的说明（智能体没有给 label 时）。 */
  updateDocumentLabel: (p: { name: string }) => `Aggiorna il documento «${p.name}»`,
  newDocumentLabel: (p: { name: string }) => `Crea il documento «${p.name}»`,
  /** 新建译文没有给名字时，说明里用的名字。 */
  translationDocumentName: (p: { language: string }) => `${p.language} — traduzione`,
  importAssetSummary: (p: { name: string; place: boolean }) => `Importa il materiale ${p.name}${p.place ? ' e aggiungilo alla timeline' : ''}`,
  /** 导入素材这笔修改在视频历史与撤销里的说明。 */
  importAssetLabel: (p: { name: string; place: boolean }) => `Importa ${p.name}${p.place ? ' e aggiungilo alla timeline' : ''}`,
  replaceCompositionSummary: (p: { name: string; clip: string }) => `Importa ${p.name} e sostituisci la clip ${p.clip} nella timeline`,
  replaceCompositionLabel: (p: { name: string }) => `Sostituisci la grafica animata con ${p.name}`,
  pruneAssetsSummary: (p) => `Rimuovi dal video il materiale non usato (${p.count}): ${p.names}`,
  pruneAssetsLabel: (p) => `Rimuovi il materiale non usato (${p.count})`,
  adoptChaptersSummary: (p) =>
    `Usa i capitoli della fonte di ${p.asset} (${p.count})${p.existing ? `, sostituendo i capitoli attuali (${p.existing})` : ''}`,
  adoptChaptersLabel: 'Usa i capitoli della fonte',

  transcribePurpose: (p: { assetId: string }) => `Trascrivi il materiale ${p.assetId}`,
  transcribeSummary: (p: { assetId: string; provider: string | null; model: string | null }) =>
    `Trascrivi il materiale ${p.assetId}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : ''}`,
  speechPurpose: (p: { chars: number }) => `Sintetizza voce (${plural(p.chars, 'carattere', 'caratteri')})`,
  speechSummary: (p: { chars: number; provider: string | null; voice: string | null }) =>
    `Sintetizza voce (${plural(p.chars, 'carattere', 'caratteri')}${p.provider ? `, ${p.provider}` : ''}${p.voice ? `, voce ${p.voice}` : ''})`,
  imagePurpose: (p: { prompt: string }) => `Genera immagine: ${p.prompt}`,
  imageSummary: (p: { count: number; size: string | null; provider: string | null; prompt: string }) =>
    `Genera ${plural(p.count, 'immagine', 'immagini')}${p.size ? `, ${p.size}` : ''}${p.provider ? `, ${p.provider}` : ''}: ${p.prompt}`,
  cancelJobSummary: (p: { jobId: string }) => `Annulla l’attività ${p.jobId}`,
  retryPipelineSummary: (p: { jobId: string; pipeline: string; attempt: number }) =>
    `Riesegui la pipeline ${p.jobId} (${p.pipeline}, tentativo ${p.attempt}) dal passaggio non riuscito`,
  saveArtifactSummary: (p: { artifactId: string; path: string }) => `Salva il risultato ${p.artifactId} come ${p.path}`,
  overwriteArtifactSummary: (p: { artifactId: string; path: string }) =>
    `Sovrascrivi il file esistente ${p.path} con il risultato ${p.artifactId}`,

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
    const intervallo =
      p.rangeStart !== null ? `, ${p.rangeStart}–${p.rangeEnd} s` : p.rangeCount !== null ? `, ${plural(p.rangeCount, 'intervallo', 'intervalli')}` : '';
    const size =
      p.width !== null && p.height !== null
        ? `, ${p.width}×${p.height}`
        : p.width !== null
          ? `, larghezza ${p.width}`
          : p.height !== null
            ? `, altezza ${p.height}`
            : '';
    const source = p.originalOnly ? ', solo audio originale' : p.dubGroupId ? `, doppiaggio ${p.dubGroupId} soltanto` : '';
    return `Esporta ${exportKindLabel(p.kind)} (${p.format}${intervallo}${size}${source})${p.fileName ? ` come ${p.fileName}` : ''}${p.overwrite ? ', sovrascrivendo il file esistente' : ''}`;
  },

  installToolSummary: (p: { tool: string; version: string; size: string; estimated: boolean; license: string; url: string; host: string }) =>
    `Installa ${p.tool} ${p.version} (${p.estimated ? `circa ${p.size}` : p.size}, ${p.license}) da ${p.url} per scaricare video da link; serve per scaricare da ${p.host}`,
  linkImportSummary: (p: { tool: string; version: string; host: string; url: string; target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean }) =>
    `Scarica da ${p.host} con ${p.tool}${p.version ? ` ${p.version}` : ''}: ${p.url}${linkImportAfter(p)}`,
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
    `Consenti a BaoCut di usare ${p.tool}${p.version ? ` ${p.version}` : ''} su questo computer${p.path ? ` (${p.path})` : ''} per scaricare video dai siti web e scarica da ${p.host}: ${p.url}${linkImportAfter(p)}`,

  downloadSaveSummary: (p: { source: string; size: string; target: string }) =>
    `Copia ${p.source} (${p.size}) dalla cartella di lavoro alla cartella Download: ${p.target} (con un numero se il nome è già usato, senza sovrascrivere)`,

  grantSummary: (p: { recipients: string; items: string }) => `Condividi dati con ${p.recipients}: ${p.items}`,
  grantSummaryItem: (p: { purpose: string; maxCalls: number | null }) =>
    `${p.purpose} (${p.maxCalls === null ? 'nessun limite di chiamate' : `fino a ${plural(p.maxCalls, 'chiamata', 'chiamate')}`})`,

  testModelSummary: (p: { bundleId: string }) => `Verifica il pacchetto di modelli locali ${p.bundleId}: eseguilo dall’inizio alla fine su un campione prestabilito`,
  installModelSummary: (p: { bundleId: string; size: string; estimated: boolean; resumed: string | null; source: string; parts: string }) =>
    `Scarica il modello locale ${p.bundleId}: ${p.estimated ? `circa ${p.size} (dimensioni sconosciute, stimate)` : p.size}${p.resumed ? `, riprendendo ${p.resumed} già scaricati` : ''}, da ${p.source} (${p.parts})`,

  registerProjectSummary: (p: { path: string; name: string | null }) =>
    `Registra la cartella esistente ${p.path} come progetto${p.name ? ` (${p.name})` : ''}`,
  createProjectSummary: (p: { path: string; name: string | null }) => `Crea la cartella del progetto ${p.path}${p.name ? ` (${p.name})` : ''}`,
};
