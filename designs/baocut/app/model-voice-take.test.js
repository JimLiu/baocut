const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-voice-take.js');
const T = global.window.BC_VOICE_TAKE;

const SR = 8000;
/** `seconds` 秒、振幅 `amp` 的 200 Hz 正弦（RMS = amp / √2） */
const sine = (amp, seconds, sr = SR) => Float32Array.from({length: Math.round(seconds * sr)}, (_, i) => amp * Math.sin(2 * Math.PI * 200 * i / sr));
/** 等幅的方波噪声：每个样本 ±amp，RMS = amp */
const hiss = (amp, seconds, sr = SR) => Float32Array.from({length: Math.round(seconds * sr)}, (_, i) => (i % 2 ? amp : -amp));
const join = (...parts) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  parts.forEach((p) => { out.set(p, at); at += p.length; });
  return out;
};
const dbOf = (amp) => 20 * Math.log10(amp);

test('门槛：削顶 0.5%、底噪 −45 dBFS、太小声 −35 dBFS、静音 −50 dBFS、底噪取开头 0.5 秒', () => {
  assert.equal(T.TAKE.clipWarn, 0.005);
  assert.equal(T.TAKE.noiseWarnDb, -45);
  assert.equal(T.TAKE.quietDb, -35);
  assert.equal(T.TAKE.silenceDb, -50);
  assert.equal(T.TAKE.noiseWindow, 0.5);
  assert.equal(T.TAKE.clipAt, 0.99);
});

test('analyzeTake：空的、正弦的读数', () => {
  assert.deepEqual(T.analyzeTake(new Float32Array(0), SR), {seconds: 0, levelDb: -120, peakDb: -120, clipRatio: 0, silenceRatio: 1, noiseFloorDb: -120});
  const a = T.analyzeTake(sine(0.5, 2), SR);
  assert.equal(a.seconds, 2);
  assert.equal(a.levelDb, Math.round(dbOf(0.5 / Math.SQRT2) * 10) / 10, 'RMS = 振幅 / √2 → −9.0 dBFS');
  assert.equal(a.peakDb, -6);
  assert.equal(a.clipRatio, 0);
  assert.equal(a.silenceRatio, 0);
  // 采样率不同，读数一样
  assert.equal(T.analyzeTake(sine(0.5, 2, 48000), 48000).levelDb, a.levelDb);
});

test('analyzeTake：电平只算说话的帧，静音帧算进静音比例', () => {
  const a = T.analyzeTake(join(new Float32Array(SR), sine(0.5, 1)), SR);
  assert.equal(a.levelDb, -9, '一半静音不拉低说话的电平');
  assert.equal(a.silenceRatio, 0.5);
  // 全是静音：退回整段 RMS
  const quiet = T.analyzeTake(hiss(0.001, 1), SR);
  assert.equal(quiet.silenceRatio, 1);
  assert.equal(quiet.levelDb, -60);
});

test('analyzeTake：削顶比例按 |x| ≥ 0.99 数', () => {
  const s = sine(0.3, 1);
  for (let i = 0; i < 80; i++) s[i * 100] = i % 2 ? -1 : 0.995;
  assert.equal(T.analyzeTake(s, SR).clipRatio, 80 / SR);
});

test('analyzeTake：底噪取开头 0.5 秒的下四分位，跳过设备刚打开时的全零，刚开口也不被顶高', () => {
  const room = hiss(0.003, 0.5);   // −50.5 dBFS
  assert.equal(T.analyzeTake(join(room, sine(0.5, 3)), SR).noiseFloorDb, -50.5);
  assert.equal(T.analyzeTake(join(new Float32Array(SR * 0.1), hiss(0.003, 0.4), sine(0.5, 3)), SR).noiseFloorDb, -50.5, '全零不算');
  assert.equal(T.analyzeTake(join(hiss(0.003, 0.3), sine(0.5, 3)), SR).noiseFloorDb, -50.5, '0.3 秒就开口，底噪仍按安静的那几帧');
  // 后面再吵也不算：只取开头
  assert.equal(T.analyzeTake(join(room, sine(0.5, 1), hiss(0.05, 2)), SR).noiseFloorDb, -50.5);
});

