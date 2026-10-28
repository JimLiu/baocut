import type { ToolCatalogMessages } from './tool-catalog-copy.ts';

const artifactLabels = { audio: 'audio', image: 'imagen', doc: 'documento', final: 'archivo de vídeo', subtitle: 'subtítulos' };

export const es: ToolCatalogMessages = {
  inputLabels: { file: 'Archivo local', space: 'Space', link: 'Enlace', text: 'Texto', video: 'Vídeo en Space', document: 'Documento' },
  outputLabels: { video: 'Vídeo', artifact: 'Elemento en Space' },
  artifactLabels,
  tools: {
    transcribe: { name: 'Transcribir', desc: 'Convierte un archivo de vídeo o audio en una transcripción y subtítulos; si eliges un vídeo editable, los escribe en él y añade una capa de subtítulos' },
    'translate-subtitles': { name: 'Traducir subtítulos', desc: 'Traduce subtítulos a otro idioma; si eliges un vídeo transcrito, añade una traducción y una capa de subtítulos que puede mostrar ambos idiomas sin modificar el original' },
    dub: { name: 'Doblaje traducido', desc: 'Añade a un vídeo transcrito un nuevo doblaje a partir de su traducción; el audio original se puede atenuar, silenciar o conservar' },
    'synthesize-speech': { name: 'Generar voz', desc: 'Lee en voz alta texto, documentos o subtítulos de Space; usa una voz predefinida, clona una grabación o describe una voz' },
    'generate-text': { name: 'Generar texto', desc: 'Describe lo que necesitas y llama directamente a un modelo de texto para generar textos, guiones o resúmenes; puedes adjuntar documentos o subtítulos de Space como material' },
    'generate-image': { name: 'Generar imagen', desc: 'Describe una imagen y dibújala con un modelo de imágenes local o en la nube; las imágenes de referencia, la relación de aspecto y la cantidad son opcionales' },
    'upscale-image': { name: 'Ampliar imagen', desc: 'Amplía imágenes de 2 a 4× en este ordenador con Real-ESRGAN, waifu2x o pesos de Upscayl, o haz que un modelo de imagen las redibuje más grandes' },
    'remove-object': { name: 'Quitar objeto', desc: 'Pinta sobre las personas o cosas que no quieras y la zona se rellena a partir de lo que la rodea' },
    'remove-watermark': { name: 'Quitar marca de agua', desc: 'Enmarca una marca de agua, un logotipo o una barra de subtítulos; las imágenes que la tengan en el mismo sitio se procesan de una vez' },
    'repaint-image': { name: 'Redibujar zona', desc: 'Pinta una zona y di en qué debe convertirse; solo cambia esa zona' },
    'expand-image': { name: 'Expandir imagen', desc: 'Amplía la imagen a una nueva relación de aspecto; los bordes añadidos continúan el original' },
    'generate-music': { name: 'Generar música', desc: 'Escribe un estilo y, opcionalmente, una letra, y compón una canción o pista instrumental con un modelo de música local; la duración y la semilla son opcionales' },
    'link-import': { name: 'Descargar vídeo', desc: 'Pega un enlace para descargar un vídeo a este ordenador; puedes usar cookies del navegador y transcribir la descarga para obtener una transcripción y subtítulos' },
    'compress-video': { name: 'Comprimir vídeo', desc: 'Recodifica con un tamaño o una calidad objetivo; reduce el tamaño antes de enviar o subir' },
    'merge-video': { name: 'Unir vídeos', desc: 'Une varios vídeos en un solo archivo, uno tras otro y en orden' },
    'extract-audio': { name: 'Extraer audio', desc: 'Elimina la imagen y conserva solo la pista de audio; los códecs de audio habituales se copian tal cual, sin recodificar' },
  },
  targetNone: 'Crear solo una transcripción y subtítulos', targetCreate: 'Crear un vídeo en un proyecto', subtitleFile: 'Archivo de subtítulos local',
  groups: {
    speech: { label: 'Voz y subtítulos', desc: 'Transcribe, traduce subtítulos, añade doblajes y lee texto en voz alta. Los resultados son elementos de documento, subtítulos y audio; elegir un vídeo editable en Space escribe en él.' },
    'text-image': { label: 'Texto e imágenes', desc: 'Llama directamente a modelos de texto e imágenes. Los resultados son elementos de documento e imagen.' },
    music: { label: 'Música', desc: 'Genera canciones y música de fondo con un modelo de música local. Los resultados son elementos de audio.' },
    'video-file': { label: 'Archivos de vídeo', desc: 'Descarga, comprime y une vídeos, y extrae audio con yt-dlp y ffmpeg en este ordenador. Los resultados son elementos de archivo de vídeo y audio.' },
  },
  artifactItems: (artifacts) => artifacts.length ? `elementos de ${artifacts.map((a) => artifactLabels[a]).join(' y ')}` : 'elementos de resultado',
  resultWritesVideo: 'Resultado: se escribe en el vídeo que elijas',
  resultInSpace: (items) => `Resultado: ${items} en Space`,
  resultAlsoCreate: 'también puede crear un vídeo nuevo',
  resultWritesEditable: 'se escribe en un vídeo editable cuando eliges uno',
  joinResult: (parts) => parts.join('; '),
};
