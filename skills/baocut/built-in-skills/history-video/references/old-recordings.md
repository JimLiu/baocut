# 老录音：修复、拉平、剪开头的空白

几十年前的录音常常又轻又脏：整体比片头旁白低十几到二十分贝，带电源的嗡声与磁带的嘶声，主讲离话筒近、主持与提问的人远，忽大忽小；档案馆的数字化文件开头还常有十来秒空白。片头讲完一句「下面是完整录音」，观众要先等十秒，再听一段几乎听不清的声音，就走了。用户审张爱玲那期时提的原话是：「3:04 秒后说接下来是完整录音，但是要等 10 来秒才真的有声音；另外整体的录音声音很小，几乎无法听清，是否可以用技术手段放大并去掉杂音？」

所以老录音默认先修再用：在文件上降噪、拉平、提响，换进视频；开头的空白剪到一秒左右。讲话的内容一个字不剪。

## 1. 先量，再决定修不修

- 整体响度与峰值：`ffmpeg -i <录音> -af ebur128=peak=true -f null -`，看最后的 `I`（LUFS）与 `Peak`，片头旁白也这样量一次。录音比旁白低 10 dB 以上就要修。张爱玲那盘是 -39 LUFS。
- 混音里的音量帮不上：片段音量上限 4 倍（+12 dB），-39 LUFS 提 12 dB 还是听不清，底噪也一起放大。修在文件上做，混音音量留在 1 附近。
- 底噪：找一段只有噪声的地方（开头的空白、两段话之间）听一听，是嗡声（50 或 60 Hz 及其倍频，看录音的国家与年代）、嘶声，还是两者都有。
- 忽大忽小：主讲、主持、问答各听一段，差得多就要拉平（第 3 节）。

原件不动，在副本上做。中间文件用 32 位浮点 wav，44.1 kHz 单声道每小时约 0.64 GB 一份，放在空间够的盘上，做完列给用户再清。先切两分钟的样（含主讲、问答和最安静的一段）试参数，听过再跑全片。

## 2. 第一步：滤波与降噪

张爱玲那盘用的链（44.1 kHz 单声道），按录音改的只有嗡声的基频与噪声样本的时段：

```bash
HUM="bandreject=f=60:t=q:w=20,bandreject=f=120:t=q:w=20,bandreject=f=180:t=q:w=20,bandreject=f=240:t=q:w=20"
CHAIN="highpass=f=80:p=2,highpass=f=80:p=2,$HUM,lowpass=f=5000:p=2,lowpass=f=5000:p=2,asendcmd=c='2.0 afftdn@dn sn start; 9.5 afftdn@dn sn stop',afftdn@dn=nr=12:nf=-30:nl=none,equalizer=f=2500:t=q:w=1:g=3"
ffmpeg -i <原录音> -af "$CHAIN" -ac 1 -c:a pcm_f32le stage1.wav
```

- 两道 80 Hz 高通去掉低频的轰声；`bandreject` 去嗡声，基频 50 Hz 的录音换成 50、100、150、200。
- 两道 5 kHz 低通去嘶声。老磁带上的人声在 4–5 kHz 以上本来就没有多少内容，切掉听得更清楚。
- `afftdn` 按噪声样本降噪：`asendcmd` 在 2.0–9.5 秒（只有噪声的那一段）让它学噪声的样子。`nr=12` 已经够了，再强人声会发虚、带水声。
- 2.5 kHz 提 3 dB，让辅音清楚一点。

**量时间差**：这条链让声音晚了 1104 个采样（25 ms）。字幕、原声引用的逐词时间、章节都按原录音的时钟，换进视频之前要挪回去。用 `production-scripts` 的 `level.mjs` 量：

```bash
node tools/level.mjs --lag <原录音> stage1.wav --at 15,1800,4300
ffmpeg -i stage1.wav -af "atrim=start_sample=1104,asetpts=PTS-STARTPTS,apad=pad_len=1104" -c:a pcm_f32le stage1s.wav
node tools/level.mjs --lag <原录音> stage1s.wav --at 15,1800
```

几个时刻量出的晚了多少应该一致；挪过之后再量一遍，应该在 0 附近（±1 个采样）。

## 3. 第二步：拉平

```bash
node tools/level.mjs stage1s.wav --out stage2.wav
```

