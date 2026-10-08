import type { FontsMessages } from './fonts-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: FontsMessages = {
  help: `Uso:
  baocut fonts [downloaded]        Fontes baixadas (Google Fonts, baixadas sob demanda):
                                   família, pesos, tamanho, licença e tamanho total
  baocut fonts search [text] [--category <category>] [--script <script>] [--limit <n>]
                                   Lista do seletor de fontes: famílias incluídas no aplicativo, neste computador e no
                                   catálogo de fontes, com seus estados (integrada, neste computador, baixada, disponível
                                   para baixar, baixando, falhou). Categorias: sans-serif, serif, display, handwriting,
                                   monospace; sistemas de escrita: chinese, japanese, korean, latin…
  baocut fonts download <family> [--weights 400,700] [--italic]
                                   Baixar uma família (normal e negrito por padrão); a progressão vai para stderr e Ctrl-C
                                   cancela. Só o nome da família e os pesos são enviados; para espelhos, veja as configurações
                                   fonts.cssEndpoint e fonts.fileEndpoint; recusado no modo off-line estrito
  baocut fonts remove <family>     Excluir as fontes baixadas desta família (recusado se uma exportação inacabada as usa)
  baocut fonts clear               Limpar fontes baixadas (as usadas por exportações inacabadas são mantidas)`,
  alreadyDownloaded: (family) => `“${family}” já foi baixada`, downloadDone: 'Download concluído', remedy: (text) => `Para corrigir: ${text}`, usage: 'Uso: baocut fonts [downloaded] | search [text] [--category <category>] [--script <script>] [--limit <n>] | download <family> [--weights 400,700] [--italic] | remove <family> | clear', listSep: ', ', categoryChoices: (choices) => `--category deve ser um de ${choices.join(', ')}`, scriptChoices: (choices) => `--script deve ser um de ${choices.join(', ')}`, limitRange: '--limit deve ser um inteiro de 1 a 500', italicNeedsWeights: '--italic deve ser usado com --weights', weightsFormat: '--weights aceita pesos de 1 a 1000 separados por vírgulas', stateLabels: { 'built-in': 'Integrada', installed: 'Neste computador', downloaded: 'Baixada', downloadable: 'Disponível para baixar', downloading: 'Baixando', failed: 'Falhou', unavailable: 'Não disponível' }, face: (weight, italic) => `${weight}${italic ? ' itálico' : ''}`, noDownloads: 'Nenhuma fonte baixada',
  downloadedTotal: (families, faces, size) => `${families} ${pluralForm('pt-BR', families, { one: 'família', other: 'famílias' })}, ${faces} ${pluralForm('pt-BR', faces, { one: 'peso', other: 'pesos' })}, ${size} no total`, noMatches: 'Nenhuma fonte correspondente', failedWithReason: (state, message) => `${state} (${message})`, truncated: (total, shown) => `(${total} no total, mostrando as primeiras ${shown})`, removed: (count, freed) => `${count} ${pluralForm('pt-BR', count, { one: 'peso excluído', other: 'pesos excluídos' })}, ${freed} liberados`, nothingToRemove: 'Nenhuma fonte para excluir', kept: (count, faces) => `${count} mantidos (em uso por exportações inacabadas): ${faces.join(', ')}`,
};
