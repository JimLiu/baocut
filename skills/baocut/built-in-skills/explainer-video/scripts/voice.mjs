#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本
// 按段配音：每段旁白一次 speak（同一个音色、同一套语气说明），存一份音频到 audio/<id>.<格式>，记在 audio/voice.json。
//   node tools/voice.mjs <id ...> [--missing] [--seed N] [--config explainer.json]
//   --missing   给 order 里还没配过、或稿子改过的段配音
//   --seed      只有收 seed 的模型能用；不收的模型每次合成本来就不一样，重配直接再跑一次
// 任务被打断（Runtime 重启，JOB_INTERRUPTED）时自动重试，最多三次。
// API Key 由 BaoCut 自己的配置管，这里只调 baocut speak，不碰。
import fs from 'node:fs';
import { loadConfig, parseArgs, makeBc, readJson, writeJson, scriptLines, narrationText } from './lib.mjs';

const cfg = loadConfig();
const bc = makeBc(cfg);
const { ids, flags } = parseArgs(process.argv, ['seed']);
const log = cfg.abs(cfg.dirs.audio, 'voice.json');
const all = scriptLines(cfg);
const V = cfg.voice;

const todo = flags.missing
  ? cfg.order.filter(id => { const r = readJson(log, {})[id]; return !r || r.text !== narrationText(all[id] || []); })
  : ids;
if (!todo.length) { console.error('usage: voice.mjs <id ...> | --missing'); process.exit(ids.length || flags.missing ? 0 : 2); }

fs.mkdirSync(cfg.abs(cfg.dirs.audio), { recursive: true });
for (const id of todo) {
  const lines = all[id];
  if (!lines || !lines.length) throw new Error(`no narration lines for ${id} in ${cfg.script.path} (or fixedLines)`);
  const text = narrationText(lines);
  const args = ['speak', '--text', text, '--language', cfg.language, '--format', V.format];
  for (const k of ['provider', 'model', 'voice', 'instructions', 'speed']) if (V[k] != null) args.push('--' + k, String(V[k]));
  if (flags.seed != null) args.push('--seed', String(flags.seed));
  if (V.attach && cfg.video) args.push('--video', cfg.video, '--name', `${cfg.names.narration} ${id}`);
  let r;
  for (let k = 1; ; k++) {
    try { r = bc(args); break; } catch (e) {
      if (e.cli?.code === 'JOB_INTERRUPTED' && k < 3) { console.error(`${id}: speak interrupted, retrying (${k}/2)`); continue; }
      if (flags.seed != null && /seed/i.test(e.cli?.message || '')) throw new Error(`${id}: ${e.cli.message}. Re-voice without --seed; if a word is still misread, rewrite the line`);
      throw e;
    }
  }
  writeJson(cfg.abs(cfg.dirs.audio, `${id}.result.json`), r);
  const o = r.outputs[0];
  const file = `${cfg.dirs.audio}/${id}.${V.format}`;
  bc(['artifacts', 'save', '--artifact-id', o.artifactId, '--path', file, '--overwrite']);
  // 几个进程并行配音时各自重读再写，免得互相覆盖
  const rec = readJson(log, {});
  rec[id] = { text, voice: { ...V }, seed: flags.seed ?? null, jobId: r.jobId, artifactId: o.artifactId, assetId: o.assetId ?? null, durationSec: o.media.durationSec, file };
  writeJson(log, rec);
  console.log(id, o.artifactId, o.media.durationSec);
}
