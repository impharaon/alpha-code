import path from "node:path"

export * as ProtectedFiles from "./codepuppy-protected-files.js"

export type PathPlatform = "darwin" | "win32"
export type ProtectedFormat = "env" | "ini" | "json" | "assignments" | "netrc" | "credential-url" | "sqlite" | "opaque"
export type CredentialProfile =
  | "env"
  | "credential-document"
  | "private-key"
  | "aws"
  | "docker"
  | "kube"
  | "npm"
  | "pypi"
  | "netrc"
  | "git-credentials"
  | "gcp-adc"
  | "gcp-credentials"
  | "gcp-access-tokens"
  | "azure"
  | "chromium-state"
  | "chromium-logins"
  | "chromium-cookies"
  | "firefox-logins"
  | "firefox-cookies"
  | "encrypted-store"
export type ProtectedPathVariable =
  | "AWS_SHARED_CREDENTIALS_FILE"
  | "AWS_CONFIG_FILE"
  | "DOCKER_CONFIG"
  | "KUBECONFIG"
  | "GNUPGHOME"
  | "GOOGLE_APPLICATION_CREDENTIALS"
  | "CLOUDSDK_CONFIG"
  | "AZURE_CONFIG_DIR"
export type ProtectedRoots = {
  platform: PathPlatform
  project: string
  directory: string
  home: string
  appData: string
  localAppData: string
  pathVariables: Readonly<Partial<Record<ProtectedPathVariable, string>>>
}
export type ProtectedFile = {
  rule: string
  path: string
  format: ProtectedFormat
  profile: CredentialProfile
  view: "variables" | "notice"
}

export const REDACTED = "[REDACTED]"
export const PROTECTED_FILE_TEXT = "这是密钥文件，值不提供给助手；程序运行时照常能用。"
export const MASKING_FAILED_TEXT = "这次输出没能遮盖，已隐藏"

const SECRET_WORDS = new Set([
  "KEY",
  "TOKEN",
  "SECRET",
  "PASS",
  "PASSWORD",
  "PASSWD",
  "CREDENTIAL",
  "CREDENTIALS",
  "AUTH",
  "AUTHORIZATION",
  "PRIVATE",
])
const GCP_FIELDS = [
  ["**", "refresh_token"],
  ["**", "client_secret"],
  ["**", "private_key"],
  ["**", "password"],
  ["**", "access_token"],
  ["**", "id_token"],
  ["**", "rapt_token"],
] as const

// Selectors are release data, not parsers. * selects one object/array member; ** selects any depth, including zero.
export const CredentialFields = {
  env: { assignments: "all" },
  "credential-document": { names: "credential" },
  "private-key": { raw: "private-key" },
  "encrypted-store": { raw: "bytes" },
  "chromium-state": { json: [["os_crypt", "encrypted_key"]] },
  docker: {
    json: [
      ["auths", "*", "auth"],
      ["auths", "*", "identitytoken"],
    ],
  },
  kube: {
    json: [
      ...["token", "client-key-data", "password"].map((name) => ["users", "*", "user", name] as const),
      ...["access-token", "refresh-token", "client-secret", "id-token"].map(
        (name) => ["users", "*", "user", "auth-provider", "config", name] as const,
      ),
    ],
  },
  aws: {
    assignments: [
      "aws_access_key_id",
      "aws_secret_access_key",
      "aws_session_token",
      "session_token",
      "security_token",
      "aws_*_key",
    ],
    json: [
      ...["accessToken", "refreshToken", "clientSecret"].map((name) => [name] as const),
      ...["AccessKeyId", "SecretAccessKey", "SessionToken"].map((name) => ["Credentials", name] as const),
    ],
  },
  npm: {
    assignments: [
      "_authToken",
      "*:_authToken",
      "_auth",
      "*:_auth",
      "_password",
      "*:_password",
      "password",
      "*:password",
    ],
  },
  pypi: { assignments: ["password"] },
  netrc: { assignments: ["password"] },
  "git-credentials": { url: ["password"] },
  "gcp-adc": { json: GCP_FIELDS },
  "gcp-credentials": { json: GCP_FIELDS, sqlite: [{ table: "credentials", columns: ["value"], json: GCP_FIELDS }] },
  "gcp-access-tokens": { sqlite: [{ table: "access_tokens", columns: ["access_token", "rapt_token", "id_token"] }] },
  azure: {
    json: [
      ...[
        "accessToken",
        "access_token",
        "refreshToken",
        "refresh_token",
        "secret",
        "client_secret",
        "client_assertion",
      ].map((name) => ["**", name] as const),
    ],
  },
  "firefox-logins": {
    json: [
      ["logins", "*", "encryptedUsername"],
      ["logins", "*", "encryptedPassword"],
    ],
  },
  "chromium-logins": { sqlite: [{ table: "logins", columns: ["password_value"] }] },
  "chromium-cookies": { sqlite: [{ table: "cookies", columns: ["value", "encrypted_value"] }] },
  "firefox-cookies": { sqlite: [{ table: "moz_cookies", columns: ["value"] }] },
} as const satisfies Record<CredentialProfile, object>

