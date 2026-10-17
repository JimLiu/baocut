// A signable launcher for the CLI bundled with this app. No system Node or shell.
#include <errno.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
  char executable[PATH_MAX], resolved[PATH_MAX];
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) != 0) {
    fputs("baocut-cli: executable path is too long\n", stderr);
    return 126;
  }
  // Resolve user-created PATH symlinks before locating the enclosing app.
  if (realpath(executable, resolved) == NULL) {
    perror("baocut-cli: resolve executable");
    return 126;
  }
  char *slash = strrchr(resolved, '/');
  if (slash == NULL) return 126;
  *slash = '\0';
  char electron[PATH_MAX], entry[PATH_MAX];
  int electron_size = snprintf(electron, sizeof(electron), "%s/BaoCut", resolved);
  int entry_size = snprintf(entry, sizeof(entry), "%s/../Resources/app.asar/out/main/cli.js", resolved);
  if (electron_size < 0 || (size_t)electron_size >= sizeof(electron) ||
      entry_size < 0 || (size_t)entry_size >= sizeof(entry)) {
    fputs("baocut-cli: app path is too long\n", stderr);
    return 126;
  }
  char **args = calloc((size_t)argc + 2, sizeof(char *));
  if (args == NULL || setenv("ELECTRON_RUN_AS_NODE", "1", 1) != 0) {
    perror("baocut-cli: prepare launch");
    free(args);
    return 126;
  }
  args[0] = electron;
  args[1] = entry;
  for (int i = 1; i < argc; i++) args[i + 1] = argv[i];
  execv(electron, args);
  int error = errno;
  perror("baocut-cli: launch Electron");
  free(args);
  return error == ENOENT ? 127 : 126;
}
