// codepuppy_fence — REQ-159 (`#1321`):让引擎 sidecar 进程把**自己**关进 seatbelt。
//
// 为什么要一个原生模块:出货 sidecar 是 Electron 的 utilityProcess(node 运行时),node 没有内置
// FFI,而 `utilityProcess.fork` 的 ForkOptions 没有任何指定可执行文件的字段,`sandbox-exec` 插不进
// 启动点(勘破 §6.6)。唯一落点 = 进程内调 libsandbox 的 `sandbox_init`,即 `sandbox-exec` 自己
// 用的那条 SPI(勘破 §6.6 P1;U1 `#1316` 在签名 + hardened runtime 的出货包里实测加载得了、调得动)。
// 项目运行期放行追加绑定目标进程的签发与消费;类名和资格仍由 TypeScript 调用方持有。
//
// 本模块**不决定**可写集 —— profile 文本由 main 进程的 process-fence-profile.ts(单一权威)渲染、
// 试编译后经 StartCommand 交给 sidecar,这里只把那串字节原样交给内核。它做的事只有三件:
//   1. dlopen libsandbox(dyld 共享缓存里的名字;`/usr/lib/libsandbox.1.dylib` 在盘上不存在,勘破 §8.7);
//   2. dlsym `sandbox_init` 与 `sandbox_free_error`;
//   3. `apply(profile)` → `{ rc, error }`。rc ≠ 0 时 error 是 libsandbox 自己的编译/应用错误原文
//      (例如 `data object length 70173 exceeds maximum (65535)`),调用方据此 fail-closed。
//
// 失败方向全部响亮:dlopen / dlsym 失败在 `apply` 里抛 JS 异常(带 dlerror 原文),不返回 rc=0。
// 头文件来自 node-api-headers(devDependency,钉版),不依赖本机装了哪个 node。
// 构建:scripts/build-fence-addon.ts(fat binary:arm64 + x86_64 同一个文件,两片缺一即构建失败)。
// 同一个 .node 还挂着 keychain_rename.c 的钥匙串改名函数(#1571,main 进程用)。

#define NAPI_VERSION 8
#include <node_api.h>

#include <dlfcn.h>
#include <errno.h>
#include <limits.h>
#include <mach/mach.h>
#include <math.h>
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#ifndef CODEPUPPY_FENCE_BUILD_ID
#define CODEPUPPY_FENCE_BUILD_ID "unversioned"
#endif

/* libsandbox SPI(Apple 标记 deprecated,与 REQ-138 用的 sandbox-exec 同一条既有风险)。 */
typedef int (*sandbox_init_fn)(const char *profile, uint64_t flags, char **errorbuf);
typedef void (*sandbox_free_error_fn)(char *errorbuf);
typedef char *(*sandbox_issue_file_to_process_fn)(const char *, const char *, uint32_t, audit_token_t);
typedef int64_t (*sandbox_consume_fn)(const char *);

static const char *LIBSANDBOX = "/usr/lib/libsandbox.1.dylib";
static void *sandbox_library;

/* keychain_rename.c */
napi_value register_keychain_exports(napi_env env, napi_value exports);

static napi_value throw_and_null(napi_env env, const char *message) {
  napi_throw_error(env, NULL, message);
  return NULL;
}

static void *load_sandbox(napi_env env) {
  if (sandbox_library) return sandbox_library;
  sandbox_library = dlopen(LIBSANDBOX, RTLD_NOW);
  if (!sandbox_library) {
    const char *why = dlerror();
    char buf[512];
    snprintf(buf, sizeof buf, "codepuppy_fence: dlopen(%s) failed: %s", LIBSANDBOX, why ? why : "unknown");
    napi_throw_error(env, NULL, buf);
  }
  return sandbox_library;
}

/* Embedded NULs cannot be passed to the SPI as a truncated path, class, or token. */
static char *string_argument(napi_env env, napi_value value) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok || !length) {
    napi_throw_type_error(env, NULL, "codepuppy_fence: expected a nonempty string");
    return NULL;
  }
  char *text = malloc(length + 1);
  if (!text) { napi_throw_error(env, NULL, "codepuppy_fence: out of memory"); return NULL; }
  size_t copied = 0;
  if (napi_get_value_string_utf8(env, value, text, length + 1, &copied) != napi_ok || copied != length || memchr(text, 0, length)) {
    free(text);
    napi_throw_type_error(env, NULL, "codepuppy_fence: invalid string argument");
    return NULL;
  }
  return text;
}

static napi_value issue_failure(napi_env env, int code, const char *step) {
  napi_value result, token, number, label;
  napi_create_object(env, &result);
  napi_get_null(env, &token);
  napi_create_int32(env, code, &number);
  napi_create_string_utf8(env, step, NAPI_AUTO_LENGTH, &label);
  napi_set_named_property(env, result, "token", token);
  napi_set_named_property(env, result, "errno", number);
  napi_set_named_property(env, result, "step", label);
  return result;
}

