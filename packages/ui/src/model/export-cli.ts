import type { ExportSettings, Id } from '@baocut/protocol';

/**
 * 审片页导出面板的「复制等效命令」（产品设计 §5.12）：同一次成片导出写成 `baocut export` 的一行。
 * 只写设置里真给了的字段（宽高、恒定质量、字幕不烧、跳过画不出的内容、声音来源），其余照 CLI 的缺省；
 * 不写 `--dir`：CLI 与浏览器一样，项目里的视频缺省导到项目的 `exports/`。字段到参数的写法见 CLI 的 `catalog/flags.ts`
 * （`camelCase` → `--kebab-case`，布尔的 false 是 `--no-<名字>`）。
 */
export function exportCliCommand(videoId: Id, settings: ExportSettings): string {
  const args = ['baocut', 'export', shellArg(videoId), '--kind', settings.kind];
  if ('format' in settings && settings.format) args.push('--format', settings.format);
  if (settings.kind === 'video') {
    if (settings.width !== undefined) args.push('--width', String(settings.width));
    if (settings.height !== undefined) args.push('--height', String(settings.height));
    if (settings.crf !== undefined) args.push('--crf', String(settings.crf));
    if (settings.burnCaptions === false) args.push('--no-burn-captions');
    if (settings.onUnsupported === 'skip') args.push('--on-unsupported', 'skip');
    if (typeof settings.source === 'string' && settings.source !== 'mix') args.push('--source', settings.source);
    else if (settings.source && typeof settings.source === 'object') args.push('--source', shellArg(JSON.stringify(settings.source)));
  }
  return args.join(' ');
}

/** 一个参数照 POSIX shell 写：只有安全字符时原样，否则单引号括起（里面的单引号写成 `'\''`）。 */
export function shellArg(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}
