import { upstreamReds } from "./session-grant-upstream-reds.cases"

upstreamReds(
  "packages/core/test/tool-shell.test.ts",
  "the pinned bash-approval cases in tool-shell.test.ts are present and red",
  "bash-approvals",
)
