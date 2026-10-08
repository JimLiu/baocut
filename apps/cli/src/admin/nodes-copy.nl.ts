import type { NodesMessages } from './nodes-copy.ts';
export const nl: NodesMessages = {
 nodesHelp: (port) => `Gebruik:
  baocut nodes                     Gekoppelde LAN-knooppunten tonen (elk met een actuele controle)
  baocut nodes discover            LAN-knooppunten zoeken die functies delen (macOS)
  baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]
                                   Koppelen met de koppelcode uit Deze computer delen op de andere
                                   computer; standaardpoort ${port}
  baocut nodes remove <nodeId|alias>
                                   Het knooppunt en token op deze computer verwijderen`,
 noPairedNodes: 'Geen gekoppelde knooppunten. Koppel er een met baocut nodes pair <address[:port]> <pairing code>', noNodesDiscovered: 'Geen knooppunten gevonden die functies delen (zoeken werkt alleen op macOS; je kunt ook koppelen door een adres in te voeren)', pairUsage: 'Gebruik: baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]', removeUsage: 'Gebruik: baocut nodes remove <nodeId|alias>', paired: (description) => `Gekoppeld: ${description}`, noSuchNode: (ref) => `Geen gekoppeld knooppunt: ${ref}`, removed: (alias, nodeId) => `${alias} verwijderd (${nodeId})`, invalidPort: (port) => `Ongeldige poort: ${port}`,
 shareHelp: (port, capabilities) => `Gebruik:
  baocut share [status]            Status van Deze computer delen: adres, poort,
                                   functieschakelaars, koppelcode en gekoppelde computers
  baocut share start [options]     Delen starten en een koppelcode maken
    --port <port>                  Standaard ${port}
    --name <name>                  De naam die anderen zien; standaard de hostnaam
    --allow-any-source             Elk bronadres accepteren (standaard alleen LAN-adressen)
  baocut share stop                Delen stoppen (annuleert door anderen ingediende taken)
  baocut share code                De oude koppelcode ongeldig maken en een nieuwe maken
  baocut share revoke <clientId>   Een gekoppelde computer intrekken
  baocut share capability <capability> <on|off>
                                   Het delen van een functie (${capabilities.join(', ')}) in- of uitschakelen, met direct
                                   effect: na uitschakelen worden nieuwe taken van anderen geweigerd; reeds
                                   geaccepteerde taken worden afgemaakt`,
 portRange: '--port moet een geheel getal van 0 tot 65535 zijn', shareRevokeUsage: 'Gebruik: baocut share revoke <clientId>', capabilityLabels: { transcribe: 'Transcriptie' }, capabilityUsage: 'Gebruik: baocut share capability <capability> <on|off> (bijv. baocut share capability transcribe off)', shareOff: 'Uit', shareOn: 'Aan', shareNotListening: (error) => `Aan maar luistert niet${error ? `: ${error}` : ''}`, shareState: (state) => `Deze computer delen: ${state}`, name: (name, nodeId) => `Naam: ${name}${nodeId ? ` (${nodeId})` : ''}`, port: (port, anySource) => `Poort: ${port}${anySource ? ' (elk bronadres)' : ''}`, addresses: (addresses) => `Adressen: ${addresses ?? '(geen lokaal netwerkadres)'}`, capabilitiesHead: (empty) => `Functies: ${empty ? 'geen' : ''}`, capabilityLine: (label, capability, enabled) => `  ${label} (${capability}): ${enabled ? 'aan' : `uit (inschakelen met baocut share capability ${capability} on)`}`, pairingCode: (code, until) => `Koppelcode: ${code} (geldig tot ${until})`, pairingLocked: (until) => `Koppelen is geblokkeerd tot ${until} (baocut share code heft dit nu op)`, noPairingCode: 'Koppelcode: geen (baocut share code maakt er een)', clientsHead: (empty) => `Gekoppelde computers: ${empty ? 'geen' : ''}`, clientLine: (name, clientId, pairedAt, lastSeenAt) => `  ${name}  ${clientId}  gekoppeld ${pairedAt}${lastSeenAt ? `  laatst gezien ${lastSeenAt}` : ''}`, remoteTasks: (running, queued) => `Externe taken: ${running} bezig, ${queued} in wachtrij`, unreachable: 'Kan geen verbinding maken', versionMismatch: 'Incompatibele protocolversie', unpaired: 'Koppeling niet meer geldig (opnieuw koppelen)', available: 'Beschikbaar', transcribeReady: (bundles, running, queued) => `Beschikbaar · modellen ${bundles.length > 0 ? bundles.join(', ') : 'geen'} · ${running} bezig, ${queued} in wachtrij`, transcribeOff: 'Niet beschikbaar · het knooppunt heeft transcriptiedeling uitgeschakeld (schakel dit daar in)',
};
