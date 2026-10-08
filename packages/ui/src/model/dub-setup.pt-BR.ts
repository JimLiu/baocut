import type { DubSetupMessages } from './dub-setup.ts';

export const ptBR: DubSetupMessages = {
  useExisting: (name: string) => `Usar tradução existente · ${name}`,
  translateFirst: (language: string) => `${language} · Traduzir primeiro`, sameAsSource: 'Mesmo idioma do original',
  missingLibraryVoice: (id: string) => `Voz da biblioteca (${id}, não está mais na biblioteca)`,
  voiceRemoved: 'Esta voz não está mais na biblioteca', noConsent: 'Sem declaração de consentimento do falante, não será enviada ao provedor',
  notCloned: (provider: string) => `Ainda não clonada com ${provider}`,
  cloneExpired: (provider: string) => `O clone com ${provider} expirou; clone novamente`,
  modelDefaultNamed: (voice: string) => `Padrão do modelo · ${voice}`, modelDefault: 'Padrão do modelo',
  noDefaultVoice: 'Este modelo não tem voz padrão', needsVoice: 'Este modelo exige uma voz especificada', presetVoice: 'Voz predefinida',
  myVoiceProblem: (problem: string) => `Minhas vozes · ${problem}`, myVoice: 'Minhas vozes', customVoice: 'Inserir ID de voz…', customVoiceDesc: 'Uma voz da sua conta do provedor',
  purpose: (language: string, videoName: string | null) => `Dublagem: dublar ${videoName ? `“${videoName}”` : 'este vídeo'} em ${language}`,
  kindList: (kinds: readonly string[]) => kinds.join(', '),
  transcriptNote: ' (a tradução a sintetizar; ao traduzir primeiro, também o texto original)',
  factWhat: 'Dados enviados', factTo: 'Enviados a', factScope: 'Escopo', factPurpose: 'Finalidade', factBudget: 'Orçamento', factRevoke: 'Revogação',
  scopeVideoNamed: (name: string) => `Somente o vídeo “${name}”`, scopeThisVideo: 'Somente este vídeo',
  budget: 'Contado por chamada, custo desconhecido, chamadas ilimitadas; o provedor cobra pelo uso normalmente',
  revoke: 'Revogue a qualquer momento em Configurações › Privacidade e permissões › Autorizações de compartilhamento de dados; dados já enviados não podem ser recuperados',
};
