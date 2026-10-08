import type { ModelsInstallMessages } from './models-install-copy.ts';
import { pluralForm } from '@baocut/protocol';

const KEEP = 'O que já foi baixado é mantido, e o próximo download continua de onde parou.';
const SOURCE = '“Fonte de download de modelos” em Configurações › Geral';
const and = (items: readonly string[]) => new Intl.ListFormat('pt-BR', { type: 'conjunction' }).format(items);
const files = (n: number) => pluralForm('pt-BR', n, { one: `${n} arquivo`, other: `${n} arquivos` });

export const ptBR: ModelsInstallMessages = {
  planSize: (size: string) => `Download de ${size}`, planSizeEstimate: (size: string) => `Cerca de ${size} (alguns tamanhos de arquivo são desconhecidos, então usa a estimativa registrada)`, amountEstimate: (size: string) => `Cerca de ${size}`,
  noSpace: (need: string, have: string) => `Espaço em disco insuficiente: precisa de ${need}, e o disco com a pasta de modelos só tem ${have} livres. Libere espaço antes de baixar.`,
  resumed: (size: string) => `${size} baixados antes são reutilizados, sem baixar novamente.`, space: (size: string) => `${size} livres em disco`, lineKeep: 'Já instalado, mantido como está',
  lineSize: (size: string, count: number) => `${size} · ${files(count)}`, lineUnknown: (count: number) => `Tamanho desconhecido · ${files(count)}`,
  queued: 'Na fila de download', downloading: (amount: string) => `Baixando ${amount}`, downloadingUnknown: (amount: string) => `Baixando · ${amount} recebidos`, verifying: 'Verificando e publicando',
  pausedKept: (amount: string) => `Pausado · ${amount} mantidos; retomar continua de onde parou`, paused: 'Pausado',
  remedyNoSpace: (need: string | null, have: string | null) => `${need !== null && have !== null ? `Precisa de ${need}, e restam somente ${have}. ` : ''}Libere espaço em disco e baixe novamente. ${KEEP}`,
  remedyNetwork: `Verifique a rede e baixe novamente. ${KEEP} Se não for possível acessar a fonte padrão, troque por um espelho em ${SOURCE}.`,
  remedyIntegrity: `Os arquivos da fonte de download não correspondem ao tamanho ou sha256 do manifesto e os inválidos foram excluídos. Troque a fonte de download (${SOURCE}) e baixe novamente.`,
  remedySource: `A fonte de download não tem este arquivo ou negou o acesso. Verifique se o espelho definido em ${SOURCE} (ou na variável de ambiente BAOCUT_MODELS_ENDPOINT) está completo.`,
  remedyManifest: 'O manifesto integrado deste pacote de modelo não tem sha256 confiável, então não pode ser instalado até atualizar o BaoCut.',
  remedyOffline: 'O modo estritamente off-line está ativado, então nada é baixado. Para baixar, desative esse modo nas Configurações primeiro.',
  remedySizeChanged: 'O tamanho do download mudou. Confirme novamente com o novo plano.',
  remedyInUse: 'Uma tarefa está usando este pacote de modelo (transcrição, síntese, verificação ou instalação). Espere terminar ou cancele em Tarefas em segundo plano e exclua novamente.',
  remedyUnavailable: 'O pacote de modelo não pode ser usado agora (instalação incompleta, desativado ou não suportado neste computador). Repare ou ative primeiro.', remedyInstallFailed: `Tente baixar novamente. ${KEEP}`,
  problemText: (message: string, remedy: string) => /[.!?。！？]$/.test(message) ? `${message} ${remedy}` : `${message}. ${remedy}`,
  removalBody: (unknown: boolean, frees: string | null, kept: readonly { repo: string; usedBy: readonly string[] }[]) => [ unknown ? 'Exclui os arquivos usados somente por este pacote de modelo.' : frees !== null ? `Libera cerca de ${frees}.` : null, ...kept.map((k) => `${k.repo} é mantido porque ${and(k.usedBy)} ainda ${pluralForm('pt-BR', k.usedBy.length, { one: 'usa', other: 'usam' })} este componente.`), 'Para usar novamente, será necessário baixar outra vez.' ].filter(Boolean).join(' '),
  removed: (bundleId: string) => `Excluído: ${bundleId}`,
  removedKept: (bundleId: string, repos: readonly string[]) => `Excluído: ${bundleId} · ${pluralForm('pt-BR', repos.length, { one: `${and(repos)} mantido porque outros pacotes de modelo ainda o usam`, other: `${and(repos)} mantidos porque outros pacotes de modelo ainda os usam` })}`,
};
