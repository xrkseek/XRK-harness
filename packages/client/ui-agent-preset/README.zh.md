# @xrkseek/client-ui-agent-preset

[English](README.md) | 中文

Agent preset 表层：General 默认工具面、新建会话 chip、会话标题旁只读标签、设置页名单管理。

XRK Face **内置六种工具面**：`minimal` · `shell` · `frugal` · `plan` · `shallow` · `harness`（UI：**XRK Harness**）。工作区 `.xrk` 种子是另一层（人格 / 规则），不是又一种工具表。见 [docs/profiles.md](../../../docs/profiles.md)。

## 为什么是「新建会话」偏好

会话工具面在创建时钉死；宿主拒绝给已有会话换徽章。改默认只影响之后新建的会话。

## 读写

`agentPreset.list` 一次给出名单与默认；写入 `agent-presets.default`。

内置六档 id 且 `trust: system` 时，名称与描述走 Web locale；其余用文件元数据。

## 管理分区

复制对话框是创建入口（宿主侧拷贝目录）；不在网页里编 YAML。

若名单仍带外来的 `cordis` 行，可显示虚线「创造」卡；XRK Face 目录不含 `cordis`。

## 相关

[docs/profiles.md](../../../docs/profiles.md) · [docs/host-preset.md](../../../docs/host-preset.md)
