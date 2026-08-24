> **读者**：集成者 · 终端用户（CLI 安装与日常命令）。

# @xrkseek/harness-cli

XRK Harness 命令行入口。日常以缩写 **`xrkh`** 为主；完整 bin 名 **`xrk-harness`** 等价可用。

## 安装

```bash
npm install -g @xrkseek/harness-cli
# 或一次性
npx @xrkseek/harness-cli@latest web
```

安装后 PATH 上会有 `xrkh` 与 `xrk-harness` 两个入口，指向同一程序。

## 命令

| 命令 | 作用 |
|------|------|
| `xrkh run` | 单次 agent 回合（参数或 stdin） |
| `xrkh serve` | 启动 HTTP Host + Face API |
| `xrkh web` | 产品壳（静态 UI + API 代理） |
| `xrkh plugin` | 工作区插件 install / list / remove / reconcile |
| `xrkh doctor` | 环境与产品目录检查 |
| `xrkh dump-config` | 输出解析后的 Host 配置（JSON） |

```bash
xrkh --help
xrkh plugin --help
```

## 示例

```bash
xrkh run "hello"
xrkh serve --port 8787
xrkh web
xrkh plugin add ./extensions/example-tools
xrkh doctor
```

## 产品壳路径

`xrkh web` / `xrkh serve` 会按顺序解析产品静态资源：

1.  monorepo 开发：`apps/web/dist`（需先 `pnpm web:assemble`）
2.  全局安装：`product-web/`（随 npm 包发布）

## 相关文档

- [Getting started](../../docs/getting-started.md)
- [Plugin loader](../../docs/plugin-loader.md)
- [Host / Face](../../docs/host-face.md)
