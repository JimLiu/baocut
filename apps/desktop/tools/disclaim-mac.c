// Starts a program as its own "responsible process" for macOS privacy checks (TCC), keeping this PID.
// Usage: baocut-disclaim <program> [args...]
//
// A process started from a terminal is normally attributed to the terminal: Full Disk Access granted to
// BaoCut would not apply to it. With the disclaim attribute the program becomes responsible for itself,
// so the grant of the bundle that contains the program applies. POSIX_SPAWN_SETEXEC replaces this
// process instead of creating a child, so whoever spawned us still sees the same PID.
// The responsibility_* calls are private libSystem API (since macOS 10.14); if the call fails we still
// start the program, only without the attribute.
#include <errno.h>
#include <spawn.h>
#include <stdio.h>
#include <unistd.h>

extern char **environ;
extern int responsibility_spawnattrs_setdisclaim(posix_spawnattr_t *attrs, int disclaim);

int main(int argc, char **argv) {
  if (argc < 2) {
    fputs("usage: baocut-disclaim <program> [args...]\n", stderr);
    return 2;
  }
  posix_spawnattr_t attrs;
  if (posix_spawnattr_init(&attrs) == 0) {
    if (posix_spawnattr_setflags(&attrs, POSIX_SPAWN_SETEXEC) == 0 && responsibility_spawnattrs_setdisclaim(&attrs, 1) == 0) {
      // Returns only on failure.
      int error = posix_spawn(NULL, argv[1], NULL, &attrs, argv + 1, environ);
      fprintf(stderr, "baocut-disclaim: spawn with disclaim failed (%d), starting without it\n", error);
    }
    posix_spawnattr_destroy(&attrs);
  }
  execv(argv[1], argv + 1);
  int error = errno;
  perror("baocut-disclaim: launch");
  return error == ENOENT ? 127 : 126;
}
