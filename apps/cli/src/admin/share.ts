import { NODE_DEFAULT_PORT, NODE_SHAREABLE_CAPABILITIES, type ShareStatus } from '@baocut/protocol';
import { defineNoun } from './context.ts';
import { M } from './nodes-copy.ts';
import { formatShareStatus, parseCapabilitySwitch } from './nodes-output.ts';

/** `baocut share`：「共享这台电脑」——把本机的能力共享给局域网里配对过的电脑（节点协议规范 §10）。 */
export const share = defineNoun({
  name: 'share',
  get usage() {
    return M.shareHelp(NODE_DEFAULT_PORT, NODE_SHAREABLE_CAPABILITIES);
  },
  options: { port: { type: 'string' }, name: { type: 'string' }, 'allow-any-source': { type: 'boolean' } },
  async run(ctx) {
    const [sub = 'status', ...rest] = ctx.args;
    const { client, values } = ctx;
    let status: ShareStatus;
    if (sub === 'status') status = await client.request('nodes.share.status', {});
    else if (sub === 'start') {
      const port = values.port === undefined ? undefined : Number(values.port);
      if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65_535)) throw ctx.usageError(M.portRange);
      status = await client.request('nodes.share.start', {
        ...(port !== undefined ? { port } : {}),
        ...(values.name ? { name: values.name } : {}),
        ...(values['allow-any-source'] !== undefined ? { allowAnySource: values['allow-any-source'] } : {}),
      });
    } else if (sub === 'stop') status = await client.request('nodes.share.stop', {});
    else if (sub === 'code') status = await client.request('nodes.share.pairingCode', {});
    else if (sub === 'revoke') {
      const [clientId] = rest;
      if (!clientId) throw ctx.usageError(M.shareRevokeUsage);
      status = await client.request('nodes.share.revoke', { clientId });
    } else if (sub === 'capability')
      status = await client.request(
        'nodes.share.setCapability',
        ctx.parse(() => parseCapabilitySwitch(rest)),
      );
    else throw ctx.usageError();
    return ctx.done(status, formatShareStatus(status));
  },
});
