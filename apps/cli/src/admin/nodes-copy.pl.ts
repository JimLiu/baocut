import type { NodesMessages } from './nodes-copy.ts';

export const pl: NodesMessages = {
  nodesHelp: (port) => `Użycie:
  baocut nodes                     Lista sparowanych węzłów sieci lokalnej (z kontrolą każdego na żywo)
  baocut nodes discover            Znajdź węzły sieci lokalnej udostępniające możliwości (macOS)
  baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]
                                   Sparuj kodem z „Udostępnianie tego komputera”
                                   drugiego komputera; domyślny port ${port}
  baocut nodes remove <nodeId|alias>
                                   Usuń węzeł i token zapisane na tym komputerze`,
  noPairedNodes: "Brak sparowanych węzłów. Sparuj przez baocut nodes pair <address[:port]> <pairing code>",
  noNodesDiscovered: "Nie znaleziono węzłów udostępniających możliwości (wyszukiwanie tylko w macOS; można sparować przez adres)",
  pairUsage: "Użycie: baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]",
  removeUsage: "Użycie: baocut nodes remove <nodeId|alias>",
  paired: (description) => `Sparowano: ${description}`,
  noSuchNode: (ref) => `Brak sparowanego węzła: ${ref}`,
  removed: (alias, nodeId) => `Usunięto: ${alias} (${nodeId})`,
  invalidPort: (port) => `Nieprawidłowy port: ${port}`,
  shareHelp: (port, capabilities) => `Użycie:
  baocut share [status]            Stan udostępniania: adres, port, przełączniki możliwości,
                                   kod parowania, sparowane komputery
  baocut share start [options]     Rozpocznij udostępnianie i utwórz kod parowania
    --port <port>                  Domyślnie ${port}
    --name <name>                  Nazwa dla innych, domyślnie nazwa hosta
    --allow-any-source             Przyjmuj dowolny adres źródłowy (domyślnie tylko sieć lokalna)
  baocut share stop                Zatrzymaj udostępnianie (anuluje zadania innych)
  baocut share code                Unieważnij stary kod parowania i utwórz nowy
  baocut share revoke <clientId>   Cofnij sparowany komputer
  baocut share capability <capability> <on|off>
                                   Włącz lub wyłącz możliwość (${capabilities.join(', ')}) od razu:
                                   po wyłączeniu nowe zadania innych są odrzucane;
                                   przyjęte zadania wykonują się do końca`,
  portRange: "--port musi być liczbą całkowitą od 0 do 65535",
  shareRevokeUsage: "Użycie: baocut share revoke <clientId>",
  capabilityLabels: { transcribe: "Transkrypcja" },
  capabilityUsage: "Użycie: baocut share capability <capability> <on|off> (np. baocut share capability transcribe off)",
  shareOff: "Wyłączone",
  shareOn: "Włączone",
  shareNotListening: (error: string | null) => `Włączone, ale nie nasłuchuje${error ? `: ${error}` : ""}`,
  shareState: (state: string) => `Udostępnianie tego komputera: ${state}`,
  name: (name: string, nodeId: string | null) => `Nazwa: ${name}${nodeId ? ` (${nodeId})` : ""}`,
  port: (port: number, anySource: boolean) => `Port: ${port}${anySource ? " (dowolny adres źródłowy)" : ""}`,
  addresses: (addresses: string | null) => `Adresy: ${addresses ?? '(no local network address)'}`,
  capabilitiesHead: (empty: boolean) => `Możliwości: ${empty ? "brak" : ""}`,
  capabilityLine: (label: string, capability: string, enabled: boolean) => `  ${label} (${capability}): ${enabled ? "wł." : `wył. (włącz przez baocut share capability ${capability} on)`}`,
  pairingCode: (code: string, until: string) => `Kod parowania: ${code} (ważny do ${until})`,
  pairingLocked: (until: string) => `Parowanie zablokowane do ${until} (baocut share code odblokuje teraz)`,
  noPairingCode: "Kod parowania: brak (baocut share code tworzy)",
  clientsHead: (empty: boolean) => `Sparowane komputery: ${empty ? "brak" : ""}`,
  clientLine: (name: string, clientId: string, pairedAt: string, lastSeenAt: string | null) => `  ${name}  ${clientId}  sparowano ${pairedAt}${lastSeenAt ? `  ostatni kontakt ${lastSeenAt}` : ""}`,
  remoteTasks: (running: number, queued: number) => `Zadania zdalne: ${running} w trakcie, ${queued} w kolejce`,
  unreachable: "Nie można połączyć",
  versionMismatch: "Niezgodna wersja protokołu",
  unpaired: "Parowanie nieważne (sparuj ponownie)",
  available: "Dostępne",
  transcribeReady: (bundles: readonly string[], running: number, queued: number) => `Dostępne · modele ${bundles.length > 0 ? bundles.join(", ") : "brak"} · ${running} w trakcie, ${queued} w kolejce`,
  transcribeOff: "Niedostępne · węzeł wyłączył udostępnianie transkrypcji (włącz na tym komputerze)",
};
