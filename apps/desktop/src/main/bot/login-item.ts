/**
 * 开机自动启动后台服务（技术方案 §15.2，需求 §11.8：默认关，用户在设置 › Bot 里自己开）。由 `BotSettings.openAtLogin` 驱动。
 *
 * 平台差异（开发流程 §4.1）：
 * - macOS：`app.setLoginItemSettings({ openAtLogin })` 登记为登录项（`mainAppService`）。Electron 44 已去掉 `openAsHidden`，
 *   登录时打开的判断用 `getLoginItemSettings().wasOpenedAtLogin`（系统给不出时当作普通启动，照常开窗口）。
 * - Windows：同一 API 写注册表 Run 键；带上 `--background` 参数，启动时据此不开窗口。查询时要带同样的参数才准。
 * - Linux：第一期不支持，什么都不做。
 *
 * 以隐藏方式启动时只起 Runtime 与托盘，不开窗口（`app-main.ts`）。
 */

export const BACKGROUND_ARG = '--background';

export interface LoginItemSettingsLike {
  openAtLogin: boolean;
  wasOpenedAtLogin?: boolean;
}

/** Electron `app` 里用到的那两个方法。 */
export interface LoginItemApi {
  setLoginItemSettings(settings: { openAtLogin: boolean; args?: string[] }): void;
  getLoginItemSettings(options?: { args?: string[] }): LoginItemSettingsLike;
}

export function loginItemSupported(platform: NodeJS.Platform): boolean {
  return platform === 'darwin' || platform === 'win32';
}

export class LoginItem {
  readonly #api: LoginItemApi;
  readonly #platform: NodeJS.Platform;

  constructor(api: LoginItemApi, platform: NodeJS.Platform) {
    this.#api = api;
    this.#platform = platform;
  }

  /** 让系统里的登录项与设置一致；不支持的平台不动。返回是否改了系统设置。 */
  sync(openAtLogin: boolean): boolean {
    if (!loginItemSupported(this.#platform)) return false;
    const args = this.#platform === 'win32' ? [BACKGROUND_ARG] : undefined;
    let current: boolean | null = null;
    try {
      current = this.#api.getLoginItemSettings(args ? { args } : undefined).openAtLogin;
    } catch {
      current = null;
    }
    if (current === openAtLogin) return false;
    this.#api.setLoginItemSettings(args ? { openAtLogin, args } : { openAtLogin });
    return true;
  }
}

/** 这次启动是不是开机自动启动、应该不开窗口。 */
export function launchedHidden(platform: NodeJS.Platform, argv: readonly string[], api: LoginItemApi): boolean {
  if (argv.includes(BACKGROUND_ARG)) return true;
  if (platform !== 'darwin') return false;
  try {
    return api.getLoginItemSettings().wasOpenedAtLogin === true;
  } catch {
    return false;
  }
}
