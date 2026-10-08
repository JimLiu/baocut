import { defineNoun } from './context.ts';
import { M } from './services-copy.ts';
import {
  formatAliases,
  formatClients,
  formatConnectionInfo,
  formatNewClient,
  formatServices,
  formatWebSessions,
  parseServicesArgs,
} from './services-output.ts';

/** `baocut services`：对外服务的状态、开关与配置（架构设计 §4.8）。令牌只在创建客户端时打印一次。 */
export const services = defineNoun({
  name: 'services',
  get usage() {
    return M.help;
  },
  options: {
    port: { type: 'string' },
    level: { type: 'string' },
    videos: { type: 'string' },
    autostart: { type: 'string' },
    'route-online': { type: 'string' },
    'route-nodes': { type: 'string' },
    'route-agent': { type: 'string' },
    'max-concurrent': { type: 'string' },
    'read-only': { type: 'string' },
    methods: { type: 'string' },
  },
  async run(ctx) {
    const { client, values } = ctx;
    const command = ctx.parse(() =>
      parseServicesArgs(ctx.args, {
        port: values.port,
        level: values.level,
        videos: values.videos,
        autostart: values.autostart,
        routeOnline: values['route-online'],
        routeNodes: values['route-nodes'],
        routeAgent: values['route-agent'],
        maxConcurrent: values['max-concurrent'],
        readOnly: values['read-only'],
        methods: values.methods,
      }),
    );
    switch (command.kind) {
      case 'list': {
        const result = await client.request('services.list', {});
        return ctx.done(result, formatServices(result.services));
      }
      case 'start':
      case 'stop': {
        const result = await client.request(command.kind === 'start' ? 'services.start' : 'services.stop', {
          serviceId: command.serviceId,
        });
        if (result.service.state === 'error') {
          for (const line of formatServices([result.service])) ctx.log(line);
          return ctx.fail({
            code: 'SERVICE_ERROR',
            message: M.serviceError(command.serviceId, result.service.error ?? result.service.state),
            service: result.service,
          });
        }
        return ctx.done(result, formatServices([result.service]));
      }
      case 'configure': {
        const result = await client.request('services.configure', command.params);
        return ctx.done(result, formatServices([result.service]));
      }
      case 'add-client': {
        const mcp = command.service === 'mcp';
        const created = await client.request(mcp ? 'services.mcp.createClient' : 'services.modelApi.createClient', { name: command.name });
        const info = mcp
          ? await client.request('services.mcp.connectionInfo', { clientId: created.client.clientId })
          : await client.request('services.modelApi.connectionInfo', { clientId: created.client.clientId });
        return ctx.done({ ...created, connection: info }, formatNewClient(created.client, created.token, info));
      }
      case 'clients': {
        const result = await client.request(command.service === 'mcp' ? 'services.mcp.listClients' : 'services.modelApi.listClients', {});
        return ctx.done(result, formatClients(result.clients, command.service));
      }
      case 'revoke': {
        const result = await client.request(command.service === 'mcp' ? 'services.mcp.revokeClient' : 'services.modelApi.revokeClient', {
          clientId: command.clientId,
        });
        return ctx.done(result, [M.clientRevoked(command.clientId), ...formatClients(result.clients, command.service)]);
      }
      case 'connection': {
        const params = command.clientId ? { clientId: command.clientId } : {};
        const info =
          command.service === 'mcp'
            ? await client.request('services.mcp.connectionInfo', params)
            : await client.request('services.modelApi.connectionInfo', params);
        return ctx.done(info, formatConnectionInfo(info));
      }
      case 'aliases': {
        const { services } = await client.request('services.list', {});
        const aliases = services.find((s) => s.serviceId === 'model-api')?.modelApi?.aliases ?? [];
        return ctx.done({ aliases }, formatAliases(aliases));
      }
      case 'alias': {
        const { alias, capability, providerId, modelId } = command.alias;
        const result = await client.request('services.modelApi.setAlias', {
          alias,
          capability,
          providerId,
          ...(modelId ? { modelId } : {}),
        });
        return ctx.done(result, formatAliases(result.aliases));
      }
      case 'unalias': {
        const result = await client.request('services.modelApi.removeAlias', { alias: command.alias });
        return ctx.done(result, formatAliases(result.aliases));
      }
      case 'web-sessions': {
        const result = await client.request('services.web.listSessions', {});
        return ctx.done(result, formatWebSessions(result.sessions));
      }
      case 'web-revoke': {
        const result = await client.request('services.web.revokeSession', { sessionId: command.sessionId });
        return ctx.done(result, [M.webSessionRevoked(command.sessionId), ...formatWebSessions(result.sessions)]);
      }
    }
  },
});
