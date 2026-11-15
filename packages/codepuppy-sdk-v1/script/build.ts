#!/usr/bin/env bun
// `#1706`:本包(`@opencode-ai/sdk` 1.18.35,冻结前端用的 v1 客户端)随冻结前端一起冻结(ADR-047),客户端不再重新生成,
// `src/` 就是它的全部记录。原先的生成脚本从旧引擎目录 `../../opencode` 跑 `bun dev generate`;OpenCode 2 换代后那个目录
// 不存在,脚本只会以一个看不出原因的 ENOENT 失败。生成脚本的原文在 git 历史里(本提交之前的 script/build.ts)。
// 这里立刻以非零退出并说明原因:不建目录、不写 openapi.json、不碰 src/。
console.error(
  "@opencode-ai/sdk(packages/codepuppy-sdk-v1)已冻结:客户端不再重新生成(ADR-047),src/ 就是它的全部记录。本次没有生成、也没有写入任何文件。",
)
process.exit(1)
