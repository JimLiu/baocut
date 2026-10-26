# 老录音：修复、拉平、剪开头的空白

几十年前的录音常常又轻又脏：整体比片头旁白低十几到二十分贝，带电源的嗡声与磁带的嘶声，主讲离话筒近、主持与提问的人远，忽大忽小；档案馆的数字化文件开头还常有十来秒空白。片头讲完一句「下面是完整录音」，观众要先等十秒，再听一段几乎听不清的声音，就走了。用户审张爱玲那期时提的原话是：「3:04 秒后说接下来是完整录音，但是要等 10 来秒才真的有声音；另外整体的录音声音很小，几乎无法听清，是否可以用技术手段放大并去掉杂音？」

所以老录音默认先修再用：在文件上滤掉杂音、拉平、提响，换进视频；开头的空白剪到一秒左右。讲话的内容一个字不剪。

## 1. 先量，再决定修不修

- 整体响度与峰值：`ffmpeg -i <录音> -af ebur128=peak=true -f null -`，看最后的 `I`（LUFS）与 `Peak`，片头旁白也这样量一次。录音比旁白低 10 dB 以上就要修。张爱玲那盘是 -39 LUFS。
- 混音里的音量帮不上：片段音量上限 4 倍（+12 dB），-39 LUFS 提 12 dB 还是听不清，底噪也一起放大。修在文件上做，混音音量留在 1 附近。
- 底噪：找一段只有噪声的地方（开头的空白、两段话之间）听一听，是嗡声（50 或 60 Hz 及其倍频，看录音的国家与年代）、嘶声，还是两者都有。
- 忽大忽小：主讲、主持、问答各听一段，差得多就要拉平（第 3 节）。
- 是不是有损文件：`ffprobe -v error -show_entries stream=codec_name,bit_rate,channels -of compact <录音>`。YouTube、网页上转来的 AAC、MP3 是有损的，降噪前先看第 2 节那条提醒。
- 反过来也要修：录音比旁白响 5 dB 以上、波形顶平（削过波），或者转录时已经滤掉了高频。这种录音不往上提，改往下压，链也不一样，见第 4.1 节。

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

**有损文件先听不降噪的那版**：网上转来的 AAC、MP3 本身带编码留下的毛病，听着像电音、颤音，滤不掉。降噪（`afftdn`）加提高频往往让它更明显。胡适那盘（YouTube 上 128 kbps 的 AAC）降噪、提 2.5 kHz 之后，用户听出电音和颤音；换成不降噪、不提高频的那版才好，虽然它的底噪几乎没降（数字见第 4.1 节）。测量分不出哪一版的毛病更明显，要靠人听。所以来源是有损文件时：

- 默认用不降噪、不提高频的那版；去削波、滤嗡声、拉平、压缩照做。
- 用户听过嫌底噪大，再做降噪的那版，和不降噪的那版一起做对比样（第 4 节最后一条），让用户挑。

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
- 做对比样：原录音和修过的各版在同样几处各剪一段，削波最重、底噪最明显、普通讲话的地方各一处；响度对齐，放进一个文件依次放。用户听过再换进视频。最后用 `--lag` 对原录音再量一次，应该还是 0。

## 4.1 另一种录音：太响、削过波、高频早就没了

胡适 1958 年那盘（网上的 m4a，从合辑唱片转出来）和张爱玲那盘正相反：整体 -12 LUFS，比旁白响 8 dB；峰值顶在 0 dBFS，削过波；3 kHz 以上的声音比整体低 37 dB，转录时就滤掉了；两个声道几乎一样（相差在 -90 dB 以下）。修法照第 2–4 节的顺序，改这几处：

