# @xrkseek/client-ui-message-feedback

[English](README.md) | 中文

会话反馈插件（浏览器侧）：挂在 `conversation.input.overlay` 的对话框，由裸 `/feedback` 打开（带正文的 `/feedback <text>` 仍由 Host 处理）。助手消息 IconActions 上的赞/踩控件已移除。

`MessageFeedbackController` 仍保留，供对话框落到单条消息时走 Host `messageFeedback` 远程；变更仍用 version compare-and-set。

`/client` 导出插件本体（`apply`/`inject`）、对话框类型与 controller 类型。

## 模型体验

无。反馈是 sidecar，不进入 Session 日志或模型上下文。

## 已知限制

- 备注大小由 Host 策略（`maxNoteBytes`）约束；超长在保存时失败。
- 评分无跨标签页推送。
