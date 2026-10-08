import type { SpaceMessages } from './space-copy.ts';
import { pluralForm } from '@baocut/protocol';

const entriesLabel = (n: number) => pluralForm('pt-BR', n, { one: `${n} entrada`, other: `${n} entradas` });
const videosLabel = (n: number) => pluralForm('pt-BR', n, { one: `${n} vídeo`, other: `${n} vídeos` });
const daysLabel = (n: number) => pluralForm('pt-BR', n, { one: `${n} dia`, other: `${n} dias` });

export const ptBR: SpaceMessages = {
  help: `Uso:
  baocut space rescan              Verificar as pastas de origem novamente
  baocut space rebuild             Reconstruir o catálogo do Space pelas pastas e registros de origem;
                                   o índice de conteúdo relê todos os vídeos em segundo plano
  baocut space trash|restore <entry id>
                                   Mover para a Lixeira / restaurar da Lixeira (os arquivos não são alterados;
                                   para itens de vídeo, a pasta do vídeo entra / sai da Lixeira)
  baocut space purge <entry id>    Excluir permanentemente um item da Lixeira; não é excluído enquanto
                                   um vídeo ou tarefa ainda o usar, e as referências são listadas
  baocut space delete-video <entry id>
                                   Excluir um vídeo: move a pasta do vídeo para a Lixeira, restaurável durante
                                   o período de retenção; arquivos originais de mídias vinculadas não são alterados
  baocut space continue <entry id> [--conversation <session id>]
                                   Continuar uma sessão a partir de um item: uma referência (só identificadores e metadados) vai
                                   com a próxima mensagem; sem sessão, uma é escolhida conforme o local do item ou criada`,
  usage: ['Uso: baocut space rescan | rebuild | trash <entry id> | restore <entry id> | purge <entry id> | delete-video <entry id>', '       baocut space continue <entry id> [--conversation <session id>]'].join('\n'),
  entryUsage: (action: string) => `Uso: baocut space ${action} <entry id>`, continueUsage: 'Uso: baocut space continue <entry id> [--conversation <session id>]', flagNotAccepted: (action: string, key: string) => `baocut space ${action} não aceita --${key}`,
  rescanStarted: 'Nova verificação iniciada',
  rebuilt: (entries: number, pendingVideos: number) => `Catálogo reconstruído: ${entriesLabel(entries)}; o índice de conteúdo está relendo ${videosLabel(pendingVideos)} em segundo plano, então os resultados de pesquisa ficam incompletos até terminar`,
  purgeBlocked: (id: string) => `${id} ainda é usado por um vídeo ou tarefa; não foi excluído`, movedToTrash: (id: string, name: string) => `Movido para a Lixeira: ${id}  ${name}`, restoredFromTrash: (id: string, name: string) => `Restaurado da Lixeira: ${id}  ${name}`, purged: (id: string) => `Excluído permanentemente: ${id}`, notPurged: (id: string) => `Não foi excluído ${id}: ainda tem referências`,
  videoTrashed: (name: string, entryId: string, retentionDays: number | null) => `Vídeo “${name}” movido para a Lixeira: ${entryId} (restaure com baocut space restore ${entryId}${retentionDays === null ? '' : `; excluído permanentemente após ${daysLabel(retentionDays)}`})`,
  relatedKept: (n: number) => pluralForm('pt-BR', n, { one: `${n} item exportado ou gerado dele permanece onde está`, other: `${n} itens exportados ou gerados dele permanecem onde estão` }),
  continued: (created: boolean, id: string, cwd: string) => `${created ? 'Sessão criada' : 'Usando sessão'} ${id}  pasta de trabalho ${cwd}`,
  referenceNext: (name: string, id: string) => `Uma referência ao item “${name}” irá com a próxima mensagem: baocut chat "…" --conversation ${id}`,
};
