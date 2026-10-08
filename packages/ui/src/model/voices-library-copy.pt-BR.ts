import type { VoicesLibraryMessages } from './voices-library-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: VoicesLibraryMessages = {
  consentStatement: 'Esta é minha própria voz ou tenho a permissão do falante',
  uploading: (label) => `Enviando para ${label}…`,
  noConsent: 'Não foi marcada como sua própria voz ou usada com permissão, então não será enviada a terceiros. Marque a declaração em “Editar” primeiro.',
  cannotClone: (label) => `Este Runtime não pode clonar em ${label}`,
  providerOff: (label, detail) => `${label} não está disponível agora${detail ? ` (${detail})` : ''}: ative e defina a chave em “Modelos de nuvem” primeiro`,
  consentUnstated: 'Consentimento não declarado', cloned: (label) => `Clonada em ${label}`, cloneStale: (label) => `Clone de ${label} desatualizado`,
  languageUnknown: 'Idioma não especificado', recorded: 'Gravada no aplicativo', imported: 'Importada de um arquivo', edited: (ago) => `Editada ${ago}`,
  nameRequired: 'Dê um nome à voz', nameTooLong: (max) => pluralForm('pt-BR', max, { one: `Os nomes podem ter até ${max} caractere`, other: `Os nomes podem ter até ${max} caracteres` }), transcriptTooLong: (max) => pluralForm('pt-BR', max, { one: `As transcrições podem ter até ${max} caractere`, other: `As transcrições podem ter até ${max} caracteres` }), dontKnow: 'Não tenho certeza',
  deleteClones: (labels) => `Os clones em ${labels.join(', ')} são excluídos primeiro; se falhar, a voz será mantida.`,
  deleteBody: (clones) => `Vídeos que a usam voltarão à voz padrão na próxima geração; as dublagens já geradas não são afetadas. ${clones}`.trim(),
  uploadNotice: (name, size, label) => `A gravação de referência de “${name}”${size ? ` (${size})` : ''} será enviada para ${label} para criar um clone. Depois, usar esta voz em ${label} usa diretamente o ID de voz deles; excluir a voz exclui este clone primeiro.`,
  withRemedy: (message, remedy) => `${message.replace(/[。.]$/, '')}. ${remedy}`,
  remedyConsent: 'Vozes sem declaração de consentimento não são enviadas a terceiros: marque a declaração em “Editar” primeiro.',
  remedyConfigure: 'Ative este provedor e defina sua chave em “Modelos de nuvem”.',
  remedyConflict: 'Esta voz acabou de mudar em outro lugar. A versão mais recente está abaixo; confira antes de salvar.',
  remedyGrant: 'Enviar a gravação de referência a um provedor exige uma autorização de envio de dados: emita uma nas Configurações e tente novamente.',
};
