# 媒体预览演示素材

`cover-a.svg`、`cover-b.svg`、`cover-c.svg` 与 `video-poster.svg` 是本仓库编写的矢量演示图，不使用用户照片。

`geometric-demo.webm` 是用 FFmpeg 的纯色、几何图形与淡入淡出生成的 6 秒无声测试视频，用于验证聊天内播放与文件标签页播放，不作为真实成片交付。

`panorama.svg` 是本仓库编写的 2:1 等距柱状投影演示图，方位文字用于检查全景拖动与缩放。

`motion-study.gif` 是 320×180、12 帧的合成测试图，用于验证 GIF 解码、逐帧批注与变速下载。生成命令：

```sh
ffmpeg -f lavfi -i 'testsrc2=size=320x180:rate=6:duration=2' \
  -filter_complex '[0:v]split[a][b];[a]palettegen[p];[b][p]paletteuse' \
  -y motion-study.gif
```

`audio-preview-demo.wav` 是 FFmpeg 生成的 10 秒、16 kHz 单声道低音量正弦波，不含人声，用于音频卡播放和进度验证。
