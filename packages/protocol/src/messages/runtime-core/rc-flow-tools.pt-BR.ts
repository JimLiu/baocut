import type { RcFlowToolsMessages } from './rc-flow-tools.ts';
import { pluralForm } from '../../i18n.ts';

function providerNote(p: { provider: string | null; model: string | null }): string {
  return p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : '';
}
function originalLabel(original: string): string {
  switch (original) { case 'mute': return 'silenciar'; case 'keep': return 'manter'; default: return 'reduzir'; }
}
function transcodeAction(action: string, count: number): string {
  const files = pluralForm('pt-BR', count, { one: `${count} arquivo`, other: `${count} arquivos` });
  switch (action) { case 'merge': return `Mesclar ${files} na ordem`; case 'extract-audio': return `Extrair áudio de ${files}`; default: return `Comprimir ${files}`; }
}

export const ptBR: RcFlowToolsMessages = {
  listSeparator: ', ',
  transcribeVideoSummary: (p) => `Transcrever ${p.asset ? `a mídia ${p.asset}` : 'a mídia da faixa principal'}${providerNote(p)}${p.captions ? ' e adicionar uma camada de legendas' : ''}`,
  transcribeFileSummary: (p) => `Transcrever ${p.file}${providerNote(p)} e gravar transcrições TXT e SRT ${p.outDir === null ? 'na pasta Downloads' : `em ${p.outDir}`}`,
  transcribeCreateSummary: (p) => `Criar vídeo${p.name ? ` “${p.name}”` : ''}, importar ${p.file} e adicionar à linha do tempo, depois transcrever${providerNote(p)}${p.captions ? ' e adicionar uma camada de legendas' : ''}`,
  translateVideoSummary: (p) => `Traduzir a transcrição para ${p.to} com o modelo de texto${providerNote(p)}${p.captions ? ` e adicionar uma camada de legendas${p.bilingual ? ' bilíngue' : ''}` : ''}`,
  translateFileSummary: (p) => `Traduzir o arquivo de legendas ${p.input} para ${p.to} com o modelo de texto${providerNote(p)} e gravar o novo arquivo ${p.outDir === null ? 'na pasta Downloads' : `em ${p.outDir}`}`,
  dubSummary: (p) => `Dublagem traduzida${p.to ? ` (${p.to})` : ''}: ${p.translation ? `usar a tradução ${p.translation}` : 'traduzir primeiro com o modelo de texto'}, sintetizar frase por frase${providerNote(p)}${p.voice ? ` com a voz ${p.voice}` : ''}, adicionar uma nova faixa de dublagem e ${originalLabel(p.original)} o áudio original`,
  transcodeSummary: (p) => `${transcodeAction(p.action, p.count)} (${p.files}${p.truncated ? '…' : ''}) e salvar ${p.outDir === null ? 'na pasta Downloads' : `em ${p.outDir}`}`,
  transcribeReplaceSummary: (p) =>
    `Transcrever novamente ${p.asset ? `a mídia ${p.asset}` : 'a mídia da faixa principal'}${providerNote(p)} e substituir a transcrição atual do vídeo, mantendo traduções, legendas e dublagem (uma única operação que pode ser desfeita)`,
};
