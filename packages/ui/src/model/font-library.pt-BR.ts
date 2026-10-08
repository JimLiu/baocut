import { intlLocale } from '@baocut/protocol';
import type { FontScript } from '@baocut/protocol';
import type { FontFamilyStatus } from '@baocut/protocol';
import type { FontFamilyState } from '@baocut/protocol';
import type { FontCategory } from '@baocut/protocol';
import type { FontLibraryMessages } from './font-library.ts';

import { pluralForm } from '@baocut/protocol';
const fontsN = (n: number) => `${n} ${pluralForm('pt-BR', n, { one: 'fonte', other: 'fontes' })}`;
const familiesN = (n: number) => `${n} ${pluralForm('pt-BR', n, { one: 'família', other: 'famílias' })}`;

export const ptBR: FontLibraryMessages = {
  state: {
    'built-in': "Integrado",
    installed: "Este computador",
    downloaded: "Baixado",
    downloadable: "Disponível para baixar",
    downloading: "Baixando",
    failed: "Falhou",
    unavailable: "Fonte não encontrada",
  } as Record<FontFamilyState, string>,
  source: {
    'built-in': "Incluída no aplicativo",
    local: "Instalado neste computador",
    'google-fonts': "Google Fonts",
  } as Record<FontFamilyStatus['source'], string>,
  categories: {
    'sans-serif': "Sem serifa",
    serif: "Com serifa",
    display: "Exibição",
    handwriting: "Manuscrita",
    monospace: "Monoespaçada",
  } as Record<FontCategory, string>,
  scripts: {
    chinese: "Chinês",
    japanese: "Japonês",
    korean: "Coreano",
    latin: "Latino",
    cyrillic: "Cirílico",
    greek: "Grego",
    vietnamese: "Vietnamita",
    arabic: "Árabe",
    hebrew: "Hebraico",
    thai: "Tailandês",
    devanagari: "Devanágari",
  } as Record<Exclude<FontScript, 'other'>, string>,
  privacyNote: "Baixada do Google Fonts; envia só família e pesos. Armazenada nos dados do aplicativo, não no vídeo.",
  offlineNote: "Off-line · fontes baixáveis precisam de rede",
  strictOfflineNote: "Off-line estrito ativo · sem download, usa fonte alternativa",
  waiting: "Aguardando",
  sections: { search: "Resultados da busca", video: "Usadas neste vídeo", recent: "Usadas recentemente", all: "Todas as fontes" } as Record<
    'search' | 'video' | 'recent' | 'all',
    string
  >,
  cancelled: "Cancelado",
  downloadFailed: "Download falhou",
  pickToast: (family: string, fallback: string) => `“${family}” é exibida com “${fallback}” até baixar, depois troca automaticamente`,
  alreadyDownloaded: (family: string) => `“${family}” já está baixada`,
  detail: { status: "Estado", source: "Fonte", category: "Categoria", weights: "Pesos", size: "Tamanho", licence: "Licença" },
  scriptJoin: (labels: readonly string[]) => labels.join(", "),
  withItalics: " (com itálico)",
  downloadedSize: (size: string) => `${size} baixados`,
  unknownLicence: "Desconhecida (fonte local; confira se pode publicar)",
  mirrorInvalid: "Endereço inválido",
  mirrorHttps: "Só endereços https:// são aceitos",
  mirrorCredentials: "Endereço não pode conter usuário ou senha",
  mirrorQuery: "Endereço não pode conter consulta ou #",
  italic: " itálico",
  cleared: (removed: number, freed: string, kept: number) =>
    `Excluídas ${familiesN(removed)} e liberados ${freed}${kept ? ` · ${kept} em uso por exportações ${pluralForm('pt-BR', kept, { one: "foi mantida", other: "foram mantidas" })}` : ""}`,
  clearConfirm: (count: number, size: string, inUse: boolean) =>
    `Excluir ${familiesN(count)}, ${size} no total. Vídeos usam fonte alternativa até baixar novamente.` +
    (inUse ? " Fontes em uso por exportações inacabadas serão mantidas." : ""),
  barOff: (total) => `Este vídeo usa ${fontsN(total)} ${pluralForm('pt-BR', total, { one: 'não baixada', other: 'não baixadas' })}; mostrando uma fonte alternativa`,
  autoOff: "Download automático desativado",
  barRunning: "Baixando fontes deste vídeo",
  barReady: (total) => `${total} ${pluralForm('pt-BR', total, { one: 'fonte usada neste vídeo está pronta', other: 'fontes usadas neste vídeo estão prontas' })}`,
  barMissed: (n) => `Não foi possível obter ${fontsN(n)}; mostrando uma fonte alternativa`,
  skipped: "Ignorado",
  notDownloaded: "Não baixado",

  quoteList: (names: readonly string[]) => new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(names.map((n) => `“${n}”`)),
  exportPending: (names, n) => `${names} ${pluralForm('pt-BR', n, { one: 'ainda está baixando', other: 'ainda estão baixando' })} · A exportação aguarda o fim do download antes de renderizar`,
  exportFailed: (names, fallbacks) => `Não foi possível baixar ${names} · A exportação usará ${fallbacks}`,
  exportMissingAuto: (names, n) => `${names} ${pluralForm('pt-BR', n, { one: 'ainda não foi baixada', other: 'ainda não foram baixadas' })} · O download começa ao exportar; se falhar, será usada uma fonte alternativa`,
  exportMissingOff: (names, n) => `${names} ${pluralForm('pt-BR', n, { one: 'não foi baixada', other: 'não foram baixadas' })} (download automático desativado) · A exportação usará uma fonte alternativa`,
  actionRetry: "Tentar novamente",
  actionDownloadNow: "Baixar agora",
  actionDownload: "Baixar",
  exportFallback: (family: string, fallback: string, reason: string) => `“${family}” substituída por “${fallback}” · ${reason}`,
  exportFallbackSeparator: "; ",
  exportPhase: (detail: string | null) => (detail ? `Baixando fontes · ${detail}` : "Baixando fontes"),
  systemFont: "Fonte do sistema",
  errorFallback: "Operação não concluída",
  removed: (family: string) => `Arquivos baixados excluídos de “${family}”`,
  removeInUse: (family: string) => `Exportação inacabada usa “${family}” · exclua após concluir`,
};
