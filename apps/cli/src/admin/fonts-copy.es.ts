import type { FontsMessages } from './fonts-copy.ts';
import { pluralForm } from '@baocut/protocol';
export const es: FontsMessages = {
 help: `Uso:
  baocut fonts [downloaded]        Fuentes descargadas (Google Fonts, descargadas bajo demanda):
                                   familia, pesos, tamaño, licencia y tamaño total
  baocut fonts search [text] [--category <category>] [--script <script>] [--limit <n>]
                                   Lista del selector de fuentes: familias incluidas, instaladas en este ordenador y del
                                   catálogo, con su estado (integrada, en este ordenador, descargada, descargable,
                                   descargando, fallida). Categorías: sans-serif, serif, display, handwriting,
                                   monospace; escrituras: chinese, japanese, korean, latin…
  baocut fonts download <family> [--weights 400,700] [--italic]
                                   Descargar una familia (normal y negrita por defecto); progreso en stderr, Ctrl-C
                                   cancela. Solo se envían el nombre de familia y los pesos; para servidores espejo, consulta
                                   fonts.cssEndpoint y fonts.fileEndpoint; se rechaza en modo sin conexión estricto
  baocut fonts remove <family>     Eliminar fuentes descargadas de esta familia (se rechaza si las usa una exportación sin terminar)
  baocut fonts clear               Eliminar fuentes descargadas (se conservan las usadas por exportaciones sin terminar)`,
 alreadyDownloaded: (family) => `«${family}» ya está descargada`, downloadDone: 'Descarga completada', remedy: (text) => `Para corregir: ${text}`,
 usage: 'Uso: baocut fonts [downloaded] | search [text] [--category <category>] [--script <script>] [--limit <n>] | download <family> [--weights 400,700] [--italic] | remove <family> | clear',
 listSep: ', ', categoryChoices: (choices) => `--category debe ser uno de ${choices.join(', ')}`, scriptChoices: (choices) => `--script debe ser uno de ${choices.join(', ')}`, limitRange: '--limit debe ser un entero entre 1 y 500', italicNeedsWeights: '--italic se usa con --weights', weightsFormat: '--weights acepta pesos de 1 a 1000 separados por comas',
 stateLabels: { 'built-in': 'Integrada', installed: 'En este ordenador', downloaded: 'Descargada', downloadable: 'Descargable', downloading: 'Descargando', failed: 'Fallido', unavailable: 'No disponible' }, face: (weight, italic) => `${weight}${italic ? ' cursiva' : ''}`, noDownloads: 'Aún no hay fuentes descargadas',
 downloadedTotal: (families, faces, size) => `${families} ${pluralForm('es', families, { one: 'familia', other: 'familias' })}, ${faces} ${pluralForm('es', faces, { one: 'peso', other: 'pesos' })}, ${size} en total`, noMatches: 'Sin fuentes coincidentes', failedWithReason: (state, message) => `${state} (${message})`, truncated: (total, shown) => `(${total} en total, se muestran las primeras ${shown})`, removed: (count, freed) => `Eliminados ${count} ${pluralForm('es', count, { one: 'peso', other: 'pesos' })}, liberados ${freed}`, nothingToRemove: 'No hay fuentes que eliminar', kept: (count, faces) => `Conservados ${count} (en uso por exportaciones sin terminar): ${faces.join(', ')}`,
};
