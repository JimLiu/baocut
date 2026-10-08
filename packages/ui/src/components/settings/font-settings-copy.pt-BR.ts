import { intlLocale } from '@baocut/protocol';
import type { FontSettingsMessages } from './font-settings-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: FontSettingsMessages = {
  lead: (total: number | null) => `As fontes vêm de três fontes: as incluídas no aplicativo, as instaladas neste computador e o catálogo Google Fonts (${total === null ? 'cerca de duas mil famílias' : pluralForm('pt-BR', total, { one: `cerca de ${total.toLocaleString(intlLocale())} família`, other: `cerca de ${total.toLocaleString(intlLocale())} famílias` })}, licenças de código aberto, baixadas sob demanda). Os downloads enviam apenas nome da família e peso, sem precisar de conta; as fontes ficam nos dados do aplicativo, não na pasta do vídeo.`,
  download: 'Baixar', autoDownload: 'Baixar fontes automaticamente',
  autoDownloadDesc: 'Baixa do Google Fonts quando a prévia, a abertura de um vídeo ou a exportação precisa de uma fonte que este computador não tem. Quando desativado, fontes alternativas são usadas primeiro para exibir e exportar, e você ainda pode baixar manualmente ao escolher uma fonte. Nada é baixado no modo estritamente off-line.',
  cssEndpoint: 'URL da folha de estilos', cssEndpointDesc: 'URL base de um espelho. Deixe vazio para usar https://fonts.googleapis.com.',
  fileEndpoint: 'URL dos arquivos de fonte', fileEndpointDesc: 'Os arquivos de fonte só são obtidos sob esta URL. Deixe vazio para usar https://fonts.gstatic.com.',
  downloaded: 'Fontes baixadas', summary: (families: number, size: string) => `${pluralForm('pt-BR', families, { one: `${families} família`, other: `${families} famílias` })} · ${size}`,
  none: 'Ainda nenhuma', clearAll: 'Limpar tudo',
  empty: 'Fontes baixadas ao escolher uma fonte ou automaticamente ao abrir um vídeo ou exportar aparecem aqui.',
  clearTitle: 'Limpar fontes baixadas?', clear: 'Limpar', cancel: 'Cancelar',
  removed: (family: string, size: string) => `Excluído: “${family}” · Liberado ${size}`,
  inUseTip: 'Uma exportação ainda não concluída está usando; exclua depois que terminar', removeTip: 'Excluir os arquivos baixados desta fonte',
  removeLabel: (tip: string, family: string) => `${tip}: ${family}`,
  facts: (weights: string, size: string, licence: string, ago: string | null) => `Pesos ${weights} · ${size} · ${licence}${ago ? ` · Baixada ${ago}` : ''}`,
  inUse: 'Em uso na exportação',
};
