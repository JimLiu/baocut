import { defineMessages } from '@baocut/protocol';
import { zhHans } from './mcp-copy.zh-Hans.ts';
import { zhHant } from './mcp-copy.zh-Hant.ts';
import { ja } from './mcp-copy.ja.ts';
import { ko } from './mcp-copy.ko.ts';
import { es } from './mcp-copy.es.ts';
import { fr } from './mcp-copy.fr.ts';
import { de } from './mcp-copy.de.ts';
import { nl } from './mcp-copy.nl.ts';
import { ptBR } from './mcp-copy.pt-BR.ts';
import { it } from './mcp-copy.it.ts';
import { ru } from './mcp-copy.ru.ts';
import { pl } from './mcp-copy.pl.ts';
import { tr } from './mcp-copy.tr.ts';
import { vi } from './mcp-copy.vi.ts';

/** `baocut mcp install|status` 的文案（英文是键与类型的来源，译文在 `mcp-copy.<语言>.ts`）。 */
const en = {
  previousClientUnknown: "Couldn't identify the client used by the replaced entry, so no client was revoked: baocut mcp status lists existing clients; revoke unused ones with baocut services mcp revoke <clientId>",
  defaultProjectRegistered: (name: string, path: string) => `BaoCut had no projects: registered default project "${name}" (${path}) for external agents to create videos in`,

  /** `baocut mcp --help` 与 `baocut help mcp` 的正文。 */
  help: `Usage:
  baocut mcp install --agent <claude-code|codex|cursor|gemini> [--level ask|auto] [--name <client name>] [--yes]
                                   Connect an external agent to BaoCut's MCP service: start the service (and make it start with
                                   the Runtime), create a new client and token for the agent, and write the address and token into
                                   the agent's MCP config (entry name baocut); then restart the agent
                                   If BaoCut has no projects, register the CLI project in the default projects folder for external agents
    --level ask|auto               Access level: ask has you confirm each write and task in BaoCut (the service's default); auto
                                   runs them directly. If omitted, the current level is kept
    --name <client name>           Client name shown in BaoCut (defaults to the agent's name); it can be revoked on its own
    --yes                          If the agent's config already has a baocut entry, replace it and revoke the client the old entry
                                   used (recognized from the old token; if it can't be recognized, clients with the same name are
                                   listed for you to decide which to revoke). Without it, nothing is overwritten and no client is created
  Where the token goes: Claude Code keeps it in env (BAOCUT_MCP_TOKEN) of ~/.claude/settings.json, and the config only references it.
  Codex (~/.codex/config.toml), Cursor (~/.cursor/mcp.json) and Gemini CLI (~/.gemini/settings.json) have no place for environment
  variables, so the token is written into their config file in plain text: don't commit or share those files, and prefer the ask
  level; if a token leaks, revoke it with baocut services mcp revoke <clientId>.
  The service is available only while BaoCut's Runtime is running (open BaoCut, or run baocut runtime ensure).
  baocut mcp status                The MCP service's status, address, level and clients, and whether each agent's config has a
                                   baocut entry (tokens not included)`,
  entryExists: (file: string, entry: string) => `${file} already has a ${entry} entry; nothing was changed. Add --yes to replace it`,
  serviceNotAvailable: "This version of BaoCut doesn't provide the MCP service",
  serviceStartFailed: (reason: string | null) => `The MCP service didn't start: ${reason ?? 'unknown reason'}`,
  connected: (host: string, url: string) => `Connected ${host} to BaoCut's MCP service: ${url}`,
  configEnv: (configFile: string, envFile: string, envVar: string) =>
    `Config: ${configFile} (the token is in env.${envVar} of ${envFile}; the config only references it)`,
  configPlaintext: (configFile: string, clientId: string) =>
    `Config: ${configFile} (the token is written in this file in plain text: don't commit or share it; if it leaks, revoke it with baocut services mcp revoke ${clientId})`,
  clientLine: (name: string, clientId: string, level: string | null) => `Client: ${name} (${clientId})  Level: ${level ?? '—'}`,
  restartHint: (host: string) =>
    `Restart ${host} for this to take effect. The service runs with BaoCut's Runtime: if the Runtime isn't running, open BaoCut or run baocut runtime ensure first`,
  replacedRevoked: (name: string, clientId: string) => `Replaced the old entry and revoked the client it used: ${name} (${clientId})`,
  replacedRevokeFailed: (reason: string) => `Replaced the old entry, but couldn't revoke the client it used: ${reason}`,
  oldClientRemains: (ids: readonly string[]) =>
    `The old client is still there: ${ids.join(', ')}. If it's no longer used: baocut services mcp revoke <clientId>`,
  /** 同名的客户端还在；`unrecognized`：替换了条目，但认不出原来的条目用的是哪个客户端。 */
  sameNameClientsRemain: (ids: readonly string[], unrecognized: boolean) =>
    `${unrecognized ? "Couldn't tell which client the old entry used; clients" : 'Clients'} with the same name are still there: ${ids.join(', ')}. If they're no longer used: baocut services mcp revoke <clientId>`,
  hostsHeading: (entry: string) => `Whether each agent's config has a ${entry} entry:`,
  hostUnreadable: (problem: string) => `can't read (${problem})`,
  hostConfigured: 'yes',
  hostNotConfigured: 'no',
  noServiceStatus: "The Runtime didn't report the MCP service's status",
  levelChoice: (value: string) => `--level must be ask or auto: ${value}`,
};

export type McpMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
