import type { NodesMessages } from './nodes-copy.ts';



export const de: NodesMessages = {
  nodesHelp: (port: number) => `Verwendung:
  baocut nodes                     Gekoppelte LAN-Knoten auflisten (jeweils mit aktueller Verbindungsprüfung)
  baocut nodes discover            LAN-Knoten suchen, die Funktionen freigeben (macOS)
  baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]
                                   Mit dem Kopplungscode aus „Diesen Computer freigeben“ auf dem anderen
                                   Computer koppeln; Standardport: ${port}
  baocut nodes remove <nodeId|alias>
                                   Auf diesem Computer gespeicherten Knoten und Token löschen`,
  noPairedNodes: "Keine gekoppelten Knoten. Koppeln Sie einen mit baocut nodes pair <address[:port]> <pairing code>",
  noNodesDiscovered: "Keine Knoten gefunden, die Funktionen freigeben (die Suche funktioniert nur unter macOS; alternativ können Sie eine Adresse zum Koppeln eingeben)",
  pairUsage: "Verwendung: baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]",
  removeUsage: "Verwendung: baocut nodes remove <nodeId|alias>",
  paired: (description: string) => `Gekoppelt: ${description}`,
  noSuchNode: (ref: string) => `Kein gekoppelter Knoten: ${ref}`,
  removed: (alias: string, nodeId: string) => `Gelöscht: ${alias} (${nodeId})`,
  invalidPort: (port: string | undefined) => `Ungültiger Port: ${port}`,
  shareHelp: (port: number, capabilities: readonly string[]) => `Verwendung:
  baocut share [status]            Status von „Diesen Computer freigeben“: Adresse, Port,
                                   Funktionsschalter, Kopplungscode, gekoppelte Computer
  baocut share start [options]     Freigabe starten und Kopplungscode erzeugen
    --port <port>                  Standard ${port}
    --name <name>                  Angezeigter Name, standardmäßig der Hostname
    --allow-any-source             Beliebige Quelladressen akzeptieren (standardmäßig nur LAN-Adressen)
  baocut share stop                Freigabe beenden (bricht von anderen eingereichte Aufgaben ab)
  baocut share code                Alten Kopplungscode ungültig machen und neuen erzeugen
  baocut share revoke <clientId>   Gekoppelten Computer widerrufen
  baocut share capability <capability> <on|off>
                                   Freigabe einer Funktion (${capabilities.join(", ")}) ein- oder ausschalten; sofort wirksam:
                                   Nach dem Ausschalten werden neue Aufgaben anderer abgelehnt;
                                   bereits akzeptierte Aufgaben werden abgeschlossen`,
  portRange: "--port muss eine ganze Zahl von 0 bis 65535 sein",
  shareRevokeUsage: "Verwendung: baocut share revoke <clientId>",
  capabilityLabels: { transcribe: "Transkription" } as Record<string, string>,
  capabilityUsage: "Verwendung: baocut share capability <capability> <on|off> (z. B. baocut share capability transcribe off)",
  shareOff: "Aus",
  shareOn: "An",
  shareNotListening: (error: string | null) => `Aktiviert, lauscht aber nicht${error ? `: ${error}` : ""}`,
  shareState: (state: string) => `Diesen Computer freigeben: ${state}`,
  name: (name: string, nodeId: string | null) => `Name: ${name}${nodeId ? ` (${nodeId})` : ""}`,
  port: (port: number, anySource: boolean) => `Port: ${port}${anySource ? " (beliebige Quelladresse)" : ""}`,
  addresses: (addresses: string | null) => `Adressen: ${addresses ?? "(keine lokale Netzwerkadresse)"}`,
  capabilitiesHead: (empty: boolean) => `Funktionen: ${empty ? "keine" : ""}`,
  capabilityLine: (label: string, capability: string, enabled: boolean) =>
    `  ${label} (${capability}): ${enabled ? "ein" : `aus (aktivieren mit baocut share capability ${capability} on)`}`,
  pairingCode: (code: string, until: string) => `Kopplungscode: ${code} (gültig bis ${until})`,
  pairingLocked: (until: string) => `Kopplung gesperrt bis ${until} (baocut share code entsperrt sie sofort)`,
  noPairingCode: "Kopplungscode: keiner (baocut share code erstellt einen)",
  clientsHead: (empty: boolean) => `Gekoppelte Computer: ${empty ? "keine" : ""}`,
  clientLine: (name: string, clientId: string, pairedAt: string, lastSeenAt: string | null) =>
    `  ${name}  ${clientId}  gekoppelt ${pairedAt}${lastSeenAt ? `  zuletzt gesehen ${lastSeenAt}` : ""}`,
  remoteTasks: (running: number, queued: number) => `Entfernte Aufgaben: ${running} laufen, ${queued} in Warteschlange`,
  unreachable: "Verbindung nicht möglich",
  versionMismatch: "Inkompatible Protokollversion",
  unpaired: "Kopplung nicht mehr gültig (erneut koppeln)",
  available: "Verfügbar",
  transcribeReady: (bundles: readonly string[], running: number, queued: number) =>
    `Verfügbar · Modelle ${bundles.length > 0 ? bundles.join(", ") : "keine"} · ${running} laufen, ${queued} in Warteschlange`,
  transcribeOff: "Nicht verfügbar · Der Knoten hat die Transkriptionsfreigabe deaktiviert (aktivieren Sie sie auf diesem Computer)",
};
