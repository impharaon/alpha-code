// alpha-code#1669: does the shipped process-fence addon's apply() work when the process is already inside an outer
// seatbelt (the isolation guard)? Same call the engine sidecar makes (packages/ui-mac/src/main/process-fence-apply.ts).
// argv: <path to codepuppy_fence.node>. The profile is allow-all, so a refusal can only come from nesting.
const [addonPath] = process.argv.slice(2)
const mod = { exports: {} }
process.dlopen(mod, addonPath)
const result = mod.exports.apply("(version 1)\n(allow default)\n")
console.log(JSON.stringify({ node: process.version, electron: process.versions.electron ?? null, buildId: mod.exports.buildId, rc: result.rc, error: result.error }))
