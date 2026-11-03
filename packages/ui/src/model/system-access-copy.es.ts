import type { SystemAccessMessages } from './system-access-copy.ts';

export const es: SystemAccessMessages = {
  cardTitle: (names) => `Permite que BaoCut lea las cookies de ${names}`,
  cardBody: "macOS necesita que antes concedas a BaoCut “Acceso total al disco”. Haz clic en “Abrir Ajustes del Sistema” y BaoCut te lleva directamente a esa página. BaoCut solo lee los navegadores que marques, nada más.",
  openedTitle: "Activa BaoCut en Ajustes del Sistema y vuelve aquí",
  openedBody: "Activa el interruptor junto a BaoCut. Cuando macOS pregunte si quieres salir y volver a abrir BaoCut, elige “Salir y volver a abrir”. Si BaoCut no aparece en la lista, haz clic en “+” debajo de la lista para añadirlo. Si macOS no ofrece reabrir, haz clic abajo en “Reiniciar BaoCut”.",
  open: "Abrir Ajustes del Sistema",
  openAgain: "Abrir Ajustes del Sistema otra vez",
  restart: "Reiniciar BaoCut",
  askTitle: (names) => `¿Permitir primero el acceso a las cookies de ${names}?`,
  askBody: (names) => `Esta descarga usa tu sesión de ${names}, y macOS necesita que antes concedas a BaoCut “Acceso total al disco”. Actívalo en Ajustes del Sistema y vuelve a descargar, o sáltalo esta vez y continúa con los demás navegadores.`,
  skip: "Saltar esta vez",
  settingLabel: "Acceso total al disco",
  settingAllowed: "Permitido. BaoCut puede leer archivos de unidades externas, Escritorio, Documentos y Descargas, y las cookies de Safari, pero solo los medios, ubicaciones de guardado y navegadores que elijas.",
  settingMissing: "No permitido. macOS impide que las apps lean unidades externas, Escritorio, Documentos, Descargas y las cookies de Safari. Una vez permitido, BaoCut no fallará en estas ubicaciones por falta de permisos. Solo lee los medios, ubicaciones de guardado y navegadores que elijas.",
  openFailed: "No se pudo abrir Ajustes del Sistema. Abre tú mismo Ajustes del Sistema › Privacidad y seguridad › Acceso total al disco.",
};
