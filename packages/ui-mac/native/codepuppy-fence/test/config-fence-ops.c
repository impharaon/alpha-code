// SPEC-engine-config-fence AC-01 (DESIGN-engine-config-fence E1): every way a fenced process might change one protected
// configuration location. Test-only helper, compiled by process-fence-config-fence.cases.ts; never part of the product.
// It follows the design-time experiment program wops.c (design evidence kept outside the repository).
//   config-fence-ops <label> file <target> <ws>   target = a protected file (a literal location, or a file inside a protected directory)
//   config-fence-ops <label> dir <dir> <ws>       dir    = a protected directory
//   config-fence-ops <label> create <path> <ws>   path   = an absent protected location (literal)
//   config-fence-ops <label> ancestor <node> <ws> node   = an ancestor directory node of a protected location
//   config-fence-ops <label> vol <target> <ws>    target reached through /.vol/<dev>/<ino> spellings
// One line per attempt: "<label>:<op>\tOK" or "<label>:<op>\tFAIL <errno>". Anything an attempt manages to create is removed
// again (or moved back), so the next attempt is judged on its own. Operates only on the fake tree given on the command line.
#include <errno.h>
#include <fcntl.h>
#include <libgen.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/clonefile.h>
#include <sys/stat.h>
#include <unistd.h>

static const char *label;
static int report(const char *op, int rc) {
  if (rc < 0) printf("%s:%s\tFAIL %d\n", label, op, errno);
  else printf("%s:%s\tOK\n", label, op);
  return rc;
}
static int put(const char *path, const char *text) {
  int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) return -1;
  ssize_t n = write(fd, text, strlen(text));
  close(fd);
  return n < 0 ? -1 : 0;
}
static void dirof(const char *path, char *out, size_t size) {
  char copy[4096];
  snprintf(copy, sizeof copy, "%s", path);
  snprintf(out, size, "%s", dirname(copy));
}
static void baseof(const char *path, char *out, size_t size) {
  char copy[4096];
  snprintf(copy, sizeof copy, "%s", path);
  snprintf(out, size, "%s", basename(copy));
}

static void file_ops(const char *t, const char *ws) {
  char dir[4096], p[4096], q[4096];
  dirof(t, dir, sizeof dir);
  int fd = open(t, O_WRONLY | O_APPEND);
  if (fd >= 0) { (void)!write(fd, "X", 1); close(fd); }
  report("append", fd);
  fd = open(t, O_WRONLY | O_TRUNC);
  if (fd >= 0) close(fd);
  report("truncate", fd);
  snprintf(p, sizeof p, "%s/.cf-tmp", dir);
  if (put(p, "attacker") < 0) report("write-new-then-rename-over", -1);
  else { report("write-new-then-rename-over", rename(p, t)); unlink(p); }
  snprintf(q, sizeof q, "%s/cf-replacement", ws);
  put(q, "attacker");
  report("rename-workspace-file-over", rename(q, t));
  put(q, "attacker");
  report("swap", renamex_np(q, t, RENAME_SWAP));
  unlink(q);
  snprintf(q, sizeof q, "%s/cf-moved", ws);
  if (report("rename-away", rename(t, q)) == 0) rename(q, t);
  snprintf(q, sizeof q, "%s/cf-alias", ws);
  if (report("hardlink-alias", link(t, q)) == 0) unlink(q);
  report("chmod", chmod(t, 0666));
  // put a removed target back, so a later attempt on the same location (another spelling) is judged on its own
  if (report("unlink", unlink(t)) == 0) put(t, "restored");
}

static void dir_ops(const char *d, const char *ws) {
  char p[4096], src[4096], q[4096];
  snprintf(src, sizeof src, "%s/cf-src", ws);
  put(src, "attacker");
  snprintf(p, sizeof p, "%s/.cf-new", d);
  int fd = open(p, O_WRONLY | O_CREAT | O_EXCL, 0644);
  if (fd >= 0) { close(fd); unlink(p); }
  report("create-inside", fd);
  snprintf(p, sizeof p, "%s/.cf-child", d);
  if (report("mkdir-child", mkdir(p, 0755)) == 0) rmdir(p);
  snprintf(p, sizeof p, "%s/.cf-hard", d);
  if (report("hardlink-into", link(src, p)) == 0) unlink(p);
  snprintf(p, sizeof p, "%s/.cf-clone", d);
  if (report("clone-into", clonefile(src, p, 0)) == 0) unlink(p);
  snprintf(p, sizeof p, "%s/.cf-sym", d);
  if (report("symlink-into", symlink(src, p)) == 0) unlink(p);
  snprintf(q, sizeof q, "%s/cf-dir-moved", ws);
  if (report("rename-dir-away", rename(d, q)) == 0) rename(q, d);
  report("chmod-dir", chmod(d, 0777));
}

static void create_ops(const char *path, const char *ws) {
  char src[4096], q[4096];
  snprintf(src, sizeof src, "%s/cf-src", ws);
  put(src, "attacker");
  int fd = open(path, O_WRONLY | O_CREAT | O_EXCL, 0644);
  if (fd >= 0) { close(fd); unlink(path); }
  report("create", fd);
  if (report("symlink-at", symlink(src, path)) == 0) unlink(path);
  if (report("mkdir-at", mkdir(path, 0755)) == 0) rmdir(path);
  snprintf(q, sizeof q, "%s/cf-into", ws);
  put(q, "attacker");
  if (report("rename-into", rename(q, path)) == 0) unlink(path);
  unlink(q);
  if (report("hardlink-at", link(src, path)) == 0) unlink(path);
  if (report("clone-at", clonefile(src, path, 0)) == 0) unlink(path);
}

static void ancestor_ops(const char *node, const char *ws) {
  char q[4096];
  snprintf(q, sizeof q, "%s/cf-ancestor-moved", ws);
  if (report("rename-ancestor-away", rename(node, q)) == 0) rename(q, node);
}

static void vol_ops(const char *t, const char *ws) {
  char dir[4096], name[1024], p[4096], q[4096];
  struct stat file, parent;
  dirof(t, dir, sizeof dir);
  baseof(t, name, sizeof name);
  if (stat(t, &file) < 0 || stat(dir, &parent) < 0) { report("vol-stat", -1); return; }
  snprintf(p, sizeof p, "/.vol/%d/%llu", (int)file.st_dev, (unsigned long long)file.st_ino);
  int fd = open(p, O_WRONLY | O_APPEND);
  if (fd >= 0) { (void)!write(fd, "X", 1); close(fd); }
  report("vol-append", fd);
  snprintf(q, sizeof q, "%s/cf-vol-replacement", ws);
  put(q, "attacker");
  snprintf(p, sizeof p, "/.vol/%d/%llu/%s", (int)parent.st_dev, (unsigned long long)parent.st_ino, name);
  report("vol-rename-over", rename(q, p));
  unlink(q);
}

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IONBF, 0);
  if (argc < 5) { fprintf(stderr, "usage: config-fence-ops <label> <file|dir|create|ancestor|vol> <path> <ws>\n"); return 64; }
  label = argv[1];
  const char *mode = argv[2], *path = argv[3], *ws = argv[4];
  if (!strcmp(mode, "file")) file_ops(path, ws);
  else if (!strcmp(mode, "dir")) dir_ops(path, ws);
  else if (!strcmp(mode, "create")) create_ops(path, ws);
  else if (!strcmp(mode, "ancestor")) ancestor_ops(path, ws);
  else if (!strcmp(mode, "vol")) vol_ops(path, ws);
  else return 64;
  return 0;
}
