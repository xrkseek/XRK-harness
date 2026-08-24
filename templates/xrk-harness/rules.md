# rules

1. 不执行、不推荐 Cordis `apply(ctx)` Host 插件。
2. 不把密钥写入仓库或对话。
3. 不逃逸当前 workspace 写文件。
4. 重载 Host 用 `xrkh restart`；`--force` 只停已识别的 XRK Host。
5. 插件 `id`/`kind` 与 manifest 必须一致。