type Rule = {
  id: string
  include: readonly string[]
  exclude?: readonly string[]
  format: ProtectedFormat
  profile: CredentialProfile
}
type LocatedRule = Rule & { root: string }

const DEPENDENCIES = ["node_modules", "vendor", ".venv", "venv", "site-packages"].flatMap((name) => [
  `**/${name}`,
  `**/${name}/**`,
])
const PACKAGE_FILES = [
  rule("netrc", [".netrc", "_netrc"], "netrc", "netrc"),
  rule("npm", [".npmrc"], "assignments", "npm"),
  rule("pypi", [".pypirc"], "ini", "pypi"),
  rule("git-credentials", [".git-credentials"], "credential-url", "git-credentials"),
]
const PROJECT = [
  {
    ...rule("env", ["**/.env", "**/.env.*", "**/.envrc", "**/secret.env", "**/secrets.env"], "env", "env"),
    exclude: ["**/*.example", "**/*.sample", "**/*.template"],
  },
  rule("credential-json", ["**/secret.json", "**/secrets.json", "**/credentials.json"], "json", "credential-document"),
  rule(
    "credential-assignments",
    ["yaml", "yml", "toml"].flatMap((extension) => [`**/secret.${extension}`, `**/secrets.${extension}`]),
    "assignments",
    "credential-document",
  ),
  rule("project-private-key", ["**/*.pem"], "opaque", "private-key"),
  rule("project-key-container", ["**/*.p12", "**/*.pfx"], "opaque", "encrypted-store"),
  ...PACKAGE_FILES.map((item) => ({ ...item, include: item.include.map((pattern) => `**/${pattern}`) })),
]
const PROJECT_LOCATIONS = [
  rule("rails-key", ["config/master.key", "config/credentials/*.key"], "opaque", "private-key"),
  rule("rails-credentials", ["config/credentials*.yml.enc"], "opaque", "encrypted-store"),
]
const SSH = [
  {
    ...rule("ssh-private-key", ["**"], "opaque", "private-key"),
    exclude: ["**/*.pub", "**/authorized_keys", "**/known_hosts", "**/config"],
  },
]
const AWS = [
  rule("aws-credentials", ["credentials", "config"], "ini", "aws"),
  rule("aws-login-cache", ["sso/cache/**", "cli/cache/**"], "json", "aws"),
]
const DOCKER = [rule("docker", ["config.json"], "json", "docker")]
const KUBE = [rule("kube", ["config"], "assignments", "kube")]
const GNUPG = [rule("gnupg", ["private-keys-v1.d/**", "secring.gpg"], "opaque", "encrypted-store")]
const GCLOUD = [
  rule("gcp-adc", ["application_default_credentials.json"], "json", "gcp-adc"),
  rule("gcp-credentials", ["credentials.db", "credentials.db-wal", "credentials.db-shm"], "sqlite", "gcp-credentials"),
  rule(
    "gcp-access-tokens",
    ["access_tokens.db", "access_tokens.db-wal", "access_tokens.db-shm"],
    "sqlite",
    "gcp-access-tokens",
  ),
]
const AZURE = [
  rule("azure-encrypted", ["msal_token_cache*.bin", "service_principal_entries.bin"], "opaque", "encrypted-store"),
  rule("azure-tokens", ["msal_token_cache*", "accessTokens.json", "service_principal_entries.*"], "json", "azure"),
]
const CHROMIUM = [
  rule("chromium-state", ["Local State"], "json", "chromium-state"),
  rule(
    "chromium-logins",
    ["", "-wal", "-shm"].map((suffix) => `*/Login Data${suffix}`),
    "sqlite",
    "chromium-logins",
  ),
  rule(
    "chromium-cookies",
    ["", "-wal", "-shm"].flatMap((suffix) => [`*/Cookies${suffix}`, `*/Network/Cookies${suffix}`]),
    "sqlite",
    "chromium-cookies",
  ),
]
const FIREFOX = [
  rule("firefox-logins", ["*/logins.json"], "json", "firefox-logins"),
  rule(
    "firefox-cookies",
    ["", "-wal", "-shm"].map((suffix) => `*/cookies.sqlite${suffix}`),
    "sqlite",
    "firefox-cookies",
  ),
  rule(
    "firefox-keys",
    ["", "-wal", "-shm"].map((suffix) => `*/key4.db${suffix}`),
    "opaque",
    "encrypted-store",
  ),
]

