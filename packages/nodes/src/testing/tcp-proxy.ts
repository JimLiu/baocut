import net from 'node:net';

/**
 * 测试工具：发起端与节点之间的回环 TCP 代理，用来模拟网络故障而不动节点本身。
 *
 * - `dropOnce(match, afterMs)`：下一条请求行匹配的连接，在节点开始回数据 `afterMs` 之后被切断（事件流断一次）；
 * - `down()`：切断所有连接，之后的新连接一接上就断（节点「死了」或网络断了）；`up()` 恢复；
 * - `retarget(port)`：换一个上游端口（节点重启后换了端口）。
 *
 * 只听 127.0.0.1，端口由系统分配。
 */
export interface TcpProxy {
  readonly port: number;
  /** 经过代理的每条连接的第一行（HTTP 请求行）。 */
  readonly requests: string[];
  dropOnce(match: (requestLine: string) => boolean, afterMs?: number): void;
  down(): void;
  up(): void;
  retarget(port: number): void;
  close(): Promise<void>;
}

export async function startTcpProxy(targetPort: number): Promise<TcpProxy> {
  let target = targetPort;
  let isDown = false;
  const sockets = new Set<net.Socket>();
  const requests: string[] = [];
  const rules: Array<{ match: (line: string) => boolean; afterMs: number }> = [];

  const server = net.createServer((client) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => {});
    if (isDown) {
      client.destroy();
      return;
    }
    const upstream = net.connect(target, '127.0.0.1');
    sockets.add(upstream);
    upstream.on('close', () => {
      sockets.delete(upstream);
      client.destroy();
    });
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.destroy());

    let doomed: { afterMs: number } | null = null;
    let scheduled = false;
    client.once('data', (first: Buffer) => {
      const line = first.toString('latin1').split('\r\n')[0] ?? '';
      requests.push(line);
      const index = rules.findIndex((rule) => rule.match(line));
      if (index >= 0) doomed = rules.splice(index, 1)[0]!;
      upstream.write(first);
      client.pipe(upstream);
    });
    upstream.on('data', () => {
      if (!doomed || scheduled) return;
      scheduled = true;
      setTimeout(() => {
        client.destroy();
        upstream.destroy();
      }, doomed.afterMs);
    });
    upstream.pipe(client);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;

  return {
    port,
    requests,
    dropOnce(match, afterMs = 0) {
      rules.push({ match, afterMs });
    },
    down() {
      isDown = true;
      for (const socket of sockets) socket.destroy();
    },
    up() {
      isDown = false;
    },
    retarget(next) {
      target = next;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
