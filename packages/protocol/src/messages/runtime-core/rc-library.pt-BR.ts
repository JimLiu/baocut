import type { RcLibraryMessages } from './rc-library.ts';
import { pluralForm } from '../../i18n.ts';

export const ptBR: RcLibraryMessages = {
  problemSeparator: '; ', referenceUndecodable: (p) => `Não é possível decodificar a gravação de referência: ${p.problems}`,
  clonesNotReady: 'A clonagem de vozes ainda não está pronta', entryHasNoFile: 'Este item não tem arquivo',
  notCopyable: (p) => `${p.library === 'glossaries' ? 'Glossários' : p.library === 'voices' ? 'Vozes' : 'Cores'} não podem ser copiados diretamente para um vídeo: glossários são escolhidos na transcrição e tradução, vozes na síntese de fala e cores na edição de estilos`,
  captionItemIdsStyleOnly: 'captionItemIds só se aplica a estilos de legendas', addFromLibraryLabel: (p) => `Adicionar “${p.name}” da biblioteca`, duplicateGlossaries: (p) => `glossaries.${p.step} lista o mesmo glossário mais de uma vez`,
  tooManyGlossaries: (p) => pluralForm('pt-BR', p.max, { one: `Cada etapa pode usar no máximo ${p.max} glossário`, other: `Cada etapa pode usar no máximo ${p.max} glossários` }),
  glossaryWrongStep: (p) => `“${p.name}” é um glossário de ${p.transcription ? 'transcrição' : 'tradução'} e não pode ser usado para ${p.transcribeStep ? 'transcrição' : 'tradução'}`,
  selectionDocumentName: 'Itens da biblioteca em uso', changeSelectionLabel: 'Alterar itens da biblioteca em uso', adoptDefaultsLabel: 'Usar os itens padrão da biblioteca', noDocumentIdAfterWrite: 'Não foi retornado um ID de documento após gravar',
  speakerBoundTwice: (p) => `O falante ${p.speakerId} foi atribuído duas vezes`, noSuchDocument: (p) => `O vídeo não tem o documento ${p.documentId}`,
  documentNotSpeech: (p) => `O documento ${p.documentId} é ${p.kind}; falantes só existem em transcrições (speech)`,
  speakerNotInTranscript: (p) => `A transcrição ${p.documentId} não tem o falante ${p.speakerId}`,
  libraryVoiceNoProvider: 'Vozes da biblioteca são substituídas pelo clone no provedor escolhido para a dublagem: não passe providerId',
  outputNotFound: 'O resultado não existe', pathNotAbsolute: 'O caminho do arquivo deve ser absoluto',
  serviceClientNoLibraryVoice: 'Clientes de serviços externos não podem usar vozes da biblioteca',
  clonerNotConfigured: (p) => `Não é possível clonar vozes em ${p.label}: o provedor está desativado ou não tem chave`,
  cloneExists: (p) => `A voz “${p.name}” já tem clone válido em ${p.label}`, clonePurpose: (p) => `Clonar voz “${p.name}”`, noClone: 'Esta voz não tem clone neste provedor',
  remoteCloneNotDeleted: (p) => `O clone em ${p.label} não foi excluído, então o registro foi mantido: ${p.reason}`,
  cloneUnsupported: (p) => `${p.providerId} não tem API de clonagem de voz (somente ElevenLabs oferece uma por enquanto)`, cloneVersionGone: 'A versão da voz a clonar não existe mais',
  oldCloneNotDeleted: (p) => `O clone antigo substituído (${p.voiceId}) não foi excluído de ${p.label}: ${p.reason}`,
};
