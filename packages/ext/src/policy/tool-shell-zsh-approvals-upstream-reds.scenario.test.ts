import { upstreamReds } from "./session-grant-upstream-reds.cases"

upstreamReds(
  "packages/core/test/tool-shell.test.ts",
  "the pinned zsh-approval cases in tool-shell.test.ts are present and red",
  "zsh-approvals",
)