export function sources(
  roots: ProtectedRoots,
): readonly { root: string; include: readonly string[]; exclude: readonly string[] }[] {
  const groups = new Map<string, { root: string; include: string[]; exclude: readonly string[] }>()
  for (const item of locatedRules(roots)) {
    const key = JSON.stringify([item.root, item.exclude ?? []])
    const group = groups.get(key)
    if (group) {
      group.include.push(...item.include)
      continue
    }
    groups.set(key, { root: item.root, include: [...item.include], exclude: item.exclude ?? [] })
  }
  return [...groups.values()].map((group) => ({ ...group, include: [...new Set(group.include)] }))
}

export function match(input: { path: string; roots: ProtectedRoots }): ProtectedFile | undefined {
  const file = normalize(input.path, input.roots)
  const api = input.roots.platform === "win32" ? path.win32 : path.posix
  const item = [...locatedRules(input.roots), ...outsideProjectRules(file, input.roots)].find((item) => {
    const relative = api.relative(item.root, file).replaceAll(api.sep, "/")
    if (!relative || relative === ".." || relative.startsWith("../") || api.isAbsolute(relative)) return false
    if (item.exclude?.some((pattern) => glob(relative, pattern, input.roots.platform))) return false
    return item.include.some((pattern) => glob(relative, pattern, input.roots.platform))
  })
  if (!item) return
  return {
    rule: item.id,
    path: file,
    format: item.format,
    profile: item.profile,
    view: item.profile === "env" ? "variables" : "notice",
  }
}

export function probe(input: { text: string; roots: ProtectedRoots }): readonly string[] {
  // Keep quoted paths with spaces, while also finding paths inside a quoted command/payload.
  const tokens = [...input.text.matchAll(/"([^"]*)"|'([^']*)'|([^\s"'`|;&()<>]+)/g)].flatMap((token) => {
    const value = token[1] ?? token[2] ?? token[3]
    return [value, ...value.split(/\s+/)]
  })
  const candidates = /^(?:[/\\]|[a-z]:[/\\]|~[/\\])/i.test(input.text) ? [input.text, ...tokens] : tokens
  return [
    ...new Set(
      candidates.flatMap((token) => {
        const value = token
          .replace(/^(?:--?[\w-]+|[a-zA-Z_]\w*)=/, "")
          .replace(/^@/, "")
          .replace(/^\$(?:HOME|\{HOME\})(?=[/\\]|$)/, () => input.roots.home)
        const item = match({ path: value, roots: input.roots })
        return item ? [item.rule] : []
      }),
    ),
  ]
}

export function isCredentialName(name: string): boolean {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .some((word) => SECRET_WORDS.has(word.toUpperCase()))
}

export function isPublicValue(input: { name: string; value: string | number | boolean | null }): boolean {
  if (isCredentialName(input.name)) return false
  if (input.value === null || typeof input.value === "boolean") return true
  if (typeof input.value === "number") return Number.isFinite(input.value)
  if (input.value === "") return true
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(input.value) && Number.isFinite(Number(input.value)))
    return true
  const value = input.value.toLowerCase()
  if (
    [
      "true",
      "false",
      "yes",
      "no",
      "on",
      "off",
      "trace",
      "debug",
      "info",
      "warn",
      "warning",
      "error",
      "fatal",
      "silent",
    ].includes(value)
  )
    return true
  if (["localhost", "localhost.localdomain", "::1", "[::1]"].includes(value)) return true
  if (/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+localhost$/.test(value)) return true
  if (/^127(?:\.\d{1,3}){3}$/.test(value) && value.split(".").every((part) => Number(part) <= 255)) return true
  return (
    ["NODE_ENV", "APP_ENV", "ENVIRONMENT"].includes(input.name.toUpperCase()) &&
    ["development", "dev", "test", "testing", "staging", "stage", "production", "prod", "local"].includes(value)
  )
}

function rule(id: string, include: readonly string[], format: ProtectedFormat, profile: CredentialProfile): Rule {
  return { id, include, format, profile }
}

function normalize(value: string, roots: ProtectedRoots): string {
  const api = roots.platform === "win32" ? path.win32 : path.posix
  const expanded = value === "~" || /^~[/\\]/.test(value) ? api.join(roots.home, value.slice(2)) : value
  if (roots.platform !== "win32") return api.resolve(roots.directory, expanded)
  return api.resolve(
    roots.directory,
    expanded
      .replaceAll("/", "\\")
      .replace(/^\\\\\?\\UNC\\/i, "\\\\")
      .replace(/^\\\\\?\\(?=[a-z]:\\)/i, ""),
  )
}

