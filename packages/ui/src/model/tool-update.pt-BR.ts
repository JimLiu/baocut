import type { ToolUpdateMessages } from './tool-update.ts';

export const ptBR: ToolUpdateMessages = {
  standalone: 'Binário independente oficial',
  updateInTerminal: 'Atualizar no Terminal',
  unknownInstall: 'Não é possível identificar como este yt-dlp foi instalado. Execute o comando correspondente à instalação e clique em “Verificar novamente”.',
  cannotRun: 'O BaoCut não pode executar este comando por você.',
  thenRecheck: 'Depois clique em “Verificar novamente”.',
  runThenRecheck: 'Execute este comando no Terminal e clique em “Verificar novamente”.',
  updateWith: (method) => `Atualizar com ${method}`,
  stoppedTitle: 'Atualização interrompida',
  stoppedBody: 'O comando pode ter sido executado apenas parcialmente. Veja a saída abaixo e clique em “Verificar novamente” para confirmar a versão atual do yt-dlp.',
  failedTitle: (exitCode) => exitCode === null ? 'A atualização não terminou' : `A atualização não terminou (código de saída ${exitCode})`,
  failedBody: (error) => `${error ? `${error.replace(/[。.]$/, '')}. ` : ''}Seu yt-dlp existente não foi afetado. A saída está abaixo; você também pode copiar o comando, executá-lo no Terminal e clicar em “Verificar novamente”.`,
  updatedTo: (version) => `Atualizado para ${version}`,
  upToDate: (version) => version ? `Já está atualizado (${version})` : 'Já está atualizado',
  logTruncated: '… (saída anterior omitida; a saída completa está no registro da tarefa)\n',
  logStopped: '(Parado)',
  logExitCode: (exitCode) => `(Código de saída ${exitCode})`,
};
