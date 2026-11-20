// SPEC-stored-credentials-fence AC-03 的已知的坏(stored-credentials-fence.engine.test.ts 的 widen 臂,只经 `--preload` 装):装载时把
// util codepuppy-credentials.ts 的 resolveCodePuppyCredentialRefs 改成「全文代入」—— 文本里每个指向表里某项的 `{file:}` 都换成值,不看位置与绑定。
// 锚点文本不在 ⇒ 抛(变异没落地就不算证明)。不进产品。
import { plugin } from "bun"

const ANCHOR = 'if (!table || !text.includes("{file:")) return text'
const WIDEN = `
  return text.replace(FILE_REF, (token: string, file: string) => {
    const entry = table[path.resolve(file)]
    return entry ? JSON.stringify(entry.value.trim()).slice(1, -1) : token
  })`

plugin({
  name: "scf-widen-credential-refs",
  setup(build) {
    build.onLoad({ filter: /packages\/util\/src\/codepuppy-credentials\.ts$/ }, async (args) => {
      const source = await Bun.file(args.path).text()
      if (!source.includes(ANCHOR)) throw new Error("widen preload: the anchor in resolveCodePuppyCredentialRefs is gone — the known-bad arm would prove nothing")
      return { contents: source.replace(ANCHOR, ANCHOR + WIDEN), loader: "ts" }
    })
  },
})
