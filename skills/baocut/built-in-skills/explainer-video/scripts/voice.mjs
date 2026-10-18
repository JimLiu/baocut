#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本
// 按段配音：每段旁白一次 speak（同一个音色、同一套语气说明），存一份音频到 audio/<id>.<格式>，记在 audio/voice.json。
//   node tools/voice.mjs <id ...> [--missing] [--seed N] [--config explainer.json]
//   --missing   给 order 里还没配过、或稿子改过的段配音
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
  const r = bc(args);
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
