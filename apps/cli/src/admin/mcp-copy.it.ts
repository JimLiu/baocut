import type { McpMessages } from './mcp-copy.ts';

export const it: McpMessages = {
  previousClientUnknown: 'Impossibile identificare il client della voce sostituita, quindi nessun client è stato revocato: baocut mcp status elenca quelli esistenti; revoca quelli inutilizzati con baocut services mcp revoke <clientId>', defaultProjectRegistered: (name: string, path: string) => `BaoCut non aveva progetti: registrato il progetto predefinito «${name}» (${path}) in cui gli agenti esterni possono creare video`,
  help: `Uso:
  baocut mcp install --agent <claude-code|codex|cursor|gemini> [--level ask|auto] [--name <client name>] [--yes]
                                   Connette un agente esterno al servizio MCP di BaoCut: avvia il servizio (anche insieme
                                   al Runtime), crea un nuovo client e token per l’agente e scrive indirizzo e token nella
                                   configurazione MCP dell’agente (voce baocut); poi riavvia l’agente
                                   Se BaoCut non ha progetti, registra il progetto CLI nella cartella dei progetti predefinita per gli agenti esterni
    --level ask|auto               Livello di accesso: ask richiede la conferma di ogni scrittura e attività in BaoCut (predefinito del servizio);
                                   auto le esegue direttamente. Se omesso, mantiene il livello attuale
    --name <client name>           Nome del client in BaoCut (predefinito: nome dell’agente); può essere revocato separatamente
    --yes                          Se la configurazione dell’agente ha già una voce baocut, la sostituisce e revoca il client usato
                                   dalla vecchia voce (identificato dal vecchio token; se non è riconoscibile, elenca i client con
                                   lo stesso nome per scegliere quale revocare). Senza questo flag, non sovrascrive e non crea client
  Posizione del token: Claude Code lo mantiene in env (BAOCUT_MCP_TOKEN) di ~/.claude/settings.json; la configurazione lo referenzia soltanto.
  Codex (~/.codex/config.toml), Cursor (~/.cursor/mcp.json) e Gemini CLI (~/.gemini/settings.json) non hanno un posto per le variabili
  d’ambiente, quindi il token viene scritto in chiaro nella configurazione: non includere questi file nei commit né condividerli e preferisci
  il livello ask; se il token viene divulgato, revocalo con baocut services mcp revoke <clientId>.
  Il servizio è disponibile solo mentre il Runtime di BaoCut è in esecuzione (apri BaoCut o esegui baocut runtime ensure).
  baocut mcp status                Stato, indirizzo, livello e client del servizio MCP e presenza di una voce baocut
                                   nella configurazione di ogni agente (senza token)`,
  entryExists: (file: string, entry: string) => `${file} ha già una voce ${entry}; nulla è cambiato. Aggiungi --yes per sostituirla`, serviceNotAvailable: 'Questa versione di BaoCut non offre il servizio MCP', serviceStartFailed: (reason: string | null) => `Il servizio MCP non è partito: ${reason ?? 'motivo sconosciuto'}`, connected: (host: string, url: string) => `${host} connesso al servizio MCP di BaoCut: ${url}`,
  configEnv: (configFile: string, envFile: string, envVar: string) => `Configurazione: ${configFile} (il token è in env.${envVar} di ${envFile}; la configurazione lo referenzia soltanto)`, configPlaintext: (configFile: string, clientId: string) => `Configurazione: ${configFile} (il token è scritto in chiaro in questo file: non includerlo nei commit né condividerlo; se divulgato, revocalo con baocut services mcp revoke ${clientId})`, clientLine: (name: string, clientId: string, level: string | null) => `Client: ${name} (${clientId})  Livello: ${level ?? '—'}`,
  restartHint: (host: string) => `Riavvia ${host} per applicare. Il servizio funziona con il Runtime di BaoCut: se non è in esecuzione, apri BaoCut o esegui prima baocut runtime ensure`, replacedRevoked: (name: string, clientId: string) => `Vecchia voce sostituita e client usato revocato: ${name} (${clientId})`, replacedRevokeFailed: (reason: string) => `Vecchia voce sostituita, ma impossibile revocare il client usato: ${reason}`, oldClientRemains: (ids: readonly string[]) => `Il vecchio client è ancora presente: ${ids.join(', ')}. Se non è più usato: baocut services mcp revoke <clientId>`, sameNameClientsRemain: (ids: readonly string[], unrecognized: boolean) => `${unrecognized ? 'Impossibile identificare il client della vecchia voce; i client' : 'I client'} con lo stesso nome sono ancora presenti: ${ids.join(', ')}. Se non sono più usati: baocut services mcp revoke <clientId>`,
  hostsHeading: (entry: string) => `Presenza di una voce ${entry} nella configurazione di ogni agente:`, hostUnreadable: (problem: string) => `impossibile leggere (${problem})`, hostConfigured: 'sì', hostNotConfigured: 'no', noServiceStatus: 'Il Runtime non ha riportato lo stato del servizio MCP', levelChoice: (value: string) => `--level deve essere ask o auto: ${value}`,
};
