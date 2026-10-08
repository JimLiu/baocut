import type { ProcessHostToolsMessages } from './process-host-tools.ts';

export const ko: ProcessHostToolsMessages = {
  hintMac: '예: brew install ffmpeg',
  hintWindows: '예: winget install --id Gyan.FFmpeg -e 실행 후 BaoCut을 다시 여세요',
  hintLinux: '예: sudo apt install ffmpeg',
  hintDownload: (p) => `${p.url}에서 다운로드하세요`,
  remedyWithProbe: (p) =>
    `ffmpeg을 설치하거나(ffprobe 포함, ${p.hint}) BAOCUT_FFMPEG / BAOCUT_FFPROBE 환경 변수에 실행 파일 경로를 지정하세요`,
  remedy: (p) => `ffmpeg을 설치하거나(${p.hint}) BAOCUT_FFMPEG로 경로를 지정하세요`,
  terminalBanner: (p) => `BaoCut: ${p.command} 실행 중`,
};
