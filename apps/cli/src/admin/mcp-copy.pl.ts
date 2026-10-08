import type { McpMessages } from './mcp-copy.ts';

export const pl: McpMessages = {
  previousClientUnknown: "Nie ustalono klienta zastąpionego wpisu, żadnego nie cofnięto: baocut mcp status pokazuje klientów; cofnij nieużywanych przez baocut services mcp revoke <clientId>",
  defaultProjectRegistered: (name, path) => `BaoCut nie miał projektów: zarejestrowano projekt domyślny „${name}" (${path}) dla tworzenia wideo przez agentów zewnętrznych`,

  help: "Użycie:\n  baocut mcp install --agent <claude-code|codex|cursor|gemini> [--level ask|auto] [--name <client name>] [--yes]\n                                   Połącz zewnętrznego agenta z MCP BaoCut: uruchom usługę z Runtime,\n                                   utwórz klienta i token agenta, zapisz adres i token w konfiguracji MCP\n                                   agenta (wpis baocut), potem uruchom agenta ponownie\n                                   Jeśli brak projektów, zarejestruj projekt CLI w domyślnym folderze projektów\n    --level ask|auto               Poziom dostępu: ask wymaga potwierdzenia każdego zapisu i zadania w BaoCut (domyślnie);\n                                   auto działa bezpośrednio. Bez parametru obecny poziom zachowany\n    --name <client name>           Nazwa klienta w BaoCut (domyślnie nazwa agenta); cofana osobno\n    --yes                          Zastąp istniejący wpis baocut i cofnij klienta (ustalany ze starego\n                                   tokenu; jeśli nieustalony, klienci o tej samej nazwie pokazani do wyboru).\n                                   Bez parametru nic nie jest nadpisywane i klient nie jest tworzony\n  Gdzie trafia token: Claude Code zapisuje w env (BAOCUT_MCP_TOKEN) pliku ~/.claude/settings.json, konfiguracja tylko odwołuje się do niego.\n  Codex (~/.codex/config.toml), Cursor (~/.cursor/mcp.json) i Gemini CLI (~/.gemini/settings.json) nie mają miejsca na zmienne\n  środowiskowe, token zapisany jawnym tekstem: nie publikuj ani nie udostępniaj plików, preferuj ask;\n  przy wycieku cofnij przez baocut services mcp revoke <clientId>.\n  Usługa dostępna tylko przy działaniu Runtime BaoCut (otwórz BaoCut lub uruchom baocut runtime ensure).\n  baocut mcp status                Stan usługi MCP, adres, poziom i klienci, obecność wpisu baocut\n                                   w konfiguracji każdego agenta (bez tokenów)",
  entryExists: (file, entry) => `${file} już ma wpis ${entry}; nic nie zmieniono. Dodaj --yes, aby zastąpić`,
  serviceNotAvailable: "Ta wersja BaoCut nie udostępnia usługi MCP",
  serviceStartFailed: (reason) => `Usługa MCP nie uruchomiła się: ${reason ?? 'unknown reason'}`,
  connected: (host, url) => `Połączono: ${host} do usługi MCP BaoCut: ${url}`,
  configEnv: (configFile, envFile, envVar) => `Konfiguracja: ${configFile} (token w env.${envVar} z ${envFile}; konfiguracja tylko odwołuje się do niego)`,
  configPlaintext: (configFile, clientId) => `Konfiguracja: ${configFile} (token w tym pliku jawnym tekstem: nie publikuj ani nie udostępniaj; przy wycieku cofnij przez baocut services mcp revoke ${clientId})`,
  clientLine: (name, clientId, level) => `Klient: ${name} (${clientId})  Poziom: ${level ?? '—'}`,
  restartHint: (host) => `Uruchom ponownie ${host}, aby zastosować. Usługa działa z Runtime BaoCut: jeśli nie działa, otwórz BaoCut lub uruchom baocut runtime ensure`,
  replacedRevoked: (name, clientId) => `Zastąpiono stary wpis i cofnięto klienta: ${name} (${clientId})`,
  replacedRevokeFailed: (reason) => `Zastąpiono stary wpis, ale nie cofnięto klienta: ${reason}`,
  oldClientRemains: (ids) => `Stary klient nadal istnieje: ${ids.join(", ")}. Jeśli nieużywany: baocut services mcp revoke <clientId>`,
  sameNameClientsRemain: (ids, unrecognized) => `${unrecognized ? "Nie ustalono klienta starego wpisu; klienci" : "Klienci"} o tej samej nazwie nadal istnieją: ${ids.join(", ")}. Jeśli nieużywani: baocut services mcp revoke <clientId>`,
  hostsHeading: (entry) => `Obecność wpisu w konfiguracji każdego agenta: ${entry}:`,
  hostUnreadable: (problem) => `nie można odczytać (${problem})`,
  hostConfigured: "tak",
  hostNotConfigured: "nie",
  noServiceStatus: "Runtime nie zgłosił stanu usługi MCP",
  levelChoice: (value) => `--level musi być ask lub auto: ${value}`,
};
