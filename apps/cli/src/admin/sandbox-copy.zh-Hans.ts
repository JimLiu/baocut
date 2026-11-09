import type { SandboxMessages } from './sandbox-copy.ts';

export const zhHans: SandboxMessages = {
  help: `用法：
  baocut sandbox create <文件夹> [--link-accounts-from <home>]
                                   给开发与测试搭一个单独的 Runtime 主目录：这个文件夹和里面的 projects 文件夹，用这份
                                   仓库的命令行跑这个主目录的 bin/baocut，以及把 shell 切过去的 env.sh / env.ps1。再跑一次
                                   刷新这些文件。只能从仓库运行；不能是默认的 ~/.baocut
    --link-accounts-from <home>    同时只读地链接那个主目录（通常是 ~/.baocut）的模型账号，与 baocut models accounts link
                                   --from 相同。调用用的是你的真实账号，照常计费`,
  defaultHome: (dir) => `${dir} 是默认的 Runtime 主目录，里面是你的真实数据；沙盒请换一个文件夹`,
  needsSourceCli:
    'baocut sandbox create 只能从仓库运行（node apps/cli/src/main.ts sandbox create …）。这个命令行拉起的是 BaoCut 应用的 Runtime，密钥放在所有主目录共用的系统钥匙串里：在那里建沙盒可能覆盖或删掉你的真实密钥',
  unknownStore: (entry) => `BAOCUT_RUNTIME_ENTRY 指向 ${entry}，不知道那个 Runtime 把密钥放在哪。建沙盒前先取消这个变量`,
  notEmpty: (dir) => `${dir} 里已经有文件，又不是 BaoCut 主目录；请换一个新的或空的文件夹`,
  notFolder: (dir) => `${dir} 不是文件夹`,
  created: (dir) => `沙盒建好了：${dir}`,
  refreshed: (dir) => `沙盒已刷新：${dir}`,
  projects: (dir) => `  项目      ${dir}`,
  cli: (file) => `  baocut    ${file}（跑这份仓库的命令行）`,
  useHeader: '在 shell 里这样用：',
  useShell: (file) => `  ${file}`,
  usePowerShell: (file) => `  ${file}   （PowerShell）`,
  useNote:
    '之后那个 shell 里的 baocut，以及从它启动的 Agent，都用这个沙盒；其他 shell 照旧用 ~/.baocut。它的 Runtime 把密钥存在沙盒里的文件中',
  linkFailed: (dir) => `${dir} 的沙盒已经建好；链接账号没成：`,
};
