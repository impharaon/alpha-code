// I-08:src/main/test-isolation.test.ts 以子 `bun test` 起本文件(与其它 host 起 cases 同形:cwd 是 packages/ui-mac,读同一份 bunfig),
// 打印子进程预载之后看到的隔离环境,由 host 比对。
import { test } from "bun:test"
import os from "node:os"

test("print the isolated env this child test process runs with", () => {
  const { CODEPUPPY_TEST_ROOT: root, HOME: home, XDG_DATA_HOME: data, OPENCODE_DB: db } = process.env
  console.log(`ISOLATION ${JSON.stringify({ root, home, data, db, homedir: os.homedir() })}`)
})
