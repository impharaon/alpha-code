// keychain_rename — #1571:给 Electron safeStorage 的钥匙串条目改名(旧应用名 → 新应用名),**只改两个属性**。
//
// 为什么要原生:改名必须在 main 进程同步段、Chromium 第一次查钥匙串之前做完(第 0 步实测:ready 前后
// Chromium 会按应用名查条目,查不到就生成新的随机秘密)。`security` 命令行没有只改属性的子命令
// (`add-generic-password -U` 要提交密码数据),所以走进程内 `SecItemUpdate`。
//
// 只做三件事,全部不读、不写秘密本身:
//   · keychainItemStatus(service, account) → OSStatus:存在性查询,查询字典里**没有任何**要求返回值的键,
//     结果指针传 NULL(第 0b 步实测:不弹框,约 5 ms);
//   · keychainRenameItem(fromService, fromAccount, toService, toAccount) → OSStatus:`SecItemUpdate`,
//     更新字典由 build_update_attributes 构造,**只有** kSecAttrService / kSecAttrAccount 两个键
//     (第 0b 步实测:新身份改旧身份建的条目不弹框;目标已存在返回 -25299 且两条都不变);
//   · keychainUpdateAttributeKeys() → string[]:用占位值调同一个 build_update_attributes,返回它的键名,
//     供测试证明更新字典里只有那两个键(不碰钥匙串)。
// 查询字典与 Chromium 自己的查询同形(class + service + account),不加 access group、不指定数据保护钥匙串。
// OSStatus 原样返回,由 main 的 keychain-name-migration.ts 解释;本文件不判断成败。
//
// 由 codepuppy_fence.c 的模块入口调用 register_keychain_exports 挂到同一个 .node 上,
// 沿用 scripts/build-fence-addon.ts 的构建(加链 Security / CoreFoundation)与打包签名链。

#define NAPI_VERSION 8
#include <node_api.h>

#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <stdlib.h>

napi_value register_keychain_exports(napi_env env, napi_value exports);

static CFMutableDictionaryRef new_dictionary(void) {
  return CFDictionaryCreateMutable(NULL, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
}

static void set_string(CFMutableDictionaryRef dictionary, CFStringRef key, const char *value) {
  CFStringRef text = CFStringCreateWithCString(NULL, value, kCFStringEncodingUTF8);
  CFDictionarySetValue(dictionary, key, text);
  CFRelease(text);
}

/* 定位一条 generic password:{class, service, account}。 */
static CFMutableDictionaryRef build_query(const char *service, const char *account) {
  CFMutableDictionaryRef query = new_dictionary();
  CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
  set_string(query, kSecAttrService, service);
  set_string(query, kSecAttrAccount, account);
  return query;
}

/* 改名的全部内容:只有 service 与 account 两个属性。 */
static CFMutableDictionaryRef build_update_attributes(const char *service, const char *account) {
  CFMutableDictionaryRef attributes = new_dictionary();
  set_string(attributes, kSecAttrService, service);
  set_string(attributes, kSecAttrAccount, account);
  return attributes;
}

static napi_value throw_and_null(napi_env env, const char *message) {
  napi_throw_error(env, NULL, message);
  return NULL;
}

/* 把一个 JS 字符串取成 UTF-8(malloc,调用方 free);不是字符串返回 NULL。 */
static char *string_arg(napi_env env, napi_value value) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok) return NULL;
  char *buffer = (char *)malloc(length + 1);
  if (!buffer) return NULL;
  size_t copied = 0;
  if (napi_get_value_string_utf8(env, value, buffer, length + 1, &copied) != napi_ok) {
    free(buffer);
    return NULL;
  }
  return buffer;
}

/* 取恰好 count 个字符串实参;失败已抛 JS 异常并返回 0。 */
static int string_args(napi_env env, napi_callback_info info, size_t count, char **out, const char *name) {
  napi_value argv[4];
  size_t argc = 4;
  for (size_t i = 0; i < count; i++) out[i] = NULL;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != count) {
    throw_and_null(env, name);
    return 0;
  }
  for (size_t i = 0; i < count; i++) {
    out[i] = string_arg(env, argv[i]);
    if (!out[i]) {
      for (size_t j = 0; j < i; j++) free(out[j]);
      throw_and_null(env, name);
      return 0;
    }
  }
  return 1;
}

static napi_value status_value(napi_env env, OSStatus status) {
  napi_value result;
  napi_create_int32(env, (int32_t)status, &result);
  return result;
}

/* keychainItemStatus(service, account): number */
static napi_value ItemStatus(napi_env env, napi_callback_info info) {
  char *args[2];
  if (!string_args(env, info, 2, args, "keychainItemStatus: expected (service: string, account: string)")) return NULL;
  CFMutableDictionaryRef query = build_query(args[0], args[1]);
  CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);
  OSStatus status = SecItemCopyMatching(query, NULL);
  CFRelease(query);
  free(args[0]);
  free(args[1]);
  return status_value(env, status);
}

/* keychainRenameItem(fromService, fromAccount, toService, toAccount): number */
static napi_value RenameItem(napi_env env, napi_callback_info info) {
  char *args[4];
  if (!string_args(env, info, 4, args,
                   "keychainRenameItem: expected (fromService, fromAccount, toService, toAccount) strings"))
    return NULL;
  CFMutableDictionaryRef query = build_query(args[0], args[1]);
  CFMutableDictionaryRef attributes = build_update_attributes(args[2], args[3]);
  OSStatus status = SecItemUpdate(query, attributes);
  CFRelease(query);
  CFRelease(attributes);
  for (int i = 0; i < 4; i++) free(args[i]);
  return status_value(env, status);
}

/* keychainUpdateAttributeKeys(): string[] —— 不碰钥匙串,只把更新字典的键名交给测试。 */
static napi_value UpdateAttributeKeys(napi_env env, napi_callback_info info) {
  (void)info;
  CFMutableDictionaryRef attributes = build_update_attributes("placeholder-service", "placeholder-account");
  CFIndex count = CFDictionaryGetCount(attributes);
  const void **keys = (const void **)malloc(sizeof(void *) * (size_t)(count > 0 ? count : 1));
  if (!keys) {
    CFRelease(attributes);
    return throw_and_null(env, "keychainUpdateAttributeKeys: out of memory");
  }
  CFDictionaryGetKeysAndValues(attributes, keys, NULL);
  napi_value array;
  napi_create_array_with_length(env, (size_t)count, &array);
  for (CFIndex i = 0; i < count; i++) {
    char name[64] = {0};
    CFStringGetCString((CFStringRef)keys[i], name, sizeof name, kCFStringEncodingUTF8);
    napi_value element;
    napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &element);
    napi_set_element(env, array, (uint32_t)i, element);
  }
  free(keys);
  CFRelease(attributes);
  return array;
}

static void export_function(napi_env env, napi_value exports, const char *name, napi_callback callback) {
  napi_value fn;
  napi_create_function(env, name, NAPI_AUTO_LENGTH, callback, NULL, &fn);
  napi_set_named_property(env, exports, name, fn);
}

napi_value register_keychain_exports(napi_env env, napi_value exports) {
  export_function(env, exports, "keychainItemStatus", ItemStatus);
  export_function(env, exports, "keychainRenameItem", RenameItem);
  export_function(env, exports, "keychainUpdateAttributeKeys", UpdateAttributeKeys);
  return exports;
}
