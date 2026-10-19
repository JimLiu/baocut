/**
 * 文档编辑器页面最先执行的模块（apps/docs-editor 的 main.ts 第一个导入，docs/design/docs §5）。原应用在模块求值时就读
 * `window.__BONGO_BASE__` / `__BONGO_WS_BASE__`（接口与长连接的前缀）、地址里的文档 id 与 `globalThis.docsHost`，所以都要在
 * 应用的任何模块求值之前设好：
 *
 * - 前缀：页面在 `/docs/<grant>/…` 下，前缀就是 `/docs/<grant>`。
 * - 地址：Runtime 发的地址是 `/docs/<grant>/`，服务端在页面里注入 `__BAOCUT_DOCS__.projectId`；这里换成应用认的
 *   `/docs/<grant>/project/<文档 id>`（查询串照留，`?lang=` 等）。
 * - 宿主：`docsHost.comments`（批注发给智能体）、在 BaoCut 的 iframe 里时 `docsHost.chat`（左下角「Ask Agent」）、
 *   只读的入口标 `docsHost.readOnly`（不开版本历史）、回应父窗口的 `editor:flush`、启动后发 `editor:ready`（host.ts）。
 */
import { readHostMessage } from '@baocut/slides/editor-messages';
import { ackRid, answerFlush, createChatHost, createCommentsHost, doorRid, DoorTracker, type AnnotationInfo, type ParentLink } from './host.ts';

interface BootInfo {
  projectId?: string;
  canEdit?: boolean;
}

const page = window as unknown as {
  __BONGO_BASE__?: string;
  __BONGO_WS_BASE__?: string;
  __BAOCUT_DOCS__?: BootInfo;
  docsHost?: { comments?: unknown; chat?: unknown; readOnly?: boolean };
};

const match = /^\/docs\/[^/]+/.exec(window.location.pathname);
const base = match ? match[0] : '';
page.__BONGO_BASE__ = base;
page.__BONGO_WS_BASE__ = base;

const boot = page.__BAOCUT_DOCS__ ?? {};
if (boot.projectId && !/\/project\/[^/]+/.test(window.location.pathname)) {
  window.history.replaceState(window.history.state, '', `${base}/project/${encodeURIComponent(boot.projectId)}${window.location.search}`);
}

function parentLink(): ParentLink | null {
  if (window.parent === window) return null;
  return {
    post: (message) => window.parent.postMessage(message, '*'),
    onMessage: (listener) => {
      const handle = (event: MessageEvent) => {
        // 桌面端的父页面是 file://（origin 为 null），按 origin 认不了，按 window.parent 认
        if (event.source !== window.parent) return;
        const message = readHostMessage(event.data);
        if (message) listener(message);
      };
      window.addEventListener('message', handle);
      return () => window.removeEventListener('message', handle);
    },
  };
}

async function describe(path: string): Promise<AnnotationInfo> {
  const response = await fetch(`${base}/api/baocut/annotation?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`annotation ${response.status}`);
  return (await response.json()) as AnnotationInfo;
}

/** 跟踪 mux 上在途的 door 调用（flush 要等它们有回执）。 */
function trackDoorCalls(tracker: DoorTracker): void {
  const watched = new WeakSet<WebSocket>();
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (this: WebSocket, data: Parameters<WebSocket['send']>[0]) {
    const rid = doorRid(data);
    if (rid !== undefined) {
      if (!watched.has(this)) {
        watched.add(this);
        this.addEventListener('message', (event) => {
          const acked = ackRid(event.data);
          if (acked !== undefined) tracker.acked(acked);
        });
        this.addEventListener('close', () => tracker.reset());
      }
      tracker.sent(rid);
    }
    return send.call(this, data);
  };
}

const link = parentLink();
page.docsHost = {
  comments: createCommentsHost(link, describe),
  ...(link ? { chat: createChatHost(link) } : {}),
  ...(boot.canEdit === false ? { readOnly: true } : {}),
};
if (link) {
  const tracker = new DoorTracker();
  trackDoorCalls(tracker);
  answerFlush(link, tracker);
  const ready = () => link.post({ type: 'editor:ready', canEdit: boot.canEdit !== false });
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready, { once: true });
}