test('takeIssues：门槛的两边', () => {
  const base = {seconds: 20, levelDb: -20, peakDb: -6, clipRatio: 0, silenceRatio: 0.2, noiseFloorDb: -60};
  const issues = (patch) => T.takeIssues(Object.assign({}, base, patch));
  assert.deepEqual(issues({}), []);
  assert.deepEqual(issues({clipRatio: 0.005}), [], '正好 0.5% 不算');
  assert.deepEqual(issues({clipRatio: 0.0051}), ['clipping']);
  assert.deepEqual(issues({noiseFloorDb: -45}), [], '正好 −45 dBFS 不算');
  assert.deepEqual(issues({noiseFloorDb: -44.9}), ['noisy']);
  assert.deepEqual(issues({levelDb: -35}), []);
  assert.deepEqual(issues({levelDb: -35.1}), ['quiet']);
  assert.deepEqual(issues({silenceRatio: 0.5}), []);
  assert.deepEqual(issues({silenceRatio: 0.51}), ['pauses']);
  assert.deepEqual(issues({silenceRatio: 0.95, clipRatio: 0.1}), ['silent'], '几乎没声音时别的都不说');
  assert.deepEqual(issues({clipRatio: 0.02, noiseFloorDb: -40, silenceRatio: 0.6}), ['clipping', 'noisy', 'pauses'], '按要紧程度排');
});

test('takeVerdict：一句原因 + 一句办法；干净的报好', () => {
  const ok = T.takeVerdict({levelDb: -20, clipRatio: 0, silenceRatio: 0.2, noiseFloorDb: -60});
  assert.equal(ok.k, 'ok');
  assert.equal(ok.tone, 'positive');
  const v = T.takeVerdict({levelDb: -20, clipRatio: 0.02, silenceRatio: 0.2, noiseFloorDb: -40});
  assert.equal(v.k, 'clipping');
  assert.equal(v.tone, 'notice');
  assert.equal(v.title, '有爆音，底噪偏大');
  assert.match(v.fix, /离麦克风远一拳/);
  assert.match(T.takeVerdict({levelDb: -40, clipRatio: 0, silenceRatio: 0.2, noiseFloorDb: -70}).fix, /离麦克风近一点/);
  assert.match(T.takeVerdict({levelDb: -70, clipRatio: 0, silenceRatio: 1, noiseFloorDb: -70}).fix, /麦克风对不对/);
});

test('演示录音：五个挡位各自落到对应的判词，切段生成与一次生成一样', () => {
  const want = {clean: 'ok', quiet: 'quiet', clipping: 'clipping', noisy: 'noisy', silent: 'silent'};
  T.TAKE_DEMO.forEach((d) => {
    const a = T.analyzeTake(T.demoTake(d.k, 0, 30, SR), SR);
    assert.equal(T.takeVerdict(a).k, want[d.k], d.k);
  });
  const whole = T.demoTake('clean', 0, 1, SR);
  assert.deepEqual(join(T.demoTake('clean', 0, 0.4, SR), T.demoTake('clean', 0.4, 1, SR)), whole);
});

test('liveTakeHint：爆音 > 3 秒没声音 > 太小声 > 太吵 > 等开口 > 合适', () => {
  const recent = (patch) => Object.assign({levelDb: -20, clipRatio: 0, silenceRatio: 0.2, noiseFloorDb: -60}, patch);
  const hint = (o) => T.liveTakeHint(Object.assign({seconds: 5, heard: true, noiseFloorDb: -60, recent: recent({})}, o)).k;
  assert.equal(hint({}), 'ok');
  assert.equal(hint({recent: recent({clipRatio: 0.002}), noiseFloorDb: -40}), 'clipping');
  assert.equal(hint({recent: recent({clipRatio: 0.001})}), 'ok', '0.1% 以内不打扰');
  assert.equal(hint({heard: false, seconds: 3, recent: recent({silenceRatio: 1, levelDb: -70})}), 'silent');
  assert.equal(hint({heard: false, seconds: 2.9, recent: recent({silenceRatio: 1, levelDb: -70})}), 'waiting');
  assert.equal(hint({recent: recent({levelDb: -40}), noiseFloorDb: -40}), 'quiet');
  assert.equal(hint({recent: recent({levelDb: -70, silenceRatio: 1})}), 'ok', '说话中间停一下不算太小声');
  assert.equal(hint({noiseFloorDb: -40}), 'noisy');
  assert.equal(hint({noiseFloorDb: null, heard: false, seconds: 0.3, recent: null}), 'waiting', '还没量到底噪');
  assert.equal(hint({noiseFloorDb: -40, heard: false, seconds: 1}), 'noisy', '没开口也先说吵');
});

