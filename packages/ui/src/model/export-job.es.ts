import type { ExportJobMessages } from './export-job.ts';
import { pluralForm } from '@baocut/protocol';
const countEs = (n: number, one: string, other: string) => `${n} ${pluralForm('es', n, { one, other })}`;
export const es: ExportJobMessages = {
  tabVideo: 'Vídeo', tabAudio: 'Audio', tabSubtitles: 'Subtítulos', tabTranscript: 'Transcripción', tabProject: 'Archivo de proyecto', export: 'Exportar',
  queued: 'Exportación en cola', exporting: 'Exportando…', exportingPct: (pct) => `Exportando · ${pct}%`,
  formats: { md: 'Markdown', txt: 'Texto sin formato', xmeml: 'FCP7 XML' },
  titleVideo: (format) => `Exportar vídeo · ${format}`, titleAudio: (format) => `Exportar audio · ${format}`,
  titleSubtitles: (format) => `Exportar subtítulos · ${format}`, titleTranscript: (format) => `Exportar transcripción · ${format}`,
  titlePortable: 'Exportar paquete portable', titleProject: (format) => `Exportar archivo de proyecto · ${format}`,
  generating: { video: 'Codificando', audio: 'Mezclando', subtitles: 'Escribiendo archivos', transcript: 'Escribiendo archivos', portable: 'Empaquetando', project: 'Escribiendo archivo de proyecto' },
  retrying: 'Reintentando automáticamente tras un error', saving: 'Guardando archivos',
  framesOf: (done, total) => `Renderizados ${done} / ${total} fotogramas`, frames: (done) => `Renderizados ${done} fotogramas`,
  secondsOf: (done, total) => `Procesado ${done} / ${total}`, seconds: (done) => `Procesado ${done}`,
  outputsOf: (done, total) => `Escritos ${done} / ${total} ${pluralForm('es', total, { one: 'archivo', other: 'archivos' })}`,
  outputs: (done) => `${pluralForm('es', done, { one: 'Escrito', other: 'Escritos' })} ${countEs(done, 'archivo', 'archivos')}`,
  bytesOf: (done, total) => `Empaquetado ${done} / ${total}`, bytes: (done) => `Empaquetado ${done}`,
  fps: (n) => `${n} fps`,
  timeLeft: (clock) => `Quedan ${clock}`,
  mono: 'Mono', stereo: 'Estéreo', entries: (n) => countEs(n, 'entrada', 'entradas'), files: (n) => countEs(n, 'archivo', 'archivos'),
  assetRevisions: (n) => countEs(n, 'versión de material', 'versiones de material'), missing: (n) => `${n} ausentes`,
  clips: (n) => countEs(n, 'clip', 'clips'), omitted: (n) => `${countEs(n, 'elemento', 'elementos')} sin escribir en el archivo de proyecto`,
  doneMany: (n, total) => `${countEs(n, 'archivo', 'archivos')} · ${total} en total`,
  cancelledKept: (n) => `${pluralForm('es', n, { one: 'Se conserva el archivo guardado', other: `Se conservan los ${n} archivos guardados` })} · El vídeo no se ve afectado`,
  cancelledRemoved: 'Se eliminaron los archivos sin terminar · El vídeo no se ve afectado',
};