脚本每 100 ms 量一次短时响度，把每一处前后 45 秒里讲话部分的中位数往全片的 75 分位拉：最多提 9 dB、最多压 2 dB，按前后 15 秒平滑，听不出在变。掌声、笑声、碰话筒这类比讲话响得多的地方另外压回去，不跟着被提上来。它打印用到的数：张爱玲那盘是提 -2 到 +9 dB，响声最多压了 19.5 dB，共约 190 秒压了 1 dB 以上。参数（`--lift`、`--cut`、`--window`、`--smooth`）一般不用改。这一步不改时间。

## 4. 第三步：提响、压缩、限幅

```bash
F="volume=0:enable='lt(t,1.5)',volume=17.5dB,acompressor=threshold=0.25:ratio=3:attack=3:release=120:knee=4:detection=peak:makeup=1.5,alimiter=limit=0.794:attack=5:release=80:level=disabled:latency=1,aresample=osf=s16:dither_method=triangular"
ffmpeg -i stage2.wav -af "$F" -c:a flac -compression_level 8 restored.flac
```

- `volume=17.5dB` 按这盘算出来的。换一盘录音时，片头旁白和拉平后的录音各量一次讲话部分的短时响度中位数，差多少提多少，切过去不会突然变小。
- 压缩、限幅把峰值收在 -2 dBFS 以下。`latency=1` 让限幅器不带延迟。
- `volume=0:enable='lt(t,1.5)'` 静掉开头 1.5 秒里的咔哒声；开头干净就不要。
- 结果：张爱玲那盘从 -39.0 LUFS 提到 -24.7 LUFS，真峰值 -1.9 dBFS。导出时带 `--loudness`，整片再统一到平台的响度。
- 做一段对比样（原声与修过的交替放），自己听过再换进视频。最后用 `--lag` 对原录音再量一次，应该还是 0。

## 5. 换进视频

1. `baocut assets import <videoId> --path restored.flac --storage managed --name <名字>`。
2. 一笔 `edits apply`（先 `--dry-run`），用到旧录音的片段全部换掉，包括正片录音和片头里的每一段原声引用：
   - 对每个片段做 `replaceItemAsset`（`assetRef` 是新素材的 `{ id, revision }`）。
   - 再用 `setAudioMix` 重设音量：正片录音设 1；原声引用的音量这样算：先在修过的文件里量这一段的 LUFS，音量 = 10^((`footage.loudness` − 实测值) / 20)，夹在 0–4。
   - 新文件比旧的短几毫秒时（编码对齐），先用 `trimItem` 把正片录音的终点收进新文件的长度。
3. 之后重放原声引用前，把 `clips.json` 里这些片段的 `asset` 改成新素材的 ID、`source` 改成修过的文件。否则 `overlay.mjs --place` 会按旧录音放回去，音量也按旧录音算。

## 6. 剪开头的空白

- 找第一个字：正片转写的第一条，或者第 3 节量出的响度第一次高过讲话门限的地方。在它前面留 1 秒左右。
- 一笔 `edits apply` 剪掉：
  - `removeRange` 剪掉这一段（`from`、`to` 用帧，`trackIds` 列全部轨道，正片的画面、字幕、水印一起往前挪）。
  - 引擎剪的时候不挪章节，所以对剪掉的这一段之后的每一章各做一次 `upsertChapter`，`at` 写原来的帧数减去剪掉的帧数。
- 范围从正片起点之后开始，别碰片头最后一拍和正片第一帧的封面。剪之前先列出这一段各轨上有什么（`videos inspect`），确认只有空白。
- 剪完查一遍写死了正片总长的地方：声波底图上印的总时长（例如「TOTAL 01:12:46」）、片尾卡、说明与发布文案里的时长。时间码和声波按时间线画，会自己对上；印在图上的字不会，要重做那张图，用 `replaceItemAsset` 换进去，再烘焙导出。张爱玲那期漏了底图上这一处，成片里写的总长比实际多 8 秒。
- 正片的内容只在用户同意后剪（`SKILL.md` 第 2 节）。用户说了要剪开头的空白，就只剪空白。

## 7. 写进说明与发布文案

- 说明里写清：用了哪条滤波链；噪声样本取在哪一段；量出的时间差，以及怎么挪回去的；拉平和提响的数字；修前修后的响度；开头剪了几秒。还要写一句「讲话内容没有剪」。
- 发布文案的声明写一句人话，例如「原声做了降噪，音量也放大了；讲话内容没有剪，只剪掉了开头约 8 秒的空白」。章节时间按剪过之后的成片重算。
