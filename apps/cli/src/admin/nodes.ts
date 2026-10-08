import { NODE_DEFAULT_PORT } from '@baocut/protocol';
import { defineNoun } from './context.ts';
import { M } from './nodes-copy.ts';
import { describeNode, formatHostPort } from './nodes-output.ts';

/** `baocut nodes`：已配对的局域网节点（节点协议规范 §10）。 */
export const nodes = defineNoun({
  name: 'nodes',
  get usage() {
    return M.nodesHelp(NODE_DEFAULT_PORT);
  },
  options: { alias: { type: 'string' } },
  async run(ctx) {
    const [sub, ...rest] = ctx.args;
    if (!sub || sub === 'list') {
      const result = await ctx.client.request('nodes.list', {});
      const lines = result.nodes.map(describeNode);
      if (lines.length === 0) lines.push(M.noPairedNodes);
      return ctx.done(result, lines);
    }
    if (sub === 'discover') {
      const result = await ctx.client.request('nodes.discover', {});
      const lines = result.nodes.map(
        (node) => `${node.name}  ${formatHostPort(node.host, node.port)}${node.nodeId ? `  ${node.nodeId}` : ''}`,
      );
      if (lines.length === 0) lines.push(M.noNodesDiscovered);
      return ctx.done(result, lines);
    }
    if (sub === 'pair') {
      const [target, code] = rest;
      if (!target || !code) throw ctx.usageError(M.pairUsage);
      const { host, port } = ctx.parse(() => parseHostPort(target));
      const alias = ctx.values.alias;
      const result = await ctx.client.request('nodes.pair', { host, port, code, ...(alias ? { alias } : {}) });
      return ctx.done(result, [M.paired(describeNode(result.node))]);
    }
    if (sub === 'remove') {
      const [ref] = rest;
      if (!ref) throw ctx.usageError(M.removeUsage);
      const { nodes } = await ctx.client.request('nodes.list', {});
      const node = nodes.find((n) => n.nodeId === ref) ?? nodes.find((n) => n.alias === ref);
      if (!node) return ctx.fail({ code: 'NODE_NOT_FOUND', message: M.noSuchNode(ref) });
      await ctx.client.request('nodes.remove', { nodeId: node.nodeId });
      return ctx.done({ removed: node }, [M.removed(node.alias, node.nodeId)]);
    }
    throw ctx.usageError();
  },
});

/** `host`、`host:port`、`[v6]:port`；不带端口时用默认端口。 */
export function parseHostPort(text: string): { host: string; port: number } {
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(text);
  const plain = /^([^:]+)(?::(\d+))?$/.exec(text);
  const match = bracketed ?? plain;
  if (!match) return { host: text, port: NODE_DEFAULT_PORT };
  const port = match[2] === undefined ? NODE_DEFAULT_PORT : Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(M.invalidPort(match[2]));
  return { host: match[1]!, port };
}
