import type { ToolFrameMessages } from './tool-frame.ts';

export const ko: ToolFrameMessages = {
  noneAvailable: (noun) => `아직 사용할 수 있는 ${noun}이(가) 없습니다. 설정에서 준비하세요`,
  pickOne: (noun) => `먼저 ${noun} 하나를 선택하세요`,
  notInstalled: (name) => `${name} 모델이 아직 설치되지 않았습니다`,
  notConnected: (provider) => `${provider}에 아직 연결되지 않았습니다`,
  unavailable: (name, why) => `${name} · ${why ?? '사용할 수 없음'}`,
  notInstalledWarning: (name) => `${name} 모델이 아직 설치되지 않았습니다. 설치된 모델을 선택하거나 설정에서 다운로드하세요`,
  notConnectedWarning: (provider) => `${provider}에 아직 연결되지 않았습니다. 사용할 수 있는 모델을 선택하거나 설정에서 연결하세요`,
  noModel: (noun, local) =>
    local
      ? `아직 사용할 수 있는 ${noun}이(가) 없습니다. 설정에서 로컬 모델을 설치하거나 클라우드 서비스를 연결하세요.`
      : `아직 사용할 수 있는 ${noun}이(가) 없습니다. 설정에서 클라우드 서비스를 연결하세요.`,
};
