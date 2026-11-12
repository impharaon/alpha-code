---
id: SPEC-agent-approved-extension-install
title: 助手发现扩展并经用户同意安装
summary: 目录查询、授权确认、安装状态和当前会话中后续使用。
kind: spec
status: approved
version: 1
approved_by: owner（历史批准沿用）
approved_at: 2026-11-12
owners: [owner]
last_reviewed: 2026-11-12
---

# 助手发现扩展并经用户同意安装

希望在当前会话安装定制中心扩展的桌面用户需要目录查询、授权确认、安装状态和当前会话中后续使用。

## 来源

- [impharaon/alpha-work:INT-extensions](https://github.com/impharaon/alpha-work/blob/de325762131253b18e9b65227e366f60a2f39ebe/docs/intents/INT-extensions.md#意图点)。

- [Story alpha-code#1521](https://github.com/impharaon/alpha-code/issues/1521)。
- [方案基线](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/docs/design/2026-10-14-req234-hub-agent-install-baseline.md)；[AC-02 范围裁决](https://github.com/impharaon/alpha-code/issues/1530#issuecomment-6207376527)；[实施及验证核对](https://github.com/impharaon/alpha-code/issues/1521#issuecomment-6731102084)。

- [批准/事实依据](https://github.com/impharaon/alpha-code/issues/1521#issuecomment-6731102084)。
- 交付入口：[alpha-code#1521](https://github.com/impharaon/alpha-code/issues/1521)；实现与验收状态由这些票及其原生子票持有。

## 用户与范围

- 用户：希望在当前会话安装定制中心扩展的桌面用户。
- 包括：目录查询、授权确认、安装状态和当前会话中后续使用。
- 不包括：将任意项目插件路径视为必须经过同一个安装确认。

## 业务规则

- **BR-01** 安装状态区分已安装、待重载和可用。密钥在受控确认框输入，不进入对话。

## 验收

原票文字见下表，适用范围以来源中的后续裁决为准。

| ID | 验收条件 | 依据 |
| --- | --- | --- |
| AC-01 | agent 能列出定制中心里客户端可安装的条目,并知道每条是否已装、是否启用、需要什么授权、云能力的价格说明 | [原票](https://github.com/impharaon/alpha-code/issues/1521)；ext 测试 |
| AC-02 | agent 发起的安装必须经软件界面里的确认框;用户拒绝则不写盘;密钥只在确认框里输入,不出现在工具参数、返回值和会话记录中 | [原票](https://github.com/impharaon/alpha-code/issues/1521)；测试(工具 schema 无密钥字段)+ e2e |
| AC-03 | 安装状态分「已安装 / 待重载 / 可用」,agent 与定制中心看到的一致;重载失败如实显示待重载 | [原票](https://github.com/impharaon/alpha-code/issues/1521)；测试 |
| AC-04 | 已启用且加载/连接成功的条目,在显示「可用」后,同一对话的下一条消息即可被调用,不重启、不新开会话 | [原票](https://github.com/impharaon/alpha-code/issues/1521)；打包 RC 对话记录 |
| AC-05 | 默认开启的 `customize-code-puppy` 技能教上述流程,并如实说明项目 JS 插件的信任边界;上游 `customize-opencode` 继续出厂禁用 | [原票](https://github.com/impharaon/alpha-code/issues/1521)；技能内容测试 |

证据与适用边界：沿用 2026-10-14 基线与 10-16 裁决。已完成 #1529/#1531/#1532/#1533；全局受保护路径义务在 #1530/#1542，owner 已明确挂起；项目插件路径不关闭。发布件确认/可用后同对话调用证据复用 #1660。

## 待决

无新的需求批准事项；上述历史批准继续有效。规格批准不等于实现、部署或验收完成，尚缺证据与实施工作由来源中的交付入口负责。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-12 | owner（历史批准） | 沿用既有批准的范围/裁决，2026-11-12 为规格登记日，不是新的 owner 批准日。[依据](https://github.com/impharaon/alpha-code/issues/1521#issuecomment-6731102084)。 |
