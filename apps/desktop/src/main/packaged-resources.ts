import path from 'node:path';

/**
 * 打包后的应用里，Runtime 与 Worker 按路径读的东西在 `<resources>`（Electron 的 `process.resourcesPath`，asar 外面）的哪里。
 * 主进程、打包脚本（`tools/package-desktop.mjs`）与产物检查（`tools/check-packaged-app.mjs`）都从这一份取，不各写一遍。
 *
 * Runtime 以 Node 方式运行（`ELECTRON_RUN_AS_NODE`）时不一定拿得到 `process.resourcesPath`，所以主进程把这些位置经环境变量告诉它；
 * 开发时不给，Runtime 自己从仓库里找（仓库约定 §2「随应用分发的数据文件不按模块相对路径找」）。
 */

/** `<resources>` 下的子目录。 */
export const RESOURCE_DIRS = {
  /** 原生可执行文件：Worker、凭据助手，以及它们要的 DLL（Windows 的 CUDA 运行库放在 Model Worker 旁边）。 */
  bin: 'bin',
  /** 内置创作模板（仓库根的 `templates/`）。 */
  templates: 'templates',
  /** 内置 Agent skill（仓库根的 `skills/`）。 */
  skills: 'skills',
  /** 给外部 Agent 的说明书（仓库根的 `agent-skills/`，`baocut skill install` 渲染后装进宿主）。 */
  agentSkills: 'agent-skills',
  /** 自测样本与内置音色的录音（`packages/models/assets`）。 */
  modelAssets: 'model-assets',
  /** Web 客户端的构建产物（`apps/web/dist`）。 */
  web: 'web',
} as const;

/** `bin/` 里的原生程序（不带后缀）：同一次 cargo 构建出来的 Worker 与凭据助手。 */
export const BUNDLED_EXECUTABLES = ['engine-host', 'export-worker', 'model-worker', 'speech-worker', 'credential-helper'] as const;

export interface PackagedResources {
  binDir: string;
  templatesDir: string;
  skillsDir: string;
  agentSkillsDir: string;
  modelAssetsDir: string;
  webDist: string;
}

/** 由资源目录算出各个位置。`pathApi` 让检查脚本在别的平台上按 Windows 的写法算。 */
export function packagedResources(resourcesPath: string, pathApi: path.PlatformPath = path): PackagedResources {
  return {
    binDir: pathApi.join(resourcesPath, RESOURCE_DIRS.bin),
    templatesDir: pathApi.join(resourcesPath, RESOURCE_DIRS.templates),
    skillsDir: pathApi.join(resourcesPath, RESOURCE_DIRS.skills),
    agentSkillsDir: pathApi.join(resourcesPath, RESOURCE_DIRS.agentSkills),
    modelAssetsDir: pathApi.join(resourcesPath, RESOURCE_DIRS.modelAssets),
    webDist: pathApi.join(resourcesPath, RESOURCE_DIRS.web),
  };
}

/** 交给 Runtime 的环境变量（Runtime 各自的解析函数第一个看的就是它们）。 */
export function packagedResourceEnv(resources: PackagedResources, platform: NodeJS.Platform = process.platform): Record<string, string> {
  return {
    BAOCUT_BIN_DIR: resources.binDir,
    BAOCUT_TEMPLATES_DIR: resources.templatesDir,
    BAOCUT_SKILLS_DIR: resources.skillsDir,
    BAOCUT_AGENT_SKILLS_DIR: resources.agentSkillsDir,
    BAOCUT_MODEL_ASSETS_DIR: resources.modelAssetsDir,
    BAOCUT_WEB_DIST: resources.webDist,
    ...(platform === 'darwin' ? { PMETAL_METALLIB_PATH: path.join(resources.binDir, 'mlx.metallib') } : {}),
  };
}
