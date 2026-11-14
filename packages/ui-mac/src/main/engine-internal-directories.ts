// `#1669`:引擎项目表里属于 Code Puppy 自己的两个目录,按 main 持有的路径给出(界面的项目清单据此认,不按文件夹名猜)。
//
//   · scratch:引擎进程的工作目录(server.ts fork 时的 cwd)。不带目录的引擎请求都落在这里,2.x 因此给它登记一个项目。
//   · defaultWorkspace:默认对话目录(ADR-025,codepuppyUserWorkspaceDir 给出的路径)。sidecar 启动预热就打开它,所以全新数据上也有它的项目。
//
// 引擎记的是 realpath 之后的路径(`@opencode/util/fs-util` 的 resolve),所以每项给出字面路径与 realpath(3) 两种写法。
import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import type { EngineInternalDirectories } from "../preload/types"
import { codepuppyUserWorkspaceDir } from "./codepuppy-user-workspace"
import { resolveEngineScratchCwd } from "./engine-scratch-cwd"

function spellings(directory: string): string[] {
  const literal = resolve(directory)
  try {
    return [...new Set([literal, realpathSync.native(literal)])]
  } catch {
    return [literal]
  }
}

export function engineInternalDirectories(userDataPath: string): EngineInternalDirectories {
  return {
    scratch: spellings(resolveEngineScratchCwd(userDataPath)),
    defaultWorkspace: spellings(codepuppyUserWorkspaceDir()),
  }
}
