import { defineMessages } from '@baocut/protocol';
import { zhHans } from './nodes-copy.zh-Hans.ts';
import { zhHant } from './nodes-copy.zh-Hant.ts';
import { ja } from './nodes-copy.ja.ts';
import { ko } from './nodes-copy.ko.ts';
import { es } from './nodes-copy.es.ts';
import { fr } from './nodes-copy.fr.ts';
import { de } from './nodes-copy.de.ts';
import { nl } from './nodes-copy.nl.ts';
import { ptBR } from './nodes-copy.pt-BR.ts';
import { it } from './nodes-copy.it.ts';
import { ru } from './nodes-copy.ru.ts';
import { pl } from './nodes-copy.pl.ts';
import { tr } from './nodes-copy.tr.ts';
import { vi } from './nodes-copy.vi.ts';

/** `baocut nodes` 与 `baocut share` 的文案（英文是键与类型的来源，译文在 `nodes-copy.<语言>.ts`）。 */
const en = {
  nodesHelp: (port: number) => `Usage:
  baocut nodes                     List paired LAN nodes (each with a live probe)
  baocut nodes discover            Browse LAN nodes that share capabilities (macOS)
  baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]
                                   Pair using the pairing code from the other computer's
                                   Share This Computer; port defaults to ${port}
  baocut nodes remove <nodeId|alias>
                                   Delete the node and token remembered on this computer`,
  noPairedNodes: 'No paired nodes. Pair one with baocut nodes pair <address[:port]> <pairing code>',
  noNodesDiscovered: 'No nodes sharing capabilities were found (browsing works only on macOS; you can also pair by entering an address)',
  pairUsage: 'Usage: baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]',
  removeUsage: 'Usage: baocut nodes remove <nodeId|alias>',
  paired: (description: string) => `Paired: ${description}`,
  noSuchNode: (ref: string) => `No paired node: ${ref}`,
  removed: (alias: string, nodeId: string) => `Deleted ${alias} (${nodeId})`,
  invalidPort: (port: string | undefined) => `Invalid port: ${port}`,
  shareHelp: (port: number, capabilities: readonly string[]) => `Usage:
  baocut share [status]            Share This Computer status: address, port,
                                   per-capability switches, pairing code, paired computers
  baocut share start [options]     Start sharing and generate a pairing code
    --port <port>                  Default ${port}
    --name <name>                  The name others see, defaults to the host name
    --allow-any-source             Accept any source address (only LAN addresses by default)
  baocut share stop                Stop sharing (cancels tasks others submitted)
  baocut share code                Invalidate the old pairing code and generate a new one
  baocut share revoke <clientId>   Revoke a paired computer
  baocut share capability <capability> <on|off>
                                   Turn sharing of a capability (${capabilities.join(', ')}) on or off, effective
                                   immediately: once it's off, new tasks from others are refused; tasks already
                                   accepted run to completion`,
  portRange: '--port must be an integer from 0 to 65535',
  shareRevokeUsage: 'Usage: baocut share revoke <clientId>',
  capabilityLabels: { transcribe: 'Transcription' } as Record<string, string>,
  capabilityUsage: 'Usage: baocut share capability <capability> <on|off> (e.g. baocut share capability transcribe off)',
  shareOff: 'Off',
  shareOn: 'On',
  shareNotListening: (error: string | null) => `On but not listening${error ? `: ${error}` : ''}`,
  shareState: (state: string) => `Share This Computer: ${state}`,
  name: (name: string, nodeId: string | null) => `Name: ${name}${nodeId ? ` (${nodeId})` : ''}`,
  port: (port: number, anySource: boolean) => `Port: ${port}${anySource ? ' (any source address)' : ''}`,
  addresses: (addresses: string | null) => `Addresses: ${addresses ?? '(no local network address)'}`,
  capabilitiesHead: (empty: boolean) => `Capabilities: ${empty ? 'none' : ''}`,
  capabilityLine: (label: string, capability: string, enabled: boolean) =>
    `  ${label} (${capability}): ${enabled ? 'on' : `off (turn on with baocut share capability ${capability} on)`}`,
  pairingCode: (code: string, until: string) => `Pairing code: ${code} (valid until ${until})`,
  pairingLocked: (until: string) => `Pairing is locked until ${until} (baocut share code unlocks it now)`,
  noPairingCode: 'Pairing code: none (baocut share code makes one)',
  clientsHead: (empty: boolean) => `Paired computers: ${empty ? 'none' : ''}`,
  clientLine: (name: string, clientId: string, pairedAt: string, lastSeenAt: string | null) =>
    `  ${name}  ${clientId}  paired ${pairedAt}${lastSeenAt ? `  last seen ${lastSeenAt}` : ''}`,
  remoteTasks: (running: number, queued: number) => `Remote tasks: ${running} running, ${queued} queued`,
  unreachable: "Can't connect",
  versionMismatch: 'Incompatible protocol version',
  unpaired: 'Pairing no longer valid (pair again)',
  available: 'Available',
  transcribeReady: (bundles: readonly string[], running: number, queued: number) =>
    `Available · models ${bundles.length > 0 ? bundles.join(', ') : 'none'} · ${running} running, ${queued} queued`,
  transcribeOff: 'Unavailable · the node turned off transcription sharing (turn it on on that computer)',
};

export type NodesMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
