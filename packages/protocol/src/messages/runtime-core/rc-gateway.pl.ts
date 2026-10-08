import type { RcGatewayMessages } from './rc-gateway.ts';

export const pl: RcGatewayMessages = {
  helloTimeout: "Upłynął limit czasu uzgadniania",
  textFramesOnly: "Akceptowane są tylko ramki tekstowe",
  frameNotJson: "Ramka nie jest prawidłowym JSON",
  frameUnrecognized: "Nierozpoznana ramka",
  unknownMethod: (p: { method: string }) => `Nieznana metoda: ${p.method}`,
  invalidParams: "Nieprawidłowe parametry",
  helloRequired: "Pierwszą ramką musi być hello",
  invalidToken: "Nieprawidłowy token",
  protocolMismatch: (p: { client: string; runtime: string }) => `Niezgodne wersje protokołu: klient ${p.client}, Runtime ${p.runtime}`,
  internalError: "Błąd wewnętrzny",
  catalogLocalOnly: "Katalog narzędzi jest dostępny tylko dla lokalnego CLI i aplikacji komputerowej",
};
