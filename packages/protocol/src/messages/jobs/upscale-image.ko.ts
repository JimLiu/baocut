import type { JobsUpscaleImageMessages } from './upscale-image.ts';

export const ko: JobsUpscaleImageMessages = {
  label: '이미지 업스케일',
  description: '이 컴퓨터의 Real-ESRGAN으로 이미지를 2–4배 확대합니다. 파일에서 파일로, 출력은 PNG이며 기존 파일을 덮어쓰지 않습니다.',
  stepProbe: '이미지 읽기',
  stepUpscale: '확대',
  stepVerify: '출력 검증',
  stepPublish: '게시',
  inputNotFound: (p: { file: string }) => `입력 이미지 ${p.file}을(를) 찾을 수 없습니다`,
  inputUnsupported: (p: { name: string }) => `${p.name}은(는) 읽을 수 있는 PNG, JPEG, WebP 이미지가 아닙니다`,
  outputTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name}은(는) 확대하면 ${p.width}×${p.height}이 됩니다. 각 변은 최대 ${p.max}픽셀입니다. 더 작은 배율을 선택하세요.`,
  upscaleFailed: (p: { name: string; detail: string }) => `Real-ESRGAN이 ${p.name}을(를) 확대하지 못했습니다: ${p.detail}`,
  outputMissing: (p: { name: string }) => `${p.name}의 출력이 기록되지 않았습니다`,
  outputSizeMismatch: (p: { name: string; actual: string; expected: string }) => `${p.name}의 출력은 ${p.actual}이지만 ${p.expected}이어야 합니다`,
  exifOrientation: (p: { name: string }) => `${p.name}에 EXIF 방향 태그가 있습니다. 출력은 픽셀 그대로 확대되며 바로 세워지지 않습니다`,
  toolNotFound: (p: { code: string }) => `Real-ESRGAN을 시작할 수 없습니다(${p.code})`,
};
