#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// 按 rig-check.mjs 写的 rig-timeline.json 放音效：每个配方合成一次，同一笔修改里放上时间线，一起撤销。
// 配方在本机合成，不联网。打字声取得很短并按 --tick-gap 抽稀，免得一秒三十下连成一片。
// 同轨片段不能重叠：每个配方一条轨，叠在一起的再开一条。
//
//   node place-sfx.mjs <video> <rig-timeline.json> [--offset 秒] [--tick-gap 0.07] [--bc "baocut"] [--dry]
//                      [--recipes '{"hit":"stamp"}'] [--volume '{"tick":-12}']
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export const DEFAULT_RECIPES = { tick: 'keypress', pop: 'pop', whoosh: 'whoosh', hit: 'impact', ding: 'ping' };
// 音量是相对配方峰值（约 -1 dBFS）的 dB：比旁白低，打字声最轻。
export const DEFAULT_VOLUME = { tick: -20, pop: -10, whoosh: -11, hit: -6, ding: -13 };

// 事件时刻对的是那一下最响的地方。whoosh 最响处在正中，其余配方开头就是最响的。
export function planPlacements(events, o = {}) {
  const gap = o.tickGap ?? 0.07, offset = o.offset ?? 0, out = [];
  let lastTick = -Infinity;
  for (const e of events) {
    if (e.s === 'tick') {
      if (e.t - lastTick < gap) continue;
      lastTick = e.t;
    }
    out.push({ s: e.s, at: Math.max(0, e.t + offset) });
  }
  return out;
}

// 按整帧排：每个配方一组轨道，放得下就放在已有的轨上，放不下才开新轨。
export function layoutItems(placements, assets, fps) {
  const lanes = {}, items = [];
  for (const p of placements) {
    const a = assets[p.s], lead = p.s === 'whoosh' ? a.seconds / 2 : 0;
    const fromFrame = Math.max(0, Math.round((p.at - lead) * fps)), durationFrames = Math.max(1, Math.ceil(a.seconds * fps));
    const ends = (lanes[p.s] ??= []);
    let lane = ends.findIndex(end => end <= fromFrame);
    if (lane < 0) { lane = ends.length; ends.push(0); }
    ends[lane] = fromFrame + durationFrames;
    items.push({ s: p.s, lane, fromFrame, durationFrames });
  }
  return { items, lanes: Object.fromEntries(Object.entries(lanes).map(([k, v]) => [k, v.length])) };
}

function main() {
  const args = process.argv.slice(2), [video, tlFile] = args;
  const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  if (!video || !tlFile) { console.error('usage: node place-sfx.mjs <video> <rig-timeline.json> [--offset s] [--tick-gap s] [--bc cmd] [--dry]'); process.exit(2); }
  const bcParts = flag('--bc', 'baocut').split(' ');
  const bc = (...a) => {
    const out = JSON.parse(execFileSync(bcParts[0], [...bcParts.slice(1), ...a, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 }).trim().split('\n').pop());
    if (!out.ok) throw new Error(JSON.stringify(out.error));
    return out.result;
  };
  const recipes = { ...DEFAULT_RECIPES, ...JSON.parse(flag('--recipes', '{}')) }, volume = { ...DEFAULT_VOLUME, ...JSON.parse(flag('--volume', '{}')) };
  const tl = JSON.parse(fs.readFileSync(tlFile, 'utf8'));
  const list = planPlacements(tl.events, { tickGap: Number(flag('--tick-gap', 0.07)), offset: Number(flag('--offset', 0)) });
  const counts = {};
  for (const p of list) counts[p.s] = (counts[p.s] ?? 0) + 1;
  console.log(`placing ${list.length} sounds: ${JSON.stringify(counts)}`);
  if (args.includes('--dry')) return;
  const assets = {};
  for (const s of Object.keys(counts)) {
    if (!recipes[s]) throw new Error(`no recipe for event "${s}"; pass --recipes`);
    const extra = s === 'tick' ? ['--seconds', '0.06'] : [];
    const r = bc('assets', 'sfx', video, '--recipe', recipes[s], '--name', `SFX ${s}`, ...extra);
    assets[s] = { id: r.assetId, seconds: r.durationSeconds };
  }
  const state = bc('videos', 'inspect', video, '--limit', '1');
  const { items, lanes } = layoutItems(list, assets, Number(state.sequence.fps));
  const operations = [];
  for (const [s, n] of Object.entries(lanes)) for (let i = 0; i < n; i++) operations.push({ type: 'addTrack', kind: 'audio', name: `SFX ${s}${i ? ` ${i + 1}` : ''}`, ref: `${s}${i}` });
  operations.push({
    type: 'insertItems',
    items: items.map(it => ({
      type: 'audio', trackRef: `${it.s}${it.lane}`, assetRef: { id: assets[it.s].id, revision: '1' },
      fromFrame: it.fromFrame, subframeOffset: { ticks: '0', timescale: 48000 },
      playDuration: { ticks: String(Math.round(assets[it.s].seconds * 48000)), timescale: 48000 },
      timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 48000 }, rate: { num: 1, den: 1 } },
      mix: { volume: 10 ** (volume[it.s] / 20), muted: false },
    })),
  });
  const file = `${tlFile}.sfx-ops.json`;
  fs.writeFileSync(file, JSON.stringify(operations));
  const r = bc('edits', 'apply', video, '--expected-revision', String(state.revision), '--label', 'Place sound effects', '--operations', `@${file}`);
  console.log(`placed on ${operations.length - 1} tracks, revision ${r.revision?.after ?? r.revision}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
