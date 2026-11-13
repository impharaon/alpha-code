// alpha-code#1669 r5: keep a test instance's windows off the owner's screen (orchestrator rule after the owner was
// disturbed by foreground test windows). Electron's CDP has no Browser.setWindowBounds, so this hides by pid with
// NSRunningApplication.hide() — the Cmd-H path, no Apple Events / Accessibility permission, so it cannot raise a prompt.
//   hide-app <pid> [seconds]   wait for the app with <pid> to register, then hide it; keep re-hiding for <seconds>
//                              (default 0 = once). Prints the final state. Exit 1 if the pid never registers.
// Build: clang -fobjc-arc -framework AppKit -o <out> hide-app.m
#import <AppKit/AppKit.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 2) { fprintf(stderr, "usage: hide-app <pid> [seconds]\n"); return 2; }
    pid_t pid = (pid_t)atoi(argv[1]);
    double keep = argc > 2 ? atof(argv[2]) : 0;
    NSRunningApplication *app = nil;
    for (int i = 0; i < 600 && !app; i++) {  // up to 60 s for the process to register with the window server
      app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
      if (!app) [NSThread sleepForTimeInterval:0.1];
    }
    if (!app) { printf("pid %d never registered as an application\n", pid); return 1; }
    NSDate *until = [NSDate dateWithTimeIntervalSinceNow:keep];
    int hides = 0;
    do {
      if (!app.hidden) { [app hide]; hides++; }
      [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    } while ([until timeIntervalSinceNow] > 0 && !app.terminated);
    printf("pid %d bundle=%s hidden=%s active=%s hide-calls=%d\n", pid, app.bundleIdentifier.UTF8String,
           app.hidden ? "yes" : "no", app.active ? "yes" : "no", hides);
    return 0;
  }
}
