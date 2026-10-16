import { expect, test } from "bun:test"
import { resolve } from "node:path"

test("AC2 上游 provider 对话框经生产补丁与 main IPC 的组件 roundtrip", () => {
  const result = Bun.spawnSync([process.execPath, "test", "./test-component/provider-dialogs.cases.ts"], { cwd: resolve(import.meta.dir, "../.."), env: process.env })
  const output = result.stdout.toString() + result.stderr.toString()
  expect(result.exitCode, output).toBe(0)
  expect(output).toMatch(/^\s*6 pass$/m)
  expect(output).toMatch(/^\s*0 fail$/m)
}, 30_000)
