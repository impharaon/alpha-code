import { existsSync } from "node:fs"
import { codepuppyBootstrap, type CodePuppyBootstrap } from "../../util/src/codepuppy-bootstrap"
import { FILE_REF } from "@opencode/plugin/alpha-cloud-authority"
import { CLOUD_ACCESS_LOGIN_HINT } from "./context-injection"

/** 启动文档里治理云 MCP 定义的 Authorization(`Bearer {file:…}`);没有云 MCP ⇒ undefined(`#1698`)。 */
export function cloudMcpAuthorization(bootstrap: CodePuppyBootstrap = codepuppyBootstrap()): string | undefined {
  return bootstrap.cloudMcp?.definition.headers.Authorization
}

export function cloudAccessState(
  bootstrap: CodePuppyBootstrap = codepuppyBootstrap(),
  exists: (path: string) => boolean = existsSync,
): { state: "logged-out" | "credential-missing" | "ready"; loginHint: string } {
  const path = bootstrap.platform.modelProxyBaseURL ? FILE_REF.exec(cloudMcpAuthorization(bootstrap) ?? "")?.[1] : undefined
  return {
    state: !path ? "logged-out" : exists(path) ? "ready" : "credential-missing",
    loginHint: CLOUD_ACCESS_LOGIN_HINT,
  }
}
