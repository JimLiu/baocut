import type { PlayerMessages } from './player-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: PlayerMessages = {
  surface: (fileName) => `${fileName}: Space para reproduzir ou pausar, setas esquerda e direita para retroceder ou avançar`,
  loading: 'Carregando', buffering: 'Armazenando em buffer', openFailed: (message) => `Não foi possível abrir este arquivo: ${message}`,
  subtitles: 'Legendas', cueCount: (n) => pluralForm('pt-BR', n, { one: `${n} linha`, other: `${n} linhas` }), subtitleFile: 'Arquivo de legendas', noSubtitles: 'Sem legendas',
  listFailed: (message) => `Não foi possível listar arquivos de legendas: ${message}`, finding: 'Procurando arquivos de legendas…',
  noneNearby: (isAudio) => `Não há arquivos de legendas na mesma pasta. Coloque um .srt, .vtt ou .ass ao lado do ${isAudio ? 'áudio' : 'vídeo'}; o arquivo com mesmo nome é escolhido automaticamente.`,
  noneSelected: 'Nenhuma legenda selecionada.', reading: (fileName) => `Lendo “${fileName}”…`, readFailed: (fileName, message) => `Não foi possível ler “${fileName}”: ${message}`,
  empty: (fileName) => `Nenhuma linha encontrada em “${fileName}”. SRT, WebVTT e ASS são suportados.`, unknownFormat: 'Formato de legendas não reconhecido', tooLarge: 'O arquivo é grande demais', fetchFailed: (status) => `Não foi possível ler o arquivo (${status})`,
  play: 'Reproduzir', pause: 'Pausar', playTip: 'Reproduzir (Space)', pauseTip: 'Pausar (Space)', replayTip: 'Reproduzir novamente (Space)',
  overlay: 'Sobrepor legendas', showTip: 'Mostrar legendas (C)', hideTip: 'Ocultar legendas (C)', rateCurrent: (rate) => `Velocidade de reprodução ${rate}×`, rate: 'Velocidade de reprodução', rateNormal: '1× (Normal)',
  mute: 'Silenciar', unmute: 'Ativar som', muteTip: 'Silenciar (M)', unmuteTip: 'Ativar som (M)', volume: 'Volume', fullscreen: 'Tela cheia', exitFullscreen: 'Sair da tela cheia', fullscreenTip: 'Tela cheia (F)', exitFullscreenTip: 'Sair da tela cheia (F)',
  position: 'Posição de reprodução', backToCurrent: 'Voltar à linha atual',
  mediaError: { aborted: 'O carregamento foi interrompido', network: 'Ocorreu um erro ao ler o arquivo', decode: 'A decodificação falhou; o arquivo pode estar danificado', unsupported: 'O BaoCut ainda não pode reproduzir o formato ou codec deste arquivo', other: 'Não foi possível reproduzir este arquivo' },
};
