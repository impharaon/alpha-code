import { join } from "node:path"
import opencode from "./opencode/provenance.json"
import npm from "./opencode/npm/provenance.json"
import { fixtureRoot } from "./fixture"
const marketplace = () => Bun.file(join(fixtureRoot, ".claude-plugin/marketplace.json")).text()
const archive = () => Bun.file(join(fixtureRoot, "claude-selection.tar.gz")).arrayBuffer()
export async function fixtureFetch(url: string | URL | Request): Promise<Response> {
  const address = String(url)
  // DESIGN-domestic-cloud-connectivity §4.7:市场清单先请求香港转发入口。本夹具只录了原地址的字节,转发地址一律回 404,
  // 于是用它的用例走「转发不可用 ⇒ 改取原地址」;转发成功的一臂在 plugin-sources.test.ts 的 §4.7 用例里单独判。
  if (address.startsWith("https://alpha-github-hk.tidelabs.click/")) return new Response("not recorded", { status: 404 })
  if (address === "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json") return new Response(await marketplace())
  if (address === "https://codeload.github.com/anthropics/claude-plugins-official/tar.gz/refs/heads/main") return new Response(await archive())
  if (address === "https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json") return new Response(await Bun.file(join(fixtureRoot, "codex/.agents/plugins/marketplace.json")).bytes())
  if (address === "https://codeload.github.com/openai/plugins/tar.gz/refs/heads/main") return new Response(await Bun.file(join(fixtureRoot, "codex/selection.tar.gz")).bytes())
  if (address.startsWith("https://registry.modelcontextprotocol.io/v0.1/servers?")) return new Response(await Bun.file(join(fixtureRoot, "registry", address.includes("search=io.github.github%2Fgithub-mcp-server") ? "github-registry-search.json" : "empty-search.json")).bytes())
  if (address === "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.github%2Fgithub-mcp-server/versions/2.1.0") return new Response(await Bun.file(join(fixtureRoot, "registry/github-registry-version.json")).bytes())
  if (address.startsWith("https://registry.npmjs.org/-/v1/search?")) {
    const page = await Bun.file(join(fixtureRoot, "opencode/npm", address.includes("text=skills") ? "search.json" : "empty-search.json")).json()
    // Scope the recorded index to these actual objects for skills; control other queries as no-match records.
    return Response.json({ ...page, objects: address.includes("text=skills") ? page.objects : [], total: address.includes("text=skills") ? page.objects.length : 0 })
  }
  if (address === "https://registry.npmjs.org/opencode-skills-hub/0.0.5") return new Response(await Bun.file(join(fixtureRoot, "opencode/npm/metadata.json")).bytes())
  if (address === npm.tarballUrl) return new Response(await Bun.file(join(fixtureRoot, "opencode/npm/package.tgz")).bytes())
  for (const tree of opencode.trees) if (address === "https://codeload.github.com/" + tree.repository.slice("https://github.com/".length) + "/tar.gz/" + tree.commit) return new Response(await Bun.file(join(fixtureRoot, "opencode", tree.root, tree.archive.path)).bytes())
  throw new Error(`unexpected fixture URL: ${address}`)
}
