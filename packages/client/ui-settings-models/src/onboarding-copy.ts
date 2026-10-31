/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-10-30.1'

/** Product welcome notice — XRK-Harness voice (not upstream marketing copy). */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: '欢迎使用 XRK-Harness',
    body: 'XRK-Harness 是本地优先的 Agent 工作台。会话可从日志完整重建，工具按策略执行，社区插件可直接接入。\n\n打开对话即可开始。模型、技能与工具都在设置里。',
    continueLabel: '继续',
  },
  en: {
    title: 'Welcome to XRK-Harness',
    body: 'XRK-Harness is a local-first agent workspace. Sessions rebuild fully from the log, tools run under policy, and community plugins plug in cleanly.\n\nStart in the conversation. Models, skills, and tools live in Settings.',
    continueLabel: 'Continue',
  },
  ja: {
    title: 'XRK-Harness へようこそ',
    body: 'XRK-Harness はローカル優先のエージェント作業台です。セッションはログから完全に再構築でき、ツールは方針に従って動き、コミュニティプラグインはそのまま接続できます。\n\n会話を開けばすぐ始められます。モデル・スキル・ツールは設定にあります。',
    continueLabel: '続ける',
  },
} as const
