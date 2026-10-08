import type { ExportJobMessages } from './export-job.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: ExportJobMessages = {
  tabVideo: 'Vídeo', tabAudio: 'Áudio', tabSubtitles: 'Legendas', tabTranscript: 'Transcrição', tabProject: 'Arquivo do projeto', export: 'Exportar', queued: 'Exportação na fila', exporting: 'Exportando…', exportingPct: (pct: number) => `Exportando · ${pct}%`,
  formats: { md: 'Markdown', txt: 'Texto simples', xmeml: 'FCP7 XML' },
  titleVideo: (format: string) => `Exportar vídeo · ${format}`, titleAudio: (format: string) => `Exportar áudio · ${format}`, titleSubtitles: (format: string) => `Exportar legendas · ${format}`, titleTranscript: (format: string) => `Exportar transcrição · ${format}`, titlePortable: 'Exportar pacote portátil', titleProject: (format: string) => `Exportar arquivo do projeto · ${format}`,
  generating: { video: 'Codificando', audio: 'Mixando', subtitles: 'Gravando arquivos', transcript: 'Gravando arquivos', portable: 'Empacotando', project: 'Gravando arquivo do projeto' },
  retrying: 'Tentando novamente automaticamente após um erro', saving: 'Salvando arquivos',
  framesOf: (done: string, total: string) => `Quadros renderizados: ${done} / ${total}`, frames: (done: string) => `Quadros renderizados: ${done}`,
  secondsOf: (done: string, total: string) => `Processado: ${done} / ${total}`, seconds: (done: string) => `Processado: ${done}`,
  outputsOf: (done: number, total: number) => pluralForm('pt-BR', total, { one: `Gravado ${done} / ${total} arquivo`, other: `Gravados ${done} / ${total} arquivos` }),
  outputs: (done: number) => pluralForm('pt-BR', done, { one: `${done} arquivo gravado`, other: `${done} arquivos gravados` }),
  bytesOf: (done: string, total: string) => `Empacotado: ${done} / ${total}`, bytes: (done: string) => `Empacotado: ${done}`,
  mono: 'Mono', stereo: 'Estéreo',
  entries: (n: number) => pluralForm('pt-BR', n, { one: `${n} entrada`, other: `${n} entradas` }), files: (n: number) => pluralForm('pt-BR', n, { one: `${n} arquivo`, other: `${n} arquivos` }),
  assetRevisions: (n: number) => pluralForm('pt-BR', n, { one: `${n} versão de mídia`, other: `${n} versões de mídia` }), missing: (n: number) => pluralForm('pt-BR', n, { one: `${n} ausente`, other: `${n} ausentes` }), clips: (n: number) => pluralForm('pt-BR', n, { one: `${n} clipe`, other: `${n} clipes` }),
  omitted: (n: number) => pluralForm('pt-BR', n, { one: `${n} item não gravado no arquivo do projeto`, other: `${n} itens não gravados no arquivo do projeto` }),
  doneMany: (n: number, total: string) => `${pluralForm('pt-BR', n, { one: `${n} arquivo`, other: `${n} arquivos` })} · ${total} no total`,
  cancelledKept: (n: number) => n === 1 ? 'O arquivo salvo é mantido · O vídeo não é afetado' : pluralForm('pt-BR', n, { other: `Os ${n} arquivos salvos são mantidos · O vídeo não é afetado` }),
  cancelledRemoved: 'Arquivos não concluídos foram excluídos · O vídeo não é afetado',
};