- **取一个声道**：两个声道各量一次。几乎一样就取左声道（`pan=mono|c0=c0`）；不一样就各听一段，选干净的那个。不混成单声道。
- **先 `adeclip`**：削波修补放在最前面，在降噪和滤波之前。
- **不提高频**：先量：`ffmpeg -i <录音> -af "highpass=f=3000:p=2,highpass=f=3000:p=2,astats=measure_overall=RMS_level:measure_perchannel=none" -f null -` 读出的 RMS 比不加高通时低 30 dB 以上，就是没有高频了。最后用的那版不提 2.5 kHz，只在 4.2 kHz 以上加一道轻低通（`lowpass=f=4200:p=2`）。
- **先不降噪**：这盘是有损文件，照第 2 节那条提醒。用户要降噪时，`afftdn` 用 `nr=8:nf=-50`；转录时已经处理过的录音，再强就发虚。
- **要降噪、开头又没有空白时，把噪声样本接在最前面**：从讲话中间的停顿里切一两秒只有噪声的，接在整段前面让 `afftdn` 先学，处理完再按样本的采样数切掉。
- **往下压**：拉平之后压 1.5 dB，2:1 的压缩，同样的限幅。

下面是这盘第一次用的、带降噪的链，接噪声样本的写法在里面。最后用的那版去掉 `asendcmd`、`afftdn`、`equalizer` 三项，加上 `lowpass=f=4200:p=2`。不降噪，也就不用接噪声样本、不用挪时间（量出来只差 0–2 个采样）。

```bash
NS=83790   # 噪声样本 281.8–283.7 秒，1.9 秒 × 44100
HUM="bandreject=f=60:t=q:w=10,bandreject=f=120:t=q:w=20,bandreject=f=240:t=q:w=20,bandreject=f=360:t=q:w=20"
CHAIN="highpass=f=70:p=2,highpass=f=70:p=2,$HUM,asendcmd=c='0.05 afftdn@dn sn start; 1.85 afftdn@dn sn stop',afftdn@dn=nr=8:nf=-50:nl=none,equalizer=f=2500:t=q:w=1:g=3"
ffmpeg -i <原录音> -filter_complex "[0:a]pan=mono|c0=c0,adeclip,asplit=2[a][b];[a]atrim=start=281.8:end=283.7,asetpts=PTS-STARTPTS[n];[b]asetpts=PTS-STARTPTS[f];[n][f]concat=n=2:v=0:a=1,$CHAIN,atrim=start_sample=$NS,asetpts=PTS-STARTPTS[o]" -map "[o]" -c:a pcm_f32le stage1.wav
# 量时间差（这盘晚了 1097 个采样），挪回去，再 level.mjs 拉平（它打印 -2 到 +5.9 dB）
F="volume=-1.5dB,acompressor=threshold=0.35:ratio=2:attack=3:release=120:knee=4:detection=peak:makeup=1,alimiter=limit=0.794:attack=5:release=80:level=disabled:latency=1,aresample=osf=s16:dither_method=triangular"
ffmpeg -i stage2.wav -af "$F" -c:a flac -compression_level 8 restored.flac
```

结果：最后用的那版从 -12 LUFS 降到 -17.7 LUFS，真峰值 -2.0 dBFS，和原录音的时间差 0–2 个采样。拿噪声样本那 1.9 秒比底噪：原录音 -45 dB，不降噪的那版 -46 dB，降噪的那版 -52 dB。

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
- 合辑、唱片的报幕与介绍（「某某演讲选萃」的片头、主持人的旁白）不是这场讲话，和空白一样算开头。用户同意后照这一节剪，在说明与发布文案里写清剪了几秒、剪掉的是什么。
- 剪掉开头后，声波底图要重画：`envelope.mjs` 带 `--from <剪掉的秒数>`，声波才和视频里放的那段对得上（`production-scripts` 的 `pipeline.md`「录音波形」）。
- 正片的内容只在用户同意后剪（`SKILL.md` 第 2 节）。用户说了要剪开头的空白，就只剪空白。

## 7. 写进说明与发布文案

- 说明里写清：用了哪条滤波链；噪声样本取在哪一段；量出的时间差，以及怎么挪回去的；拉平和提响的数字；修前修后的响度；开头剪了几秒。还要写一句「讲话内容没有剪」。
- 发布文案的声明写一句人话，例如「原声做了降噪，音量也放大了；讲话内容没有剪，只剪掉了开头约 8 秒的空白」。章节时间按剪过之后的成片重算。
