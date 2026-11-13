// alpha-code#1669 isolation gate helper: can this process look up the named mach services?
// Lookup only; it never sends a message, so it cannot start or wake the service.
// Prints one line per name; exit code = number of names that were reachable.
#include <mach/mach.h>
#include <servers/bootstrap.h>
#include <stdio.h>

int main(int argc, char **argv) {
  int reachable = 0;
  for (int i = 1; i < argc; i++) {
    mach_port_t port = MACH_PORT_NULL;
    kern_return_t kr = bootstrap_look_up(bootstrap_port, argv[i], &port);
    printf("%s kr=%d %s\n", argv[i], kr, kr == KERN_SUCCESS ? "reachable" : "unreachable");
    if (kr == KERN_SUCCESS) reachable++;
    if (port != MACH_PORT_NULL) mach_port_deallocate(mach_task_self(), port);
  }
  return reachable;
}
