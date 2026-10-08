import type { AgentToolStepsMessages } from './agent-tool-steps.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: AgentToolStepsMessages = {
  label: { translate: 'Traduzir', cut: 'Cortar', importAssets: 'Importar mídias', editVideo: 'Editar vídeo', listVideos: 'Listar vídeos', newVideo: 'Novo vídeo', readVideo: 'Ler vídeo', deleteVideo: 'Excluir vídeo', readTranscript: 'Ler transcrição', undoEdit: 'Desfazer edição', captions: 'Criar camada de legendas', transcribe: 'Transcrever', dub: 'Traduzir e dublar', mergeFiles: 'Mesclar arquivos', extractAudio: 'Extrair áudio', compressFiles: 'Comprimir arquivos', speech: 'Sintetizar fala', image: 'Gerar imagens', models: 'Ver modelos', installModel: 'Baixar modelo local', export: 'Exportar', downloadVideo: 'Baixar vídeo', saveToDownloads: 'Salvar em Downloads', viewTask: 'Ver tarefa', cancelTask: 'Cancelar tarefa', saveOutput: 'Salvar resultado', browseSpace: 'Explorar Space', searchSpace: 'Pesquisar Space', readSkill: 'Ler skill', requestGrant: 'Solicitar autorização', readContract: 'Ler contrato da tarefa', refineContract: 'Detalhar contrato da tarefa', recordCheck: 'Registrar verificação de aceitação' },
  exportKind: { subtitles: 'Legendas', transcript: 'Transcrição', audio: 'Áudio', video: 'Exportação', portable: 'Pacote portátil', project: 'Arquivo do projeto' },
  places: (n: number) => pluralForm('pt-BR', n, { one: `${n} local`, other: `${n} locais` }),
  count: (n: number) => `${n}`, bilingual: 'Bilíngue',
  images: (n: number) => pluralForm('pt-BR', n, { one: `${n} imagem`, other: `${n} imagens` }),
  files: (n: number) => pluralForm('pt-BR', n, { one: `${n} arquivo`, other: `${n} arquivos` }),
};
