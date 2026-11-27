import { packageManagerShellSource } from "../engine/package-manager-shell-transform"

let installed = false

/**
 * The production engine build (scripts/build-engine.ts) rewrites these Core/Plugin files for the prepared-Shell seam (H2);
 * the real ext delegates through it, so an engine loaded from source in a test gets the same rewrite. Call before the
 * engine or ext modules are imported.
 */
export function installPreparedShellSeam() {
  if (installed) return
  installed = true
  Bun.plugin({
    name: "prepared-shell-seam",
    setup(build) {
      build.onLoad({ filter: /\/packages\/(?:core\/src\/(?:shell|plugin\/hooks|plugin\/host|tool\/plugin\/shell)|plugin\/src\/(?:effect\/shell|promise\/shell|promise\/adapter))\.ts$/ }, async (args) => {
        const code = await Bun.file(args.path).text()
        return { contents: packageManagerShellSource(code, args.path) ?? code, loader: "ts" }
      })
    },
  })
}
