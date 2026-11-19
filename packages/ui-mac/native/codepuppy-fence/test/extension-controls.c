/* Test-only controls, from fence-ext/src/r1.c (update_file) and r2.c (unbound replay),
 * collected on macOS 26.3.1, 2026-11-19. Never linked into the production addon. */
#include <node_api.h>
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>

extern char *sandbox_extension_issue_file(const char *, const char *, uint32_t);
extern int sandbox_extension_update_file(int64_t, const char *);

static char *string(napi_env env, napi_value value) {
  size_t length;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok) return NULL;
  char *out = malloc(length + 1);
  if (!out) return NULL;
  napi_get_value_string_utf8(env, value, out, length + 1, &length);
  return out;
}

static napi_value IssueUnbound(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2], result;
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  char *cls = argc == 2 ? string(env, argv[0]) : NULL;
  char *path = argc == 2 ? string(env, argv[1]) : NULL;
  char *token = cls && path ? sandbox_extension_issue_file(cls, path, 0) : NULL;
  free(cls);
  free(path);
  if (!token) { napi_throw_error(env, NULL, "test unbound issue failed"); return NULL; }
  napi_create_string_utf8(env, token, NAPI_AUTO_LENGTH, &result);
  free(token);
  return result;
}

static napi_value Update(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2], result, rc_value, errno_value;
  int64_t handle;
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  char *path = argc == 2 ? string(env, argv[1]) : NULL;
  if (!path || napi_get_value_int64(env, argv[0], &handle) != napi_ok) {
    free(path); napi_throw_error(env, NULL, "test update expected handle, path"); return NULL;
  }
  errno = 0;
  int rc = sandbox_extension_update_file(handle, path);
  int error = errno;
  free(path);
  napi_create_object(env, &result);
  napi_create_int32(env, rc, &rc_value);
  napi_create_int32(env, error, &errno_value);
  napi_set_named_property(env, result, "rc", rc_value);
  napi_set_named_property(env, result, "errno", errno_value);
  return result;
}

NAPI_MODULE_INIT() {
  napi_value issue, update;
  napi_create_function(env, "issueUnbound", NAPI_AUTO_LENGTH, IssueUnbound, NULL, &issue);
  napi_create_function(env, "update", NAPI_AUTO_LENGTH, Update, NULL, &update);
  napi_set_named_property(env, exports, "issueUnbound", issue);
  napi_set_named_property(env, exports, "update", update);
  return exports;
}