/* Main only. The audit token includes pidversion, so a later process cannot replay the grant. */
static napi_value IssueFileExtensionToProcess(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 3)
    return throw_and_null(env, "codepuppy_fence.issueFileExtensionToProcess: expected class, path, pid");
  double pid;
  if (napi_get_value_double(env, argv[2], &pid) != napi_ok || !isfinite(pid) || pid <= 0 || pid > INT_MAX || floor(pid) != pid)
    return throw_and_null(env, "codepuppy_fence.issueFileExtensionToProcess: pid must be a positive integer");
  char *cls = string_argument(env, argv[0]);
  if (!cls) return NULL;
  char *path = string_argument(env, argv[1]);
  if (!path) { free(cls); return NULL; }
  void *lib = load_sandbox(env);
  if (!lib) { free(cls); free(path); return NULL; }
  sandbox_issue_file_to_process_fn issue = (sandbox_issue_file_to_process_fn)dlsym(lib, "sandbox_extension_issue_file_to_process");
  if (!issue) { free(cls); free(path); return throw_and_null(env, "codepuppy_fence: libsandbox is missing sandbox_extension_issue_file_to_process"); }
  mach_port_t task = MACH_PORT_NULL;
  kern_return_t rc = task_name_for_pid(mach_task_self(), (pid_t)pid, &task);
  if (rc != KERN_SUCCESS) { free(cls); free(path); return issue_failure(env, rc, "task_name_for_pid"); }
  audit_token_t audit;
  mach_msg_type_number_t count = TASK_AUDIT_TOKEN_COUNT;
  rc = task_info(task, TASK_AUDIT_TOKEN, (task_info_t)&audit, &count);
  mach_port_deallocate(mach_task_self(), task);
  if (rc != KERN_SUCCESS) { free(cls); free(path); return issue_failure(env, rc, "task_info"); }
  errno = 0;
  char *token = issue(cls, path, 0, audit);
  int code = errno;
  free(cls);
  free(path);
  if (!token) return issue_failure(env, code, "issue");
  napi_value result, value;
  napi_create_object(env, &result);
  napi_create_string_utf8(env, token, NAPI_AUTO_LENGTH, &value);
  napi_set_named_property(env, result, "token", value);
  free(token);
  return result;
}

static napi_value ConsumeExtension(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 1)
    return throw_and_null(env, "codepuppy_fence.consumeExtension: expected token");
  char *token = string_argument(env, argv[0]);
  if (!token) return NULL;
  void *lib = load_sandbox(env);
  if (!lib) { free(token); return NULL; }
  sandbox_consume_fn consume = (sandbox_consume_fn)dlsym(lib, "sandbox_extension_consume");
  if (!consume) { free(token); return throw_and_null(env, "codepuppy_fence: libsandbox is missing sandbox_extension_consume"); }
  errno = 0;
  const int64_t handle = consume(token);
  const int code = handle < 0 ? errno : 0;
  free(token);
  napi_value result, value, error;
  napi_create_object(env, &result);
  napi_create_int64(env, handle, &value);
  napi_create_int32(env, code, &error);
  napi_set_named_property(env, result, "handle", value);
  napi_set_named_property(env, result, "errno", error);
  return result;
}

/* apply(profile: string): { rc: number, error: string } */
static napi_value Apply(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 1)
    return throw_and_null(env, "codepuppy_fence.apply: expected one string argument (profile)");

  size_t len = 0;
  if (napi_get_value_string_utf8(env, argv[0], NULL, 0, &len) != napi_ok)
    return throw_and_null(env, "codepuppy_fence.apply: profile must be a string");
  char *profile = (char *)malloc(len + 1);
  if (!profile) return throw_and_null(env, "codepuppy_fence.apply: out of memory");
  size_t copied = 0;
  if (napi_get_value_string_utf8(env, argv[0], profile, len + 1, &copied) != napi_ok) {
    free(profile);
    return throw_and_null(env, "codepuppy_fence.apply: profile must be a string");
  }

  void *lib = load_sandbox(env);
  if (!lib) {
    free(profile);
    return NULL;
  }
  sandbox_init_fn init = (sandbox_init_fn)dlsym(lib, "sandbox_init");
  sandbox_free_error_fn free_error = (sandbox_free_error_fn)dlsym(lib, "sandbox_free_error");
  if (!init || !free_error) {
    free(profile);
    return throw_and_null(env, "codepuppy_fence.apply: libsandbox is missing sandbox_init / sandbox_free_error");
  }

  char *errorbuf = NULL;
  int rc = init(profile, 0, &errorbuf);
  free(profile);

  napi_value result, rc_value, error_value;
  napi_create_object(env, &result);
  napi_create_int32(env, rc, &rc_value);
  napi_set_named_property(env, result, "rc", rc_value);
  const char *error_text = errorbuf ? errorbuf : "";
  napi_create_string_utf8(env, error_text, NAPI_AUTO_LENGTH, &error_value);
  napi_set_named_property(env, result, "error", error_value);
  if (errorbuf) free_error(errorbuf);
  return result;
}

NAPI_MODULE_INIT() {
  napi_value apply_fn, issue_fn, consume_fn, build_id, lib_name;
  napi_create_function(env, "apply", NAPI_AUTO_LENGTH, Apply, NULL, &apply_fn);
  napi_set_named_property(env, exports, "apply", apply_fn);
  napi_create_function(env, "issueFileExtensionToProcess", NAPI_AUTO_LENGTH, IssueFileExtensionToProcess, NULL, &issue_fn);
  napi_set_named_property(env, exports, "issueFileExtensionToProcess", issue_fn);
  napi_create_function(env, "consumeExtension", NAPI_AUTO_LENGTH, ConsumeExtension, NULL, &consume_fn);
  napi_set_named_property(env, exports, "consumeExtension", consume_fn);
  napi_create_string_utf8(env, CODEPUPPY_FENCE_BUILD_ID, NAPI_AUTO_LENGTH, &build_id);
  napi_set_named_property(env, exports, "buildId", build_id);
  napi_create_string_utf8(env, LIBSANDBOX, NAPI_AUTO_LENGTH, &lib_name);
  napi_set_named_property(env, exports, "libsandbox", lib_name);
  return register_keychain_exports(env, exports);
}
