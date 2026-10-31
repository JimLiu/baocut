/**
 * 桌面端主进程经 IPC 通道发来的消息（架构设计 §2.2，Bot 技术方案 §15.2）。`main.ts` 把它接到 `process.on('message')`。
 *
 * - `{ type: 'stop' }`：按停止顺序收尾。
 * - `{ type: 'status' }`：回 `{ type: 'status', ...activeWork }`（退出前问手上的活）。
 * - `{ type: 'detach' }`：桌面端退出、用户选了在后台继续：开启空闲退出，活做完自己停；回 `{ type: 'detached' }`。
 * - `{ type: 'resident', on }`：Bot 后台服务常驻与否；回 `{ type: 'resident', on }`。常驻时不进入空闲退出
 *   （`runtime.idleExitMinutes` 不起作用）：这期间来的 `detach` 先记下，常驻结束时才开启空闲退出。
 *
 * 空闲退出一旦开启就关不掉（Runtime 在触发前先删发现文件），所以常驻期间只能推迟开启，不能在触发时再忽略。
 */

export interface ParentChannelDeps {
  stop(reason: string): void;
  activeWork(): object;
  /** 开启空闲退出（`runtime.detach`），空闲满时调 `onIdle`。 */
  detach(onIdle: () => void): void;
  onIdle(): void;
  send(message: object): void;
  log: { info(message: string, data?: Record<string, unknown>): void };
}

export interface ParentChannel {
  handle(message: unknown): void;
  readonly resident: boolean;
  /** 空闲退出是否已开启。 */
  readonly idleExitEnabled: boolean;
}

export function createParentChannel(deps: ParentChannelDeps): ParentChannel {
  let resident = false;
  let detachPending = false;
  let idleExitEnabled = false;

  const enableIdleExit = () => {
    if (idleExitEnabled) return;
    idleExitEnabled = true;
    deps.detach(() => deps.onIdle());
    deps.log.info('Desktop quit; running in the background until work finishes');
  };

  return {
    get resident() {
      return resident;
    },
    get idleExitEnabled() {
      return idleExitEnabled;
    },
    handle(message) {
      const value = (message ?? {}) as { type?: unknown; on?: unknown };
      switch (value.type) {
        case 'stop':
          deps.stop('ipc');
          return;
        case 'status':
          deps.send({ type: 'status', ...deps.activeWork() });
          return;
        case 'detach':
          if (resident) {
            detachPending = true;
            deps.log.info('Desktop quit while the Bot background service is resident; idle exit deferred');
          } else {
            enableIdleExit();
          }
          deps.send({ type: 'detached' });
          return;
        case 'resident': {
          const on = value.on === true;
          if (on !== resident) deps.log.info(on ? 'Bot background service resident; idle exit off' : 'Bot background service no longer resident');
          resident = on;
          if (!on && detachPending) {
            detachPending = false;
            enableIdleExit();
          }
          deps.send({ type: 'resident', on });
          return;
        }
      }
    },
  };
}
