import type { ModelManagementMessages } from './model-management-copy.ts';

export const es: ModelManagementMessages = {
  removeModel: "Eliminar modelo",
  removeModelBody: "¿Eliminar este modelo añadido de BaoCut? Se conservan el proveedor y las cuentas. Si es el modelo predeterminado, se quitará esa selección. Si hay un modelo integrado con el mismo ID, seguirá apareciendo tras eliminar la configuración y no se podrá eliminar.",
  pickAudio: "Elegir audio o vídeo",
  asrTitle: "Probar reconocimiento de voz",
  asrNote: "Elige un audio o vídeo corto. El audio se envía al proveedor elegido. Los resultados TXT/SRT se guardan en la ubicación configurada y aparecen en Space.",
  asrRunning: "Enviando audio y esperando la transcripción…",
  desktopOnly: "Elige un archivo local en la aplicación de escritorio para probar el reconocimiento de voz.",
};
