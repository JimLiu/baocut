import type { ExportSettingsMessages } from './export-settings.ts';

export const ptBR: ExportSettingsMessages = {
  quality: { small: 'Arquivo menor', standard: 'Padrão', high: 'Alta qualidade' },
  qualityNote: { small: 'Compressão maior, um pouco menos de detalhe, arquivo menor', standard: 'Qualidade e tamanho padrão', high: 'Mais detalhes, arquivo maior' },
  loudnessOn: (lufs: string, truePeak: string) => `Normalizar toda a mixagem para ${lufs} LUFS, com pico verdadeiro de no máximo ${truePeak} dBTP.`,
  loudnessOff: 'Desativado: exportar a mixagem como está no vídeo.',
  audioFormatNote: { wav: 'Sem perdas · Maior arquivo · Use para pós-produção adicional', mp3: 'Universal · Funciona em plataformas de podcast, som automotivo e dispositivos antigos', m4a: 'AAC · Um pouco mais claro que MP3 na mesma taxa de bits · Nativo em dispositivos Apple' },
  dubGroup: (language: string | null) => language ? `Dublagem em ${language}` : 'Este grupo de dublagem',
  mix: 'Mixagem da exportação', mixNote: 'Igual ao que você ouve agora na linha do tempo',
  originalOnly: 'Somente áudio original', originalOnlyNote: 'Remove todas as dublagens e restaura o áudio original que elas silenciaram',
  dubOnly: (label: string) => `Somente ${label}`, dubOnlyNote: 'Mantém somente este grupo de dublagem, sem áudio original, música ou outras dublagens',
  mono: 'Mono', stereo: 'Estéreo',
  subtitleFormatNote: { srt: 'Universal: funciona em quase todos os reprodutores e plataformas', vtt: 'Para reprodutores web, com dicas de posição', ass: 'Mantém o estilo das legendas (fonte, contorno, posição); menos reprodutores oferecem suporte', json: 'Tempos de cada palavra em cada entrada, para scripts e ferramentas' },
  transcription: 'Transcrição', plainText: 'Texto simples',
  transcriptFormatNote: { md: 'Metadados iniciais opcionais, capítulos como títulos, falantes em negrito e traduções como citações · Cole em notas ou documentos', txt: 'Sem marcas de formatação · Títulos de capítulo em linha própria' },
};
