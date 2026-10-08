import type { NodesMessages } from './nodes-copy.ts';

export const ptBR: NodesMessages = {
  nodesHelp: (port) => `Uso:
  baocut nodes                     Listar nós da rede local emparelhados (com verificação ao vivo de cada um)
  baocut nodes discover            Procurar nós da rede local que compartilham capacidades (macOS)
  baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]
                                   Emparelhar usando o código de Compartilhar este computador no outro
                                   computador; a porta padrão é ${port}
  baocut nodes remove <nodeId|alias>
                                   Excluir o nó e token lembrados neste computador`, noPairedNodes: 'Nenhum nó emparelhado. Emparelhe com baocut nodes pair <address[:port]> <pairing code>', noNodesDiscovered: 'Nenhum nó compartilhando capacidades encontrado (a busca funciona apenas no macOS; você também pode emparelhar informando um endereço)', pairUsage: 'Uso: baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]', removeUsage: 'Uso: baocut nodes remove <nodeId|alias>', paired: (description) => `Emparelhado: ${description}`, noSuchNode: (ref) => `Nenhum nó emparelhado: ${ref}`, removed: (alias, nodeId) => `Excluído: ${alias} (${nodeId})`, invalidPort: (port) => `Porta inválida: ${port}`,
  shareHelp: (port, capabilities) => `Uso:
  baocut share [status]            Estado de Compartilhar este computador: endereço, porta,
                                   ativação por capacidade, código de emparelhamento, computadores emparelhados
  baocut share start [options]     Iniciar compartilhamento e gerar um código de emparelhamento
    --port <port>                  Padrão ${port}
    --name <name>                  Nome mostrado aos outros, por padrão o nome do host
    --allow-any-source             Aceitar qualquer endereço de origem (apenas endereços da rede local por padrão)
  baocut share stop                Parar compartilhamento (cancela tarefas enviadas por outros)
  baocut share code                Invalidar o código de emparelhamento antigo e gerar outro
  baocut share revoke <clientId>   Revogar um computador emparelhado
  baocut share capability <capability> <on|off>
                                   Ativar ou desativar o compartilhamento de uma capacidade (${capabilities.join(', ')}), com efeito
                                   imediato: ao desativar, novas tarefas de outros são recusadas; tarefas já
                                   aceitas são executadas até o fim`,
  portRange: '--port deve ser um inteiro de 0 a 65535', shareRevokeUsage: 'Uso: baocut share revoke <clientId>', capabilityLabels: { transcribe: 'Transcrição' }, capabilityUsage: 'Uso: baocut share capability <capability> <on|off> (por exemplo baocut share capability transcribe off)', shareOff: 'Desativado', shareOn: 'Ativado', shareNotListening: (error) => `Ativado, mas sem escutar${error ? `: ${error}` : ''}`, shareState: (state) => `Compartilhar este computador: ${state}`, name: (name, nodeId) => `Nome: ${name}${nodeId ? ` (${nodeId})` : ''}`, port: (port, anySource) => `Porta: ${port}${anySource ? ' (qualquer endereço de origem)' : ''}`, addresses: (addresses) => `Endereços: ${addresses ?? '(nenhum endereço da rede local)'}`, capabilitiesHead: (empty) => `Capacidades: ${empty ? 'nenhuma' : ''}`, capabilityLine: (label, capability, enabled) => `  ${label} (${capability}): ${enabled ? 'ativado' : `desativado (ative com baocut share capability ${capability} on)`}`, pairingCode: (code, until) => `Código de emparelhamento: ${code} (válido até ${until})`, pairingLocked: (until) => `Emparelhamento bloqueado até ${until} (baocut share code desbloqueia agora)`, noPairingCode: 'Código de emparelhamento: nenhum (baocut share code gera um)', clientsHead: (empty) => `Computadores emparelhados: ${empty ? 'nenhum' : ''}`, clientLine: (name, clientId, pairedAt, lastSeenAt) => `  ${name}  ${clientId}  emparelhado ${pairedAt}${lastSeenAt ? `  visto pela última vez ${lastSeenAt}` : ''}`, remoteTasks: (running, queued) => `Tarefas remotas: ${running} em andamento, ${queued} na fila`, unreachable: 'Não foi possível conectar', versionMismatch: 'Versão do protocolo incompatível', unpaired: 'Emparelhamento inválido (emparelhe novamente)', available: 'Disponível', transcribeReady: (bundles, running, queued) => `Disponível · modelos ${bundles.length > 0 ? bundles.join(', ') : 'nenhum'} · ${running} em andamento, ${queued} na fila`, transcribeOff: 'Não disponível · o nó desativou o compartilhamento de transcrição (ative naquele computador)',
};
