/* G0 attack fixtures derived from fence-ext/src/r1.c and the corrected six-argument r1d.c,
 * collected 2026-11-19 on macOS 26.3.1. This executable inherits the production sidecar's
 * sandbox; it never installs a substitute profile. Tokens are never printed or persisted. */
#include <errno.h>
#include <fcntl.h>
#include <mach/mach.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern int64_t sandbox_extension_consume(const char *);
extern char *sandbox_extension_issue_file(const char *, const char *, uint32_t);
extern char *sandbox_extension_issue_file_to_self(const char *, const char *, uint32_t);
extern char *sandbox_extension_issue_file_to_process(const char *, const char *, uint32_t, audit_token_t);
extern char *sandbox_extension_issue_file_to_process_by_pid(const char *, const char *, uint32_t, pid_t);
extern char *sandbox_extension_issue_related_file_to_process(const char *, const char *, const char *, const char *, uint32_t, audit_token_t);
extern char *sandbox_extension_issue_generic(const char *, uint32_t);
extern char *sandbox_extension_issue_generic_to_process(const char *, uint32_t, audit_token_t);
extern char *sandbox_extension_issue_generic_to_process_by_pid(const char *, uint32_t, pid_t);
extern char *sandbox_extension_issue_mach(const char *, const char *, uint32_t);
extern char *sandbox_extension_issue_mach_to_process(const char *, const char *, uint32_t, audit_token_t);
extern char *sandbox_extension_issue_mach_to_process_by_pid(const char *, const char *, uint32_t, pid_t);
extern char *sandbox_extension_issue_iokit_registry_entry_class(const char *, const char *, uint32_t);
extern char *sandbox_extension_issue_iokit_registry_entry_class_to_process(const char *, const char *, uint32_t, audit_token_t);
extern char *sandbox_extension_issue_iokit_registry_entry_class_to_process_by_pid(const char *, const char *, uint32_t, pid_t);
extern int sandbox_issue_fs_extension(const char *, uint64_t, char **);
extern int sandbox_issue_mach_extension(const char *, char **);

static void probe(const char *cls, const char *directory, const char *kind) {
  audit_token_t audit = {0};
  mach_msg_type_number_t count = TASK_AUDIT_TOKEN_COUNT;
  if (task_info(mach_task_self(), TASK_AUDIT_TOKEN, (task_info_t)&audit, &count)) _exit(3);
  char *token = NULL;
  errno = 0;
  if (!strcmp(kind, "file")) token = sandbox_extension_issue_file(cls, directory, 0);
  if (!strncmp(kind, "bit", 3)) token = sandbox_extension_issue_file(cls, directory, 1u << atoi(kind + 3));
  if (!strcmp(kind, "file-self")) token = sandbox_extension_issue_file_to_self(cls, directory, 0);
  if (!strcmp(kind, "file-process")) token = sandbox_extension_issue_file_to_process(cls, directory, 0, audit);
  if (!strcmp(kind, "file-pid")) token = sandbox_extension_issue_file_to_process_by_pid(cls, directory, 0, getpid());
  if (!strncmp(kind, "related-", 8)) {
    char related[4096]; snprintf(related, sizeof related, "%s/related.txt", directory);
    const char *op = !strcmp(kind, "related-read") ? "file-read-data" : !strcmp(kind, "related-create") ? "file-write-create" : "file-write-data";
    token = sandbox_extension_issue_related_file_to_process(cls, directory, related, op, 0, audit);
  }
  if (!strcmp(kind, "generic")) token = sandbox_extension_issue_generic(cls, 0);
  if (!strcmp(kind, "generic-process")) token = sandbox_extension_issue_generic_to_process(cls, 0, audit);
  if (!strcmp(kind, "generic-pid")) token = sandbox_extension_issue_generic_to_process_by_pid(cls, 0, getpid());
  if (!strcmp(kind, "mach")) token = sandbox_extension_issue_mach(cls, "com.apple.system.logger", 0);
  if (!strcmp(kind, "mach-process")) token = sandbox_extension_issue_mach_to_process(cls, "com.apple.system.logger", 0, audit);
  if (!strcmp(kind, "mach-pid")) token = sandbox_extension_issue_mach_to_process_by_pid(cls, "com.apple.system.logger", 0, getpid());
  if (!strcmp(kind, "iokit")) token = sandbox_extension_issue_iokit_registry_entry_class(cls, "IOService", 0);
  if (!strcmp(kind, "iokit-process")) token = sandbox_extension_issue_iokit_registry_entry_class_to_process(cls, "IOService", 0, audit);
  if (!strcmp(kind, "iokit-pid")) token = sandbox_extension_issue_iokit_registry_entry_class_to_process_by_pid(cls, "IOService", 0, getpid());
  if (!strcmp(kind, "legacy-file")) sandbox_issue_fs_extension(directory, 3, &token);
  if (!strcmp(kind, "legacy-mach")) sandbox_issue_mach_extension("com.apple.system.logger", &token);
  const int issue_errno = errno;
  const int64_t handle = token ? sandbox_extension_consume(token) : -2;
  char file[4096]; snprintf(file, sizeof file, "%s/%s.txt", directory, kind);
  const int fd = open(file, O_WRONLY | O_CREAT | O_EXCL, 0600);
  const int write_errno = fd < 0 ? errno : 0;
  if (fd >= 0) close(fd);
  printf("{\"kind\":\"%s\",\"pid\":%d,\"issued\":%s,\"issueErrno\":%d,\"handle\":%lld,\"writeErrno\":%d}\n", kind, getpid(), token ? "true" : "false", issue_errno, (long long)handle, write_errno);
  free(token);
}

static int isolated(const char *cls, const char *directory, const char *kind) {
  pid_t pid = fork();
  if (pid < 0) return 2;
  if (!pid) { probe(cls, directory, kind); _exit(0); }
  int status;
  if (waitpid(pid, &status, 0) != pid || !WIFEXITED(status)) return 3;
  return WEXITSTATUS(status);
}

int main(int argc, char **argv) {
  if (argc != 4) return 2;
  setvbuf(stdout, NULL, _IONBF, 0);
  if (strcmp(argv[3], "all")) return isolated(argv[1], argv[2], argv[3]);
  const char *kinds[] = {"file", "file-self", "file-process", "file-pid", "related-read", "related-write", "related-create", "generic", "generic-process", "generic-pid", "mach", "mach-process", "mach-pid", "iokit", "iokit-process", "iokit-pid", "legacy-file", "legacy-mach", NULL};
  for (int i = 0; kinds[i]; i++) if (isolated(argv[1], argv[2], kinds[i])) return 3;
  for (int i = 0; i < 32; i++) { char kind[20]; snprintf(kind, sizeof kind, "bit%d", i); if (isolated(argv[1], argv[2], kind)) return 3; }
  return 0;
}
