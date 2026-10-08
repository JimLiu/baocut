import type { ExportSettingsMessages } from './export-settings.ts';
export const es: ExportSettingsMessages = {
 quality: { small: 'Archivo más pequeño', standard: 'Estándar', high: 'Alta calidad' },
 qualityNote: { small: 'Más compresión, algo menos de detalle y un archivo más pequeño', standard: 'Calidad y tamaño predeterminados', high: 'Más detalle, archivo más grande' },
 loudnessOn: (lufs, truePeak) => `Normalizar toda la mezcla a ${lufs} LUFS, con un pico real máximo de ${truePeak} dBTP.`,
 loudnessOff: 'Desactivado: exportar la mezcla tal como está en el vídeo.',
 audioFormatNote: { wav: 'Sin pérdida · Archivo más grande · Para continuar la posproducción', mp3: 'Universal · Compatible con plataformas de pódcast, equipos de coche y dispositivos antiguos', m4a: 'AAC · Un poco más claro que MP3 a la misma tasa de bits · Nativo de dispositivos Apple' },
 dubGroup: (language) => language ? `Doblaje en ${language}` : 'Este grupo de doblaje',
 mix: 'Exportar mezcla', mixNote: 'Igual que lo que oyes ahora en la línea de tiempo', originalOnly: 'Solo audio original',
 originalOnlyNote: 'Elimina todos los doblajes y restaura el audio original que silenciaron',
 dubOnly: (label) => `Solo ${label}`, dubOnlyNote: 'Conserva solo este grupo de doblaje, sin el audio original, música ni otros doblajes',
 mono: 'Mono', stereo: 'Estéreo',
 subtitleFormatNote: { srt: 'Universal: compatible con casi todos los reproductores y plataformas', vtt: 'Para reproductores web, con indicaciones de posición', ass: 'Conserva el estilo de los subtítulos (fuente, contorno, posición); menos reproductores lo admiten', json: 'Marcas de tiempo por palabra en cada entrada, para scripts y herramientas' },
 transcription: 'Transcripción', plainText: 'Texto sin formato',
 transcriptFormatNote: { md: 'Metadatos iniciales opcionales, capítulos como encabezados, hablantes en negrita y traducciones como citas · Pegar en notas o documentos', txt: 'Sin marcas de formato · Encabezados de capítulo en su propia línea' },
};