function glob(value: string, pattern: string, platform: PathPlatform): boolean {
  const expression = pattern
    .split(/(\*\*\/|\*\*|\*)/)
    .map((part) => {
      if (part === "**/") return "(?:.*/)?"
      if (part === "**") return ".*"
      if (part === "*") return "[^/]*"
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    })
    .join("")
  return new RegExp(`^${expression}$`, platform === "win32" ? "i" : "").test(value)
}

// Another project's files follow the same project rules (spec v5 BR-05). They are matched when a tool touches them and
// never scanned, so `sources` does not include this scope.
function outsideProjectRules(file: string, roots: ProtectedRoots): LocatedRule[] {
  const api = roots.platform === "win32" ? path.win32 : path.posix
  const relative = api.relative(normalize(roots.project, roots), file)
  if (relative !== ".." && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative)) return []
  const root = api.parse(file).root
  return [
    ...PROJECT,
    ...PROJECT_LOCATIONS.map((item) => ({ ...item, include: item.include.map((pattern) => `**/${pattern}`) })),
  ].map((item) => ({ ...item, root, exclude: [...(item.exclude ?? []), ...DEPENDENCIES] }))
}

function locatedRules(roots: ProtectedRoots): LocatedRule[] {
  const api = roots.platform === "win32" ? path.win32 : path.posix
  const at = (root: string, items: readonly Rule[], excluded: readonly string[] = []) =>
    items.map((item) => ({
      ...item,
      root: normalize(root, roots),
      exclude: [...(item.exclude ?? []), ...excluded],
    }))
  const file = (value: string | undefined, item: Rule) => {
    if (!value) return []
    const resolved = normalize(value, roots)
    return at(api.dirname(resolved), [{ ...item, include: [api.basename(resolved)] }])
  }
  const directory = (value: string | undefined, items: readonly Rule[]) => (value ? at(value, items) : [])
  return [
    ...file(roots.pathVariables.AWS_SHARED_CREDENTIALS_FILE, AWS[0]),
    ...file(roots.pathVariables.AWS_CONFIG_FILE, AWS[0]),
    ...directory(roots.pathVariables.DOCKER_CONFIG, DOCKER),
    ...(roots.pathVariables.KUBECONFIG?.split(api.delimiter)
      .filter(Boolean)
      .flatMap((value) => file(value, KUBE[0])) ?? []),
    ...directory(roots.pathVariables.GNUPGHOME, GNUPG),
    ...file(roots.pathVariables.GOOGLE_APPLICATION_CREDENTIALS, GCLOUD[0]),
    ...directory(roots.pathVariables.CLOUDSDK_CONFIG, GCLOUD),
    ...directory(roots.pathVariables.AZURE_CONFIG_DIR, AZURE),
    ...at(api.join(roots.home, ".ssh"), SSH),
    ...at(api.join(roots.home, ".aws"), AWS),
    ...at(api.join(roots.home, ".docker"), DOCKER),
    ...at(api.join(roots.home, ".kube"), KUBE),
    ...at(api.join(roots.home, ".azure"), AZURE),
    ...at(api.join(roots.home, ".gnupg"), GNUPG),
    ...at(
      roots.platform === "win32" ? api.join(roots.appData, "gcloud") : api.join(roots.home, ".config/gcloud"),
      GCLOUD,
    ),
    ...at(roots.home, PACKAGE_FILES),
    ...at(roots.project, PROJECT_LOCATIONS),
    ...(roots.platform === "win32"
      ? [
          ...at(api.join(roots.appData, "gnupg"), GNUPG),
          ...[roots.appData, roots.localAppData].flatMap((root) =>
            at(api.join(root, "Microsoft"), [
              rule("windows-credentials", ["Credentials/**", "Vault/**", "Protect/**"], "opaque", "encrypted-store"),
            ]),
          ),
        ]
      : at(api.join(roots.home, "Library", "Keychains"), [
          rule("keychain", ["**"], "opaque", "encrypted-store"),
        ])),
    ...(roots.platform === "win32"
      ? [
          "Google/Chrome/User Data",
          "Chromium/User Data",
          "Microsoft/Edge/User Data",
          "BraveSoftware/Brave-Browser/User Data",
        ].flatMap((root) => at(api.join(roots.localAppData, root), CHROMIUM))
      : ["Google/Chrome", "Chromium", "Microsoft Edge", "BraveSoftware/Brave-Browser"].flatMap((root) =>
          at(api.join(roots.appData, root), CHROMIUM),
        )),
    ...at(
      api.join(roots.appData, roots.platform === "win32" ? "Mozilla/Firefox/Profiles" : "Firefox/Profiles"),
      FIREFOX,
    ),
    ...at(roots.project, PROJECT, DEPENDENCIES),
  ]
}
