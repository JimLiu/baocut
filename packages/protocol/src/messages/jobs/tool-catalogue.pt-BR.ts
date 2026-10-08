import type { JobsToolCatalogueMessages } from './tool-catalogue.ts';

export const ptBR: JobsToolCatalogueMessages = {
  transcribeLabel: 'Transcrever',
  transcribeDescription: 'Transcreva um arquivo de mídia local ou um vídeo no Space. Para um vídeo, grava uma nova transcrição e cria uma camada de legendas; para apenas um arquivo, grava TXT e SRT no local de salvamento ou pode criar um novo vídeo.',
  translateSubtitlesLabel: 'Traduzir legendas',
  translateSubtitlesDescription: 'Traduza a transcrição de um vídeo frase por frase para outro idioma e grave no vídeo como uma nova tradução. Também pode traduzir um arquivo de legendas SRT / VTT (arquivo local ou item de legendas no Space) para um novo arquivo de legendas.',
  dubLabel: 'Dublagem traduzida',
  dubDescription: 'Sintetize fala no idioma de destino frase por frase a partir da transcrição (traduzindo primeiro se não houver tradução), alinhe os tempos e grave no vídeo como um novo grupo de dublagem.',
  synthesizeSpeechLabel: 'Gerar fala',
  synthesizeSpeechDescription: 'Sintetize fala a partir de um texto; o resultado é áudio. Também pode ler um documento ou item de legendas no Space (legendas sem códigos de tempo).',
  generateTextLabel: 'Gerar texto',
  generateTextDescription: 'Gere texto a partir de um prompt (opcionalmente seguindo um JSON Schema); o resultado é texto. Documentos ou itens de legendas no Space podem ser anexados como material.',
  generateImageLabel: 'Gerar imagem', generateImageDescription: 'Gere uma imagem a partir de uma descrição; o resultado é uma imagem.',
  linkImportLabel: 'Baixar vídeo', linkImportDescription: 'Baixe um vídeo neste computador com yt-dlp. É possível usar cookies do navegador, e o download pode ser transcrito em transcrição e legendas.',
  compressVideoLabel: 'Comprimir vídeo', compressVideoDescription: 'Comprima arquivos de vídeo um por um: de arquivo para arquivo, nenhum vídeo é criado, e os resultados não sobrescrevem arquivos existentes.',
  mergeVideoLabel: 'Mesclar vídeos', mergeVideoDescription: 'Mescle vários arquivos de vídeo em um, na ordem: de arquivo para arquivo, nenhum vídeo é criado, e os resultados não sobrescrevem arquivos existentes.',
  extractAudioLabel: 'Extrair áudio', extractAudioDescription: 'Extraia a faixa de áudio de um arquivo de vídeo ou áudio. Codecs compatíveis com um contêiner comum são copiados sem alteração; os demais são recodificados em AAC. De arquivo para arquivo, nenhum vídeo é criado, e os resultados não sobrescrevem arquivos existentes.',
};
