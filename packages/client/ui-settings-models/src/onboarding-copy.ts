/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-24.1'

/** Product welcome notice — XRK-Harness voice (not upstream marketing copy). */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: '欢迎使用 XRK-Harness',
    body: 'XRK-Harness 是本仓库的 Agent 宿主与产品壳：Session 可重建、工具可走策略，社区 DSH 插件经 dsh-compat 兼容器接入（不嵌入 Cordis Host）。\n\n0.1.5 是当前正式公开发版，CLI 与 serve 主路径可用；真 IM 隧道、Cordis fiber 子进程等缺口见 docs/status。欢迎通过 GitHub 反馈与共建。',
    continueLabel: '继续',
  },
  en: {
    title: 'Welcome to XRK-Harness',
    body: 'XRK-Harness is this repo’s agent host and product shell: durable sessions, policy-aware tools, and DSH community plugins through the dsh-compat layer (no Cordis Host embed).\n\n0.1.5 is the current formal public release with a usable CLI and serve path; see docs/status for honest gaps (live IM tunnels, Cordis fiber subprocess, etc.). Feedback and contributions welcome on GitHub.',
    continueLabel: 'Continue',
  },
} as const
