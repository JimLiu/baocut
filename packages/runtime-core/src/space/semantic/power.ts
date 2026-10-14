import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 供电与散热（检索规格 §16.1）：语义索引是后台的长任务，笔记本用电池时、系统已经因为过热降频时先停下，接上电源、温度回落后
 * 接着建。由 Runtime 自己查（桌面端、CLI 拉起的 Runtime 与 Web 都一样）；只在有活要干时每隔一会儿查一次。
 *
 * - macOS：`pmset -g batt` 里写着 `Battery Power` 就是在用电池；`pmset -g therm` 里 `CPU_Speed_Limit` 低于 100 当作过热降频
 *   （尽力而为：Apple 芯片的机器多半不报这一项，这时只看电池）。
 * - Windows：`Win32_Battery.BatteryStatus` 为 1（正在放电）就是在用电池；没有电池的台式机没有输出。
 * - Linux：`/sys/class/power_supply` 里有接通的 `Mains` / `USB` 电源就是接着电；否则有电池在放电（`Discharging`）才算用电池。
 *
 * 查不出来（命令不在、超时、读不了目录）一律当作接着电，不因为查不到而停下。
 */

export type PowerState = 'ac' | 'battery' | 'thermal';

/** `pmset -g batt` 的输出：在用电池吗。 */
export function parseDarwinBattery(output: string): boolean {
  return /'Battery Power'/.test(output);
}

/** `pmset -g therm` 的输出：系统在因为温度限速吗（`CPU_Speed_Limit` 低于 100）。 */
export function parseDarwinThermal(output: string): boolean {
  const match = /CPU_Speed_Limit\s*=\s*(\d+)/.exec(output);
  return match !== null && Number(match[1]) < 100;
}

/** `(Get-CimInstance Win32_Battery).BatteryStatus` 的输出（每块电池一行）：有一块在放电（1）就是在用电池。 */
export function parseWindowsBattery(output: string): boolean {
  return output.split(/\r?\n/).some((line) => line.trim() === '1');
}

export interface LinuxSupply {
  type: string;
  online: string | null;
  status: string | null;
}

/** `/sys/class/power_supply/*` 的 `type`、`online`、`status`。 */
export function parseLinuxSupplies(supplies: readonly LinuxSupply[]): boolean {
  if (supplies.some((s) => (s.type === 'Mains' || s.type === 'USB') && s.online === '1')) return false;
  return supplies.some((s) => s.type === 'Battery' && s.status === 'Discharging');
}

const PROBE_TIMEOUT_MS = 5_000;

function run(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

async function readLinuxSupplies(root = '/sys/class/power_supply'): Promise<LinuxSupply[]> {
  const read = (file: string) => fs.readFile(file, 'utf8').then((text) => text.trim(), () => null);
  const names = await fs.readdir(root).catch(() => [] as string[]);
  return Promise.all(
    names.map(async (name) => ({
      type: (await read(path.join(root, name, 'type'))) ?? '',
      online: await read(path.join(root, name, 'online')),
      status: await read(path.join(root, name, 'status')),
    })),
  );
}

/** 这台机器此刻的供电状态。过热优先于电池（两者都暂停，原因写过热）。 */
export async function probePower(platform: NodeJS.Platform = process.platform): Promise<PowerState> {
  if (platform === 'darwin') {
    const [battery, therm] = await Promise.all([run('pmset', ['-g', 'batt']).catch(() => ''), run('pmset', ['-g', 'therm']).catch(() => '')]);
    if (parseDarwinThermal(therm)) return 'thermal';
    return parseDarwinBattery(battery) ? 'battery' : 'ac';
  }
  if (platform === 'win32') {
    const output = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-CimInstance -ClassName Win32_Battery).BatteryStatus',
    ]).catch(() => '');
    return parseWindowsBattery(output) ? 'battery' : 'ac';
  }
  if (platform === 'linux') return parseLinuxSupplies(await readLinuxSupplies()) ? 'battery' : 'ac';
  return 'ac';
}
