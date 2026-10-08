import path from 'node:path';
import { z } from 'zod';
import { ShareStore, type NodeStore } from '@baocut/nodes';
import { readJson, type RuntimeHome } from '@baocut/runtime-storage';
import { ServiceConfigStore } from './services/service-config-store.ts';
import { isFile, readLegacyKeychain, type LegacyObject, type LegacySource } from './legacy-upgrade-sources.ts';
import { readLegacyWindowsCredential } from './legacy-upgrade-windows.ts';

const port = z.number().int().min(0).max(65535);
const service = z.object({ on: z.boolean().optional(), autoStart: z.boolean().optional(), port: port.optional() });
const servicesSchema = z.object({
  mcp: service.optional(),
  web: service.optional(),
  remoteCompute: z.object({
    share: z.object({
      on: z.boolean().optional(),
      name: z.string().nullable().optional(),
      pairMode: z.string().nullable().optional(),
      concurrency: z.number().optional(),
      openai: z.boolean().optional(),
    }).optional(),
    useNodes: z.object({ nodes: z.array(z.string()) }).optional(),
  }).optional(),
});
const policySchema = z.object({
  access: z.enum(['read', 'ask', 'auto']),
  projects: z.array(z.string()).default([]),
  off: z.array(z.string()).default([]),
  requireToken: z.boolean().optional(),
});

/** Before services are opened: only absent v3 service entries / share files are adopted. */
export async function importLegacyServices(home: RuntimeHome, source: LegacySource): Promise<string[]> {
  const unsupported: string[] = [];
  const raw = await readJson<unknown>(path.join(source.root, 'runtime', 'services.json'));
  const legacy = raw === null ? {} : servicesSchema.parse(raw);
  const policyRaw = await readJson<unknown>(path.join(source.root, 'integrations-policy.json'));
  const policy = policyRaw === null ? null : policySchema.parse(policyRaw);
  const current = await readJson<{ services: LegacyObject }>(home.servicesFile);
  const store = new ServiceConfigStore(home.servicesFile);
  await store.load();
  for (const id of ['mcp', 'web'] as const) {
    if (current?.services && Object.hasOwn(current.services, id)) continue;
    const old = legacy[id];
    // Early desktop versions kept Web preferences in app-v2-settings.json.
    const autoStart = old?.autoStart ?? (id === 'web' ? source.preferences.serveEnabled : undefined);
    const preferredPort = old?.port ?? (id === 'web' ? source.preferences.servePort : undefined);
    if (!old && autoStart === undefined && preferredPort === undefined && !(id === 'mcp' && policy)) continue;
    const parsedPort = port.safeParse(preferredPort);
    await store.update(id, {
      ...(typeof autoStart === 'boolean' ? { autostart: autoStart } : {}),
      ...(parsedPort.success ? { port: parsedPort.data } : {}),
      ...(id === 'mcp' && policy
        ? {
            policy: {
              level: policy.off.length ? 'read' : policy.access,
              // Old project paths cannot be used as v3 video IDs. Keep narrowed scopes closed.
              videos: policy.projects.length || policy.off.length ? { ids: [] } : 'all',
            },
          }
        : {}),
    });
    if (id === 'mcp') {
      unsupported.push('service:mcp-client-reauthorization');
      if (policy?.projects.length) unsupported.push('service:mcp-project-scope');
      if (policy?.off.length) unsupported.push('service:mcp-disabled-tools');
    }
    if (id === 'web') unsupported.push('service:web-session-reauthorization');
  }
  if (!(await isFile(home.nodeShareFile))) {
    const share = legacy.remoteCompute?.share;
    const c = source.config;
    if (share || Object.keys(c).some((key) => key.startsWith('worker.'))) {
      const identity = await readJson<LegacyObject>(path.join(source.root, 'worker', 'identity.json'));
      const worker = await readJson<LegacyObject>(path.join(source.root, 'worker', 'worker.json'));
      const clients = await readJson<LegacyObject>(path.join(source.root, 'worker', 'clients.json'));
      let preferredPort = 0;
      try {
        preferredPort = Number(new URL(worker?.url).port);
      } catch {
        /* No previous listener. */
      }
      const name = c['worker.name'] ?? share?.name;
      await new ShareStore(home.nodeShareFile).save({
        formatVersion: 1,
        enabled: share?.on === true,
        nodeId: typeof identity?.nodeId === 'string' ? identity.nodeId : null,
        name: typeof name === 'string' ? name : null,
        port: port.safeParse(preferredPort).success ? preferredPort : 0,
        allowAnySource: false,
        capabilities: { transcribe: { enabled: c['worker.tasks.asr'] !== false } },
        clients: [],
      });
      if (clients?.clients?.length) unsupported.push('service:node-client-repairing');
      for (const key of Object.keys(c).filter((key) => key.startsWith('worker.') && !['worker.name', 'worker.tasks.asr'].includes(key))) {
        unsupported.push(`setting:${key}`);
      }
      if (share?.pairMode) unsupported.push('service:node-pair-mode');
      if (share?.concurrency !== undefined) unsupported.push('service:node-concurrency');
      if (share?.openai === false) unsupported.push('service:node-openai');
    }
  }
  if (legacy.remoteCompute?.useNodes?.nodes.length) unsupported.push('service:node-selection');
  if (source.config['remote.default']) unsupported.push('setting:remote.default');
  return unsupported;
}

