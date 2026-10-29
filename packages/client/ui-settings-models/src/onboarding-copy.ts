/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-10-16.1'

/** Product welcome notice — XRK-Harness voice (not upstream marketing copy). */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: '欢迎使用 XRK-Harness',
    body: 'XRK-Harness 是 Agent 宿主和产品壳。会话可以从日志重建，工具按策略放行，社区插件经 dsh-compat 接入。\n\n在对话里直接开干。模型、技能和工具都在设置里。当前公开版本是 0.6。',
    continueLabel: '继续',
  },
  en: {
    title: 'Welcome to XRK-Harness',
    body: 'XRK-Harness is an agent host and product shell. Sessions rebuild from the log, tools follow policy, and community plugins attach through dsh-compat.\n\nStart in the conversation. Models, skills, and tools live in Settings. The current public release is 0.6.',
    continueLabel: 'Continue',
  },
  ja: {
    title: 'XRK-Harness へようこそ',
    body: 'XRK-Harness はエージェント宿主と製品シェルです。セッションはログから再構築でき、ツールは方針に従って許可され、コミュニティプラグインは dsh-compat 経由で接続します。\n\n会話からすぐ始められます。モデル・スキル・ツールは設定にあります。現在の公開版は 0.6 です。',
    continueLabel: '続ける',
  },
} as const
