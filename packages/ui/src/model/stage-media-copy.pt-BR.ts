import type { StageMediaMessages } from './stage-media-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: StageMediaMessages = {
  titles: { missing: 'Arquivo de origem não encontrado', changed: 'O arquivo de origem mudou', 'outside-project': 'O arquivo de origem está fora da pasta do projeto', unplayable: 'Não é possível reproduzir o arquivo de origem' },
  causes: { missing: 'O arquivo pode ter sido movido, renomeado ou excluído, ou estar em uma unidade desconectada.', changed: 'O arquivo neste local não é mais o que foi importado (o tamanho não corresponde). Pode ter sido sobrescrito ou exportado novamente.', 'outside-project': 'O local registrado está fora da pasta do projeto que contém este vídeo, e o BaoCut não lê arquivos ali.' },
  unplayable: (error: string) => `O reprodutor não consegue abrir este arquivo: ${error}.`,
  tail: { video: 'As legendas ainda são reproduzidas; só faltam imagem e som original.', audio: 'As legendas ainda são reproduzidas; só não será possível ouvir este áudio.' },
  body: (cause: string, tail: string) => `${cause} ${tail}`,
  volume: (volume: string) => `O arquivo está em “${volume}”. Conecte essa unidade e ele será recuperado automaticamente.`,
  more: (count: number) => pluralForm('pt-BR', count, { one: `Mais ${count} mídia de vídeo ou áudio também não pode ser reproduzida.`, other: `Mais ${count} mídias de vídeo ou áudio também não podem ser reproduzidas.` }),
  relinkHint: 'Escolha o arquivo original para recuperá-lo. O BaoCut verifica o conteúdo, e um arquivo diferente não pode ser vinculado novamente.',
  desktopOnly: 'Para recuperar, abra este vídeo no aplicativo de desktop BaoCut e use “Vincular novamente…” na tela para escolher o arquivo original.',
  managed: 'Este arquivo estava armazenado na pasta do vídeo, então não pode ser vinculado a outro local.',
  oldRevision: 'A linha do tempo usa uma versão antiga desta mídia; somente a atual pode ser vinculada novamente.',
  relink: 'Vincular novamente…', relinking: 'Verificando…',
  pickTitle: (name: string) => `Encontrar “${name}”`, pickButton: 'Vincular novamente', label: (name: string) => `Vincular novamente “${name}”`,
  relinkFailed: (message: string) => `Não foi possível vincular novamente: ${message}`,
  decodeFailed: 'Falha na decodificação', unsupported: 'Formato não suportado',
};
