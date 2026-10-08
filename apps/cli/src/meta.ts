import { localizeToolStatus, MCP_INTERFACE_VERSION, RUNTIME_VERSION, type ExternalToolStatus } from '@baocut/protocol';
import { M } from './cli-copy.ts';
import { CliError, type ExitCode, type Output } from './envelope.ts';
import { findRuntime, openClient, type Session } from './runtime/connection.ts';

/**
 * 元命令 `version` 与 `status`（Agent 面设计 §4.5）。`version` 是裸 JSON，不拉起 Runtime；`status` 走信封，按 §5.6 找不到时
 * 拉起，报告此刻能做什么，不可用的带补救命令。
 */

/** `baocut version`：CLI、Runtime（在跑时）与接口版本。 */
export async function version(output: Output, home: string): Promise<ExitCode> {
  const cli = { version: RUNTIME_VERSION, interfaceVersion: MCP_INTERFACE_VERSION };
  const discovery = findRuntime(home);
  if (!discovery) return output.raw({ cli, runtime: null });
  try {
    const { client, info } = await openClient(discovery);
    try {
      const catalog = await client.request('catalog.list', {});
      return output.raw({
        cli,
        runtime: {
          version: info.runtimeVersion,
          protocolVersion: info.protocolVersion,
          interfaceVersion: catalog.interfaceVersion,
          pid: info.pid,
        },
        compatible: catalog.interfaceVersion === MCP_INTERFACE_VERSION,
      });
    } finally {
      client.close();
    }
  } catch (error) {
    // 连不上（或协议不同）也照样报 CLI 的版本：版本命令本来就是排查这个用的。
    return output.raw({ cli, runtime: { pid: discovery.pid, error: error instanceof CliError ? error.body() : String(error) } });
  }
}

/**
 * `baocut status`：Runtime、每种能力的默认与可用性、本地模型包、外部工具。默认只给摘要（每种能力此刻用哪个、哪些能用；
 * 模型包的状态）；`--full` 时能力与模型包是 `models_capabilities`、`models_list` 的完整结果（各 Provider 的模型、参数与限制）。
 */
export async function status(output: Output, session: Session, cwd: string, options: { full: boolean }): Promise<ExitCode> {
  const { client, info, catalog, started } = session;
  const call = async (name: string) => {
    const result = await client.request('catalog.call', { name, args: {}, cwd });
    return result.ok ? result.result : { error: result.error };
  };
  const [capabilities, localModels, tools] = await Promise.all([
    call('models_capabilities'),
    call('models_list'),
    client.request('externalTools.list', {}).then(
      (result) => result.tools.map(externalTool),
      (error: unknown) => ({ error: String(error) }),
    ),
  ]);
  return output.success(
    {
      runtime: {
        running: true,
        started,
        version: info.runtimeVersion,
        interfaceVersion: catalog.interfaceVersion,
        pid: info.pid,
        home: info.home,
        launchedBy: info.launchedBy,
      },
      capabilities: options.full ? capabilities : capabilitySummary(capabilities),
      localModels: options.full ? localModels : bundleSummary(localModels),
      externalTools: tools,
    },
    options.full ? null : M.statusFullNext,
  );
}

/** 能力的摘要：此刻用哪个、哪些服务能用、下一步；不带各服务的模型清单与参数。取不到时原样（`{ error }`）。 */
function capabilitySummary(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.capabilities)) return value;
  return {
    capabilities: value.capabilities.filter(isRecord).map((c) => ({
      capability: c.capability,
      default: c.default,
      effective: c.effective,
      usableProviders: c.usableProviders,
      providerCount: Array.isArray(c.providers) ? c.providers.length : 0,
      next: c.next,
    })),
  };
}

/** 本地模型包的摘要：每个包的能力与状态（不可用时的原因）。 */
function bundleSummary(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.bundles)) return value;
  return {
    bundles: value.bundles.filter(isRecord).map((b) => ({
      bundleId: b.bundleId,
      capability: b.capability,
      state: b.state,
      ...(b.reason !== undefined ? { reason: b.reason } : {}),
    })),
    next: value.next,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 外部工具的摘要与补救命令（管理桶的 `external-tools`）。 */
function externalTool(probed: ExternalToolStatus) {
  const tool = localizeToolStatus(probed);
  const remedy: string[] = [];
  if (tool.state === 'missing' && tool.installable) remedy.push(`baocut external-tools install ${tool.name}`);
  if (tool.state === 'outdated' && tool.installable) remedy.push(`baocut external-tools update ${tool.name}`);
  if (tool.state !== 'installed' && !tool.installable) remedy.push(`baocut external-tools path ${tool.name} <file>`);
  if (tool.consentRequired && tool.consent?.state !== 'granted') remedy.push(`baocut external-tools consent ${tool.name}`);
  return {
    name: tool.name,
    purpose: tool.purpose,
    state: tool.state,
    available: tool.state === 'installed' && (!tool.consentRequired || tool.consent?.state === 'granted'),
    version: tool.version,
    ...(tool.reason ? { reason: tool.reason } : {}),
    consentRequired: tool.consentRequired,
    consent: tool.consent?.state ?? null,
    ...(remedy.length ? { remedy } : {}),
  };
}
