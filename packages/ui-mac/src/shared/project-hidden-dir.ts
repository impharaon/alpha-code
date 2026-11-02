// 项目隐藏目录名的唯一来源(REQ-236 `#1553` AC8;方案 docs/design/req236-results-and-attachments.md §2.6)。
// main 的 codepuppy-workdir.ts(解析器与身份复验)、ext 与 renderer 的附件路径都读它;零依赖,ext 经相对路径 import。
// 值随命名迁移改为 `.codepuppy`(owner 2026-10-30 裁决;#1569 AC7)。旧目录在打开项目时由
// main/project-hidden-dir-migration.ts 改名,旧名只在那里出现。
export const PROJECT_HIDDEN_DIR = ".codepuppy"
