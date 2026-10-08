import type { TranscribeSetupMessages } from './transcribe-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: TranscribeSetupMessages = {
  title: 'Configurações de transcrição', language: 'Idioma', model: 'Modelo de fala',
  manageModels: 'Gerenciar modelos de fala', modelsLoading: 'Carregando modelos de fala…', noDefault: 'Ainda não há modelo de fala padrão',
  hint: 'Dicas de reconhecimento', glossary: 'Glossário', manageGlossary: 'Gerenciar glossários', glossaryLoading: 'Carregando glossários…',
  glossaryEmpty: 'Ainda não há glossários de transcrição. Crie um em Configurações › Glossário para registrar a grafia correta de nomes e termos.',
  glossaryFailed: (message: string) => `Não foi possível ler os glossários ativados neste vídeo: ${message}`,
  glossaryNote: 'Marque um glossário para ativar neste vídeo; toda transcrição futura o usará. Você pode desfazer.',
  glossaryReadOnly: 'Este vídeo não pode ser editado agora, então seus glossários ativados não podem ser alterados.',
  glossaryLimit: (n: number) => pluralForm('pt-BR', n, { one: `Um vídeo pode ter no máximo ${n} glossário ativado`, other: `Um vídeo pode ter no máximo ${n} glossários ativados` }),
  glossaryOn: (name: string) => `Ativado neste vídeo: “${name}”`, glossaryOff: (name: string) => `Desativado: “${name}”`,
  glossaryWriteFailed: (message: string) => `Não foi possível alterar os glossários ativados: ${message}`,
  undo: 'Desfazer', prompt: 'Prompt personalizado',
  promptPlaceholder: 'Opcional. Por exemplo: Um podcast em inglês sobre otimização de inferência de LLMs, apresentado por Lin Che com o convidado Zhou Yuan.',
  how: 'O prompt e os glossários ativados (grafias corretas) são enviados juntos ao modelo de fala para ajudar a reconhecer nomes e termos. Se excederem o limite, os termos do fim serão descartados.',
  reuse: 'Mídias já transcritas reutilizam a transcrição existente; estas configurações só se aplicam a mídias que ainda precisam ser transcritas.',
};
