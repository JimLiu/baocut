import type { JobsTranslateSubtitlesMessages } from './translate-subtitles.ts';
import { pluralForm } from '../../i18n.ts';

export const ptBR: JobsTranslateSubtitlesMessages = {
  label: 'Traduzir arquivo de legendas',
  description: 'Traduz um arquivo de legendas SRT ou WebVTT para outro idioma, legenda por legenda, e grava um novo arquivo. A quantidade de legendas e os códigos de tempo permanecem iguais; o resultado pode ser bilíngue ou em outro formato. O vídeo não é alterado.',
  stepRead: 'Ler legendas', stepTranslate: 'Traduzir', stepCheck: 'Verificar', stepPublish: 'Publicar',
  noStructuredOutput: (p) => `O modelo ${p.model} não oferece suporte a saída estruturada e não pode ser usado para tradução`,
  artifactGone: (p) => `O resultado ${p.artifactId} não existe mais`,
  paramNotAbsolute: (p) => `O parâmetro ${p.key} deve ser um caminho absoluto`, inputNotSubtitle: 'O parâmetro input deve ser um arquivo .srt ou .vtt',
  languageInvalid: (p) => `O parâmetro ${p.key} deve ser uma tag de idioma BCP 47`, bilingualInvalid: 'O parâmetro bilingual deve ser true ou false',
  fileNotFound: (p) => `Não foi possível encontrar o arquivo de legendas ${p.file}`,
  fileTooLarge: (p) => `O arquivo de legendas tem ${p.bytes} B, acima do limite de ${p.limit}`,
  noText: 'O arquivo de legendas não tem texto para traduzir', allEmpty: 'Todas as legendas estão vazias',
  markupStripped: (p) => pluralForm('pt-BR', p.count, { one: `${p.count} legenda tinha marcação inline (itálico, cor, posição etc.) que não foi mantida na tradução`, other: `${p.count} legendas tinham marcação inline (itálico, cor, posição etc.) que não foi mantida na tradução` }),
  cueNoTranslation: (p) => `A legenda ${p.n} não tem tradução`, rereadFailed: 'Não foi possível reler as legendas gravadas',
  cueCountMismatch: (p) => `Gravadas ${pluralForm('pt-BR', p.written, { one: `${p.written} legenda`, other: `${p.written} legendas` })}; o arquivo original tem ${p.original}`,
  timingChanged: (p) => `O código de tempo da legenda ${p.n} mudou: ${p.from} → ${p.to}`,
  cannotMatch: 'Não é possível gravar a tradução como legendas que correspondam uma a uma ao arquivo original',
  settingsDropped: (p) => `Convertido para SRT: cue settings de ${pluralForm('pt-BR', p.settings, { one: `${p.settings} legenda`, other: `${p.settings} legendas` })} e ${pluralForm('pt-BR', p.blocks, { one: `${p.blocks} bloco`, other: `${p.blocks} blocos` })} NOTE, STYLE e REGION não cabem e não foram mantidos`,
};