test('micMismatch：授权声明和样本不是同一只麦克风', () => {
  const sample = {via: 'mic', mic: 'builtin'};
  assert.equal(T.micMismatch(sample, null, 'builtin'), null);
  assert.deepEqual(T.micMismatch(sample, null, 'airpods'), {sample: 'builtin', used: 'airpods'}, '还没录：看现在选的');
  assert.deepEqual(T.micMismatch(sample, {via: 'mic', mic: 'airpods'}, 'builtin'), {sample: 'builtin', used: 'airpods'}, '录好了：看录时用的');
  assert.equal(T.micMismatch(sample, {via: 'mic', mic: 'builtin'}, 'airpods'), null);
  assert.equal(T.micMismatch(sample, {via: 'upload'}, 'airpods'), null, '授权声明是上传的不比');
  assert.equal(T.micMismatch({via: 'upload'}, null, 'airpods'), null, '样本是上传的不比');
  assert.equal(T.micMismatch(null, null, 'airpods'), null);
});

test('saveTakeWarnings：只报削顶 > 0.5%、底噪 > −45 dBFS 与换了麦克风；干净的不说话', () => {
  const clean = {levelDb: -20, clipRatio: 0, silenceRatio: 0.2, noiseFloorDb: -60};
  const mic = (a, m) => ({analysis: a, via: 'mic', mic: m || 'builtin'});
  assert.deepEqual(T.saveTakeWarnings({sample: mic(clean), consent: mic(clean)}), []);
  assert.equal(T.saveWarningText([], ['Google Gemini']), null);
  // 太小声、停顿多只在停下时说，保存时不再拦一道
  assert.deepEqual(T.saveTakeWarnings({sample: mic(Object.assign({}, clean, {levelDb: -40, silenceRatio: 0.7})), consent: null}), []);
  assert.deepEqual(T.saveTakeWarnings({sample: mic(Object.assign({}, clean, {clipRatio: 0.005, noiseFloorDb: -45})), consent: null}), [], '正好在门槛上不报');
  const list = T.saveTakeWarnings({
    sample: mic(Object.assign({}, clean, {clipRatio: 0.012})),
    consent: mic(Object.assign({}, clean, {noiseFloorDb: -40}), 'airpods'),
  });
  assert.deepEqual(list, [{step: 'sample', k: 'clipping'}, {step: 'consent', k: 'noisy'}, {step: 'consent', k: 'mic'}]);
  const text = T.saveWarningText(list, ['Google Gemini']);
  assert.equal(text.title, 'Google Gemini 可能验不过');
  assert.deepEqual(text.items, ['样本有爆音', '授权声明底噪偏大', '授权声明和样本不是同一只麦克风录的']);
  assert.match(text.body, /照样上传/);
  assert.deepEqual(text.redo, ['sample', 'consent']);
  const both = T.saveWarningText([{step: 'sample', k: 'clipping'}, {step: 'sample', k: 'noisy'}], []);
  assert.deepEqual(both.items, ['样本有爆音、底噪偏大'], '同一段的毛病并成一条');
  assert.match(both.title, /克隆出来的声音也会带上/, '只存本机');
  assert.match(both.body, /照样存/);
  // 没录授权声明：不比麦克风
  assert.deepEqual(T.saveTakeWarnings({sample: mic(clean), consent: null}), []);
});
