import type { JobsUpscaleImageMessages } from './upscale-image.ts';

export const ja: JobsUpscaleImageMessages = {
  label: '画像の高解像度化',
  description: 'このコンピュータの Real-ESRGAN で画像を 2〜4 倍に拡大します。ファイルからファイルへ、出力は PNG で、既存のファイルは上書きしません。',
  stepProbe: '画像を読み込む',
  stepUpscale: '拡大',
  stepVerify: '出力を検証',
  stepPublish: '公開',
  inputNotFound: (p: { file: string }) => `入力画像 ${p.file} が見つかりません`,
  inputUnsupported: (p: { name: string }) => `${p.name} は読み込める PNG、JPEG、WebP 画像ではありません`,
  outputTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name} は拡大すると ${p.width}×${p.height} になります。各辺は最大 ${p.max} ピクセルです。倍率を小さくしてください。`,
  upscaleFailed: (p: { name: string; detail: string }) => `Real-ESRGAN で ${p.name} を拡大できませんでした：${p.detail}`,
  outputMissing: (p: { name: string }) => `${p.name} の出力が書き出されませんでした`,
  outputSizeMismatch: (p: { name: string; actual: string; expected: string }) => `${p.name} の出力は ${p.actual} ですが、${p.expected} のはずです`,
  exifOrientation: (p: { name: string }) => `${p.name} には EXIF の向きタグがあります。出力はピクセルどおりに拡大され、正しい向きには回転されません`,
  toolNotFound: (p: { code: string }) => `Real-ESRGAN を起動できません（${p.code}）`,
};
