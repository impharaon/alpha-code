export type PackageManagerWord = { start: number; end: number; raw: string; value: string }
export type PackageManagerSyntax =
  | { kind: "command"; words: PackageManagerWord[]; redirects: { start: number; end: number }[]; command: number; builtin: number; negated: boolean; opaque: boolean }
  | { kind: "separator"; value: string }
  | { kind: "group"; events: PackageManagerSyntax[]; subshell: boolean; start: number; end: number }
