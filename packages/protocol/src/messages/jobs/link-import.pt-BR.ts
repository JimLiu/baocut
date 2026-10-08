import type { JobsLinkImportMessages } from './link-import.ts';

export const ptBR: JobsLinkImportMessages = {
  languageTag: 'deve ser uma tag de idioma BCP 47', requiresTranscribe: 'só pode ser fornecido com transcribe',
  noVideoDiarize: 'Sem um vídeo de destino, só são gravadas transcrições independentes; os falantes não podem ser separados',
  noVideoCaptions: 'Camadas de legendas não são criadas sem um vídeo de destino', notWrittenToVideo: 'A transcrição terminou, mas não foi gravada no vídeo',
  label: 'Baixar vídeo',
  description: 'Baixe um vídeo para uma pasta com yt-dlp, opcionalmente transcrevendo em TXT e SRT. O projeto ao qual pertence e a pasta de salvamento são independentes; o protocolo anterior ainda aceita um destino de importação de vídeo. Exige instalar o yt-dlp e concordar com seu uso.',
  offlineStrict: 'Links não são baixados no modo estritamente off-line', cannotCreateVideo: 'Este Runtime não pode criar vídeos', cannotTranscribe: 'Este Runtime não pode transcrever',
  fileTranscribeUnavailable: 'A transcrição de arquivos não está disponível', videoNotOpen: 'O vídeo não está aberto', sourceExpired: 'O link original não está mais disponível: inicie uma nova importação',
  stepResolve: 'Resolver link', stepDownload: 'Baixar', stepVerify: 'Verificar decodificação', stepPublish: 'Mover para pasta de download', stepCreate: 'Criar vídeo', stepImport: 'Importar no vídeo', stepTranscribe: 'Transcrever',
  undecodable: 'Não é possível decodificar o arquivo baixado', noStreams: 'O arquivo baixado não tem imagem nem som',
  undecodableRemedy: 'O arquivo da origem está incompleto ou em formato não suportado: tente novamente ou outro formato (audioOnly)',
  noMediaFile: 'A ferramenta de download não deixou um arquivo de mídia',
  destinationUnwritable: (p) => `Não é possível gravar na pasta de salvamento: ${p.dir}`,
  destinationRemedy: 'Verifique se a pasta de salvamento (a pasta Downloads é a configuração downloads.directory; em um projeto, é downloads/ do projeto) existe e permite gravação',
  publishedOutside: 'O arquivo publicado está fora da pasta de salvamento', diskFull: 'Espaço em disco insuficiente para a pasta de download',
  unsupportedBrowser: 'não é um navegador suportado', browserItems: 'deve conter apenas navegadores suportados', noDuplicates: 'não pode conter duplicatas', saveToInvalid: 'deve ser downloads ou project',
  languageItems: 'deve conter apenas códigos de idioma (por exemplo en, zh-Hans)', projectMismatch: 'não corresponde ao projeto em target.create', conversationMismatch: 'não corresponde à sessão em target.create',
};
