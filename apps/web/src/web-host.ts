import type { HostBridge } from '@baocut/ui';
import { M } from './web-host-copy.ts';

/**
 * 浏览器里的宿主能力（架构设计 §4.8）。桌面的预加载脚本给的是原生能力；浏览器拿不到本机路径，这些能力退化成
 * 「不可用」并给出说明，界面照常工作：
 *
 * - 连接：同源的 `/ws`。登录状态在 HttpOnly cookie 里，页面拿不到也不需要令牌（握手里的令牌是空的，服务不看它）。
 * - 选目录、选素材文件、拖入文件：浏览器给不出文件在磁盘上的路径，按路径导入不可用；会话文件通过独立的同源附件上传通道处理。
 * - 在文件夹中显示：不可用。
 */

const NOTICE_ID = 'baocut-web-notice';
const NOTICE_MS = 6000;

let timer: ReturnType<typeof setTimeout> | undefined;

/** 页面底部的一条提示，几秒后消失。不依赖界面包的组件：界面包不知道自己跑在浏览器里。 */
function notice(text: string): void {
  let node = document.getElementById(NOTICE_ID);
  if (!node) {
    node = document.createElement('div');
    node.id = NOTICE_ID;
    node.setAttribute('role', 'status');
    Object.assign(node.style, {
      position: 'fixed',
      left: '50%',
      bottom: '24px',
      transform: 'translateX(-50%)',
      maxWidth: 'min(560px, calc(100vw - 32px))',
      padding: '10px 16px',
      borderRadius: '8px',
      background: 'rgba(28, 25, 23, 0.92)',
      color: '#fafaf9',
      font: '14px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
      zIndex: '2147483647',
    });
    document.body.append(node);
  }
  node.textContent = text;
  clearTimeout(timer);
  timer = setTimeout(() => node?.remove(), NOTICE_MS);
}

export const webHost: HostBridge = {
  platform: 'web',
  supportsImageAttachments: true,
  supportsFileAttachments: true,
  async getConnection() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return { endpoint: `${scheme}://${location.host}/ws`, token: '' };
  },
  async pickDirectory(_options?: { title?: string }) {
    notice(M.pickDirectory);
    return null;
  },
  async pickMediaFiles() {
    notice(M.pickMedia);
    return [];
  },
  pathForFile() {
    notice(M.dropFiles);
    return '';
  },
  async revealPath() {
    notice(M.reveal);
  },
};
