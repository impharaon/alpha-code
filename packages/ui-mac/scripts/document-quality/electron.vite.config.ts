// Builds the document-quality measurement host (host.ts) with the product's own main-process build: same plugins, defines and
// externals; only the entries and the output directory differ. out/document-quality/ has the depth of out/main/, so the
// product's dev path derivations (resources, ext dist, native addons) resolve the same way.
import { defineConfig } from "electron-vite"
import product from "../../electron.vite.config"

const main = product.main!
export default defineConfig({
  main: {
    ...main,
    build: {
      ...main.build,
      outDir: "out/document-quality",
      rollupOptions: {
        ...main.build?.rollupOptions,
        input: { "document-quality-host": "scripts/document-quality/host.ts", sidecar: "src/main/sidecar.ts" },
      },
    },
  },
})
