---
id: SPEC-agent-approved-extension-install
title: 助手发现扩展并经用户同意安装
summary: 目录查询、授权确认、安装状态和当前会话中后续使用。
kind: spec
status: draft
version: 0
approved_by: ""
approved_at: ""
owners: [owner]
last_reviewed: 2026-11-10
---

# 助手发现扩展并经用户同意安装

希望在当前会话安装定制中心扩展的桌面用户需要目录查询、授权确认、安装状态和当前会话中后续使用。

## 来源

- [impharaon/alpha-work:INT-extensions](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-extensions.md#意图点)。

- [Story alpha-code#1521](https://github.com/impharaon/alpha-code/issues/1521)。
- [方案基线](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/docs/design/2026-10-14-req234-hub-agent-install-baseline.md)；[AC-02 范围裁决](https://github.com/impharaon/alpha-code/issues/1530#issuecomment-6207376527)；[实施及验证核对](https://github.com/impharaon/alpha-code/issues/1521#issuecomment-6731102084)。

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

## 待决

AC-02 的旁路保证受后续裁决约束：只承诺保护的全局文件与目录无法在围栏内写入或替换，项目插件路径不关闭。该部分随 #1530 和 #1542 挂起。AC-04 打包对话记录由 #1660 取证。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
