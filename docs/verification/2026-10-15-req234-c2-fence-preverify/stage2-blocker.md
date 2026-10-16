# #1530 第二步阻塞：已有 MCP client 的 dispose 后消费先于重构

基点 `7d53b4515065bc2d507dc62c61e2b8bf02f2a9b7`，2026-10-15 本机实测；主体实现仍为未提交草稿。
批准的依赖变更已完成：ext 声明 `jsonc-parser: 3.3.1`，`bun.lock` 仅增加这一条 workspace 声明，无其它漂移。

**实测**：同一引擎 PID，生产 profile + native fence，真 ext bundle，真 HTTP/InstanceBootstrap，MCP 直接复用仓内
`packages/opencode/test/fixture/mcp-lifecycle-stdio.ts` 的 SDK 服务；观察器只读本测试生成的公开环境变量。
Electron browser/main 通过定制中心现有 `persistMcp` 写入本地定义；没有测试确认框/IPC，也未读用户配置或密钥。

1. 引擎先启动；Electron main 安装 `managed`，环境值含相对 `{file:value.txt}`；dispose 后连接成功，SDK 进程拿到展开后的值与 `trusted` 参数。
2. 在围栏内向 `~/.opencode/opencode.jsonc` 写同名覆盖（参数 `attacker`、新增 environment 字段）。
3. 再次 dispose；下一请求直接 `GET /mcp`，没有先查 config、没有手动初始化插件。
4. `GET /config` 的叶已经逐字恢复为受管定义，但 MCP 服务实际启动参数仍为 `attacker`，并拿到覆盖后的环境值。
5. 写入先用真实引擎 session/shell，再换成独立 `sandbox-exec -f <生产 profile>`：两种方式均复现，后者没有会话活动。
6. 项目配置读失败（`.code-puppy/alpha.jsonc` 是目录，真实 EISDIR）也复现同样的消费错误。

复现（当前工作区草稿，无诊断插桩）：
```sh
cd packages/ui-mac
bun test src/main/mcp-config-rebuild.test.ts -t 'I1⑤'
bun test src/main/mcp-config-rebuild.test.ts -t 'I1⑥'
bun test src/main/mcp-config-rebuild.test.ts -t '§1.7'
# 各 rc=1；expected args ["trusted"]，received ["attacker"]
```
完整 6 测试首次实跑 `4 pass / 2 fail`；随后强化 §1.7，覆盖「已有 MCP client 后的下一轮 dispose」，该具名测试单跑也红。
I1②/③/④ 通过；③同 PID 安装与重装两次均连接且 `{file:}` 已展开。⑤⑥的生产臂先失败，因此未抵达对应的变异臂，不能宣称反向对照完成。
临时 Bun preload 只在加载时加日志、未改上游文件，观测到：
```text
首轮：EXT REBUILT trusted → MCP INIT trusted
下一轮：MCP INIT attacker → EXT REBUILT trusted
```
上述轨迹与真实 SDK 子进程观测一致；正式测试不依赖该插桩。原始运行日志保留在本机 `/tmp/1530-rebuild-final-blocker.log`、`/tmp/1530-order-final-blocker.log`、`/tmp/1530-order-both.log`。

**推断/待定位**：仅 `bootstrap.ts` 的顺序不足以保证销毁/再次初始化全过程里 MCP 不提前读配置。
实例销毁的 disposer 并发执行（`packages/opencode/src/effect/instance-registry.ts`），具体触发提前 MCP 初始化的链路尚未定位。
不能据此把根因定为某个 disposer；当前证据已经证伪基线 §1.7 的强顺序前提。

**BLOCKED / SEAM-CHANGE-NEEDED**：需要编排器允许调查并修复票面外的引擎实例销毁/初始化顺序，或拆出承接票后续派。
遵守「阻塞时停下、不绕过」：未改上游/消息/IPC/G1，未跑已知无法达标的最终全量门，未提交第二步草稿、未 push。
已过检查：ext `bun typecheck` / build、重构单测 7 条、写盘登记簿校验；此前围栏相关 86 条通过。