/** Background credential reads; no probing or pairing requests are sent to old nodes. */
export async function importLegacyNodes(source: LegacySource, store: NodeStore | undefined, options: {
  platform?: string;
  allowKeychain?: boolean;
  keychain?: typeof readLegacyKeychain;
  windowsCredential?: typeof readLegacyWindowsCredential;
  completed?: string[];
} = {}): Promise<{ done: string[]; pending: string[]; unsupported: string[] }> {
  const done: string[] = [];
  const pending: string[] = [];
  const unsupported: string[] = [];
  const aliases = new Set(Object.keys(source.config).flatMap((key) => /^remote\.nodes\.([^.]+)\./.exec(key)?.[1] ?? []));
  if (!aliases.size) return { done, pending, unsupported };
  const secrets = (await readJson<LegacyObject>(path.join(source.root, 'secrets.json'))) ?? {};
  const debug = (await readJson<LegacyObject>(path.join(source.root, 'secrets.debug.json'))) ?? {};
  const masks = (await readJson<LegacyObject>(path.join(source.root, 'key-masks.json'))) ?? {};
  let vault: LegacyObject | undefined;
  for (const alias of aliases) {
    const get = (field: string) => source.config[`remote.nodes.${alias}.${field}`];
    const nodeId = get('nodeId');
    if (typeof nodeId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(nodeId)) {
      unsupported.push(`node:${alias}`);
      continue;
    }
    if (options.completed?.includes(nodeId)) continue;
    if (store?.get(nodeId)) {
      done.push(nodeId);
      continue;
    }
    try {
      if (!store) throw new Error('node-store-unavailable');
      const url = new URL(get('url'));
      if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
        throw new Error('unsupported-node-url');
      const provider = `remote-${nodeId.toLowerCase()}`;
      let secret = secrets[provider] ?? (masks.keys?.[provider] ? undefined : debug[provider]);
      if (!secret && options.allowKeychain !== false && (options.platform ?? process.platform) === 'darwin') {
        vault ??= (await (options.keychain ?? readLegacyKeychain)('BaoCut', '__provider-vault-v1'))?.providers ?? {};
        secret = vault?.[provider] ??
          (await (options.keychain ?? readLegacyKeychain)('BaoCut', provider)) ??
          (await (options.keychain ?? readLegacyKeychain)('bcut', provider));
      } else if (!secret && options.allowKeychain !== false && (options.platform ?? process.platform) === 'win32') {
        secret = await (options.windowsCredential ?? readLegacyWindowsCredential)(provider);
      }
      const token = secret?.fields?.apiKey ?? secret?.fields?.token;
      if (typeof token !== 'string' || !token) throw new Error('node-token-unavailable');
      await store.upsert({
        nodeId,
        name: typeof get('name') === 'string' ? get('name') : alias,
        host: url.hostname.replace(/^\[|\]$/g, ''),
        port: Number(url.port || 80),
        token,
        ...(store.list().some((node) => node.alias === alias || node.nodeId === alias) ? {} : { alias }),
        ...(typeof get('addedAt') === 'string' ? { pairedAt: get('addedAt') } : {}),
      });
      done.push(nodeId);
    } catch {
      pending.push(`node:${alias}`);
    }
  }
  return { done, pending, unsupported };
}
