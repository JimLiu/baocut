import type { RcGatewayMessages } from './rc-gateway.ts';

export const ru: RcGatewayMessages = {
  helloTimeout: "Время ожидания рукопожатия истекло",
  textFramesOnly: "Принимаются только текстовые кадры",
  frameNotJson: "Кадр не является допустимым JSON",
  frameUnrecognized: "Нераспознанный кадр",
  unknownMethod: (p: { method: string }) => `Неизвестный метод: ${p.method}`,
  invalidParams: "Недопустимые параметры",
  helloRequired: "Первым кадром должен быть hello",
  invalidToken: "Недопустимый токен",
  protocolMismatch: (p: { client: string; runtime: string }) => `Несовместимые версии протокола: клиент ${p.client}, Runtime ${p.runtime}`,
  internalError: "Внутренняя ошибка",
  catalogLocalOnly: "Каталог инструментов доступен только локальному CLI и настольному приложению",
};
