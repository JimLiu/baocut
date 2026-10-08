import type { ToolTargetsMessages } from './tool-targets-copy.ts';

export const ptBR: ToolTargetsMessages = {
  unknownLanguage: 'Idioma desconhecido',
  langCount: (label, count) => `${label} ×${count}`, joinLangs: (labels) => labels.join(', '),
  tagTranscript: (langs) => `Transcrição · ${langs}`, tagTranslation: (langs) => `Tradução · ${langs}`, tagDub: (langs) => `Dublagem · ${langs}`,
  tagPending: 'Ainda lendo o conteúdo; uma transcrição será escolhida ao iniciar',
  blockTranscribing: 'Transcrevendo agora; você pode retranscrever quando terminar',
  blockQueued: 'Já está na fila de transcrição',
  blockTranscribingWait: 'Transcrevendo agora; você pode escolher quando terminar',
  blockQueuedWait: 'Na fila de transcrição; você pode escolher após a transcrição',
  blockFailed: 'A última transcrição falhou; transcreva novamente primeiro',
  blockNoTranscript: 'Ainda não há transcrição; transcreva primeiro',
  duplicateTranscript: (langs) =>
    `Este vídeo já tem transcrição em ${langs}. Por padrão, um vídeo novo é criado e este vídeo e suas traduções não mudam. “Substituir a transcrição deste vídeo” troca a transcrição atual: as traduções são transferidas pareando o original, frases cujo original mudou são marcadas como defasadas, e tudo é uma única alteração que você pode desfazer.`,
  duplicateTranslation: (lang) =>
    `Este vídeo já tem tradução em ${lang}. Isto adiciona outra e mantém a existente; escolha qual usar no editor.`,
  duplicateDub: (lang) => `Este vídeo já tem dublagem em ${lang}. Isto adiciona outro grupo e mantém o existente.`,
  duplicateTitle: {
    transcribe: 'Este vídeo já tem transcrição',
    'translate-subtitles': 'Traduções existentes são mantidas',
    dub: 'Dublagens existentes são mantidas',
  },
  translationOption: (lang, nth) => `Tradução em ${lang}${nth === null ? '' : ` #${nth}`}`,
  translatedFrom: (lang) => `Da transcrição em ${lang}`,
  destNewVideo: 'Vídeo novo',
  destNewVideoNote: 'Um vídeo novo no mesmo projeto, vinculado à mesma mídia; este vídeo e suas traduções não mudam',
  destReplace: 'Substituir a transcrição deste vídeo',
  destReplaceNote: 'Troca a transcrição atual; traduções, legendas e dublagens são transferidas na mesma alteração, que você pode desfazer',
  newVideoName: (name) => `${name} · Retranscrito`,
  impactTranslation: (lang, units) => `${lang} · ${units} ${units === 1 ? 'frase' : 'frases'}`,
  impactDub: (lang, groups) =>
    `${lang} · ${groups} ${groups === 1 ? 'grupo' : 'grupos'} · a dublagem de frases cuja tradução não muda é mantida e marcada como possivelmente fora de sincronia`,
  impactRule:
    'Frases cujo original não muda mantêm a tradução e o status de revisão, alinhadas por frase; as que mudaram ou não podem ser pareadas são marcadas como defasadas, para retraduzir depois com “Atualizar traduções defasadas”. Os números exatos aparecem no resultado.',
  impactUndo: 'Uma única alteração, que você pode desfazer',
};
