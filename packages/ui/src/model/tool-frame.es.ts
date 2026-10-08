import type { ToolFrameMessages } from './tool-frame.ts';
export const es: ToolFrameMessages = {
  noneAvailable: (noun: string) => `Aún no hay ${noun} disponible; configúralo en Ajustes`,
  pickOne: (noun: string) => `Primero elige un ${noun}`,
  notInstalled: (name: string) => `Aún no se ha instalado ${name}`,
  notConnected: (provider: string) => `Aún no se ha conectado ${provider}`,
  unavailable: (name: string, why: string | null) => `${name} · ${why ?? 'No disponible'}`,
  notInstalledWarning: (name: string) => `Aún no se ha instalado ${name}. Elige uno instalado o descárgalo en Ajustes`,
  notConnectedWarning: (provider: string) => `Aún no se ha conectado ${provider}. Elige uno que funcione o conéctalo en Ajustes`,
  noModel: (noun: string, local: boolean) => local
    ? `Aún no hay ${noun} disponible. Instala un modelo local o conecta un servicio en la nube en Ajustes.`
    : `Aún no hay ${noun} disponible. Conecta un servicio en la nube en Ajustes.`,
};
