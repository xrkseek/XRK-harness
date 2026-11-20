# @xrkseek/dsh-compat

> **读者**：维护者 · 需要加载社区 Host 包的集成者

可选 **Host 适配器**（`kind: host`）。本目录是进程入口；实现在 `@xrkseek/server-http/dsh-compat`。

写 XRK 插件请走 **XRK Plug**（[`@xrkseek/plug`](../../packages/plug/)）与 [client-plugin-development](../../docs/client-plugin-development.md)，不要把本包当作者模板。

```bash
xrkh plugin add ./extensions/dsh-compat
# 或：XRK_PLUGINS_DIR=./extensions xrkh serve
```

规格：`packages/server/http/src/dsh-compat/README.md` · [community-plugins.md](../../docs/community-plugins.md)。

---

# @xrkseek/dsh-compat

> **Audience**: Maintainers · Integrators who load community Host packages

Optional **Host adapter** (`kind: host`). This directory is the process entry; implementation lives in `@xrkseek/server-http/dsh-compat`.

To author XRK plugins, use **XRK Plug** ([`@xrkseek/plug`](../../packages/plug/)) and [client-plugin-development](../../docs/client-plugin-development.md) — not this package as a template.

```bash
xrkh plugin add ./extensions/dsh-compat
# or: XRK_PLUGINS_DIR=./extensions xrkh serve
```

Spec: `packages/server/http/src/dsh-compat/README.md` · [community-plugins.md](../../docs/community-plugins.md).
