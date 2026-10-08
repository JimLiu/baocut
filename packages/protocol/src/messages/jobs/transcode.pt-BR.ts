import type { JobsTranscodeMessages } from './transcode.ts';

export const ptBR: JobsTranscodeMessages = {
  label: 'Transcodificar arquivos',
  description: 'Comprima arquivos de vídeo, mescle na ordem ou extraia áudio: de arquivo para arquivo, sem criar um vídeo, executado pelo ffmpeg; os resultados não sobrescrevem arquivos existentes.',
  inputNotFound: (p) => `Não é possível encontrar o arquivo de entrada ${p.file}`, stepProbe: 'Ler entradas', stepEncode: 'Codificar', stepVerify: 'Verificar saída', stepPublish: 'Publicar',
  noAudioTrack: (p) => `${p.name} não tem faixa de áudio`, noVideoTrack: (p) => `${p.name} não tem faixa de vídeo`, verifyFailed: (p) => `A saída de ${p.name} não passou na verificação`,
  actionShape: 'deve ser compress, merge ou extract-audio', mergeNeedsTwo: 'precisa de pelo menos dois arquivos para mesclar',
  audioReencode: (p) => `O codec de áudio ${p.codec} não cabe em um contêiner de áudio comum; recodificando para AAC`,
  fileReason: (p) => `${p.name}: ${p.reason}`, reasonSeparator: '; ',
  fieldVideoCodec: 'Codec de vídeo', fieldResolution: 'Resolução', fieldFrameRate: 'Taxa de quadros', fieldPixelFormat: 'Formato de pixel', fieldAudioTrack: 'Faixa de áudio', fieldAudioCodec: 'Codec de áudio', fieldSampleRate: 'Taxa de amostragem', fieldChannels: 'Canais', present: 'sim', absent: 'nenhum',
  fieldMismatch: (p) => `${p.field} difere (${p.values})`, videoNotMp4: (p) => `O codec de vídeo ${p.codec} não pode entrar diretamente em MP4`, audioNotMp4: (p) => `O codec de áudio ${p.codec} não pode entrar diretamente em MP4`,
  probeOutputFailed: 'ffprobe não consegue ler o arquivo de saída', outputNoVideo: 'A saída não tem faixa de vídeo', outputNoAudio: 'A saída não tem faixa de áudio',
  durationOff: (p) => `A duração é ${p.actual} s; esperado cerca de ${p.expected} s`, codecMismatch: (p) => `O codec de vídeo é ${p.actual}; esperado ${p.expected}`,
  heightOver: (p) => `A altura do quadro ${p.height} excede o limite de ${p.max}`, tooManySameName: (p) => `Há arquivos demais com o mesmo nome na pasta de resultados: ${p.name}`,
};
