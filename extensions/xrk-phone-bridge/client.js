/**
 * Settings → 远程手机桥. Staged under web/plugins by materialize (no Host edits).
 */
window.__ModuleLoader__.load({
  id: "xrk-phone-bridge",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const { useCallback, useEffect, useState, createElement: h } = React;

    const API = "/xrk-phone-bridge";

    const c = {
      root: {
        display: "flex",
        flexDirection: "column",
        gap: 20,
        width: "100%",
        maxWidth: 560,
        color: "var(--dsw-alias-label-primary, inherit)",
      },
      heading: {
        margin: 0,
        fontSize: 16,
        lineHeight: "24px",
        fontWeight: 500,
      },
      intro: {
        margin: 0,
        fontSize: 14,
        lineHeight: "22px",
        color: "var(--dsw-alias-label-tertiary, rgba(255,255,255,0.55))",
      },
      panel: {
        margin: 0,
        padding: "14px 16px",
        borderRadius: 12,
        border: "1px solid var(--dsw-alias-stroke-primary, rgba(255,255,255,0.08))",
        background: "var(--dsw-alias-fill-quaternary, rgba(255,255,255,0.04))",
      },
      stats: {
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 8,
      },
      stat: {
        padding: "12px 10px",
        borderRadius: 10,
        border: "1px solid var(--dsw-alias-stroke-primary, rgba(255,255,255,0.08))",
        background: "var(--dsw-alias-fill-quaternary, rgba(255,255,255,0.03))",
        textAlign: "center",
      },
      statN: { fontSize: 22, fontWeight: 600, lineHeight: "28px" },
      statL: {
        marginTop: 2,
        fontSize: 12,
        color: "var(--dsw-alias-label-tertiary, rgba(255,255,255,0.5))",
      },
      h3: {
        margin: 0,
        fontSize: 13,
        fontWeight: 600,
        color: "var(--dsw-alias-label-secondary, rgba(255,255,255,0.72))",
      },
      empty: {
        margin: 0,
        fontSize: 13,
        lineHeight: "20px",
        color: "var(--dsw-alias-label-tertiary, rgba(255,255,255,0.45))",
      },
      err: {
        margin: 0,
        fontSize: 13,
        color: "var(--dsw-alias-status-danger, #e07070)",
      },
      list: { display: "flex", flexDirection: "column" },
      row: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        justifyContent: "space-between",
        padding: "12px 0",
        borderBottom: "1px solid var(--dsw-alias-stroke-primary, rgba(255,255,255,0.08))",
      },
      title: { fontSize: 14, lineHeight: "20px", fontWeight: 500 },
      mono: {
        display: "block",
        marginTop: 3,
        fontSize: 12,
        lineHeight: "18px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        color: "var(--dsw-alias-label-tertiary, rgba(255,255,255,0.45))",
        wordBreak: "break-all",
      },
      badge: {
        display: "inline-block",
        marginLeft: 8,
        padding: "1px 7px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        verticalAlign: "middle",
        background: "rgba(59,109,255,0.18)",
        color: "var(--dsw-alias-label-primary, #9bb4ff)",
      },
      form: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
      input: {
        flex: "1 1 140px",
        minWidth: 0,
        height: 34,
        padding: "0 11px",
        borderRadius: 9,
        border: "1px solid var(--dsw-alias-stroke-primary, rgba(255,255,255,0.12))",
        background: "var(--dsw-alias-fill-quaternary, rgba(255,255,255,0.04))",
        color: "inherit",
        fontSize: 13,
        outline: "none",
      },
      btn: {
        height: 34,
        padding: "0 14px",
        borderRadius: 9,
        border: "1px solid transparent",
        background: "var(--dsw-alias-fill-brand, #3b6dff)",
        color: "var(--dsw-alias-label-on-brand, #fff)",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
      },
      ghost: {
        height: 34,
        padding: "0 14px",
        borderRadius: 9,
        border: "1px solid var(--dsw-alias-stroke-primary, rgba(255,255,255,0.12))",
        background: "transparent",
        color: "inherit",
        fontSize: 13,
        cursor: "pointer",
      },
      danger: {
        height: 34,
        padding: "0 14px",
        borderRadius: 9,
        border: "1px solid var(--dsw-alias-stroke-primary, rgba(255,255,255,0.12))",
        background: "transparent",
        color: "var(--dsw-alias-status-danger, #e07070)",
        fontSize: 13,
        cursor: "pointer",
      },
      foot: { display: "flex", alignItems: "center", gap: 10 },
      hint: {
        fontSize: 12,
        color: "var(--dsw-alias-label-tertiary, rgba(255,255,255,0.45))",
      },
      ol: {
        margin: "8px 0 0",
        paddingLeft: 18,
        fontSize: 13,
        lineHeight: "20px",
        color: "var(--dsw-alias-label-secondary, rgba(255,255,255,0.72))",
      },
      section: { display: "flex", flexDirection: "column", gap: 8 },
    };

    async function fetchStatus() {
      const res = await fetch(`${API}/status`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      return res.json();
    }

    async function mutateWhitelist(body) {
      const res = await fetch(`${API}/whitelist`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `whitelist ${res.status}`);
      }
      return data;
    }

    function Btn({ children, onClick, variant, disabled }) {
      const style =
        variant === "danger" ? c.danger : variant === "ghost" ? c.ghost : c.btn;
      return h(
        "button",
        {
          type: "button",
          onClick,
          disabled: Boolean(disabled),
          style: {
            ...style,
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? "default" : "pointer",
          },
        },
        children,
      );
    }

    function DeviceRow({ title, deviceKey, badge, action }) {
      return h(
        "div",
        { style: c.row },
        h(
          "div",
          { style: { minWidth: 0, flex: "1 1 auto" } },
          h(
            "div",
            { style: c.title },
            title || "设备",
            badge ? h("span", { style: c.badge }, badge) : null,
          ),
          h("code", { style: c.mono }, deviceKey),
        ),
        action || null,
      );
    }

    function Stat({ n, label }) {
      return h(
        "div",
        { style: c.stat },
        h("div", { style: c.statN }, String(n ?? 0)),
        h("div", { style: c.statL }, label),
      );
    }

    function PhoneBridgeSection() {
      const [data, setData] = useState(null);
      const [error, setError] = useState("");
      const [busy, setBusy] = useState(false);
      const [manualKey, setManualKey] = useState("");
      const [manualLabel, setManualLabel] = useState("");

      const reload = useCallback(async () => {
        try {
          setError("");
          setData(await fetchStatus());
        } catch (e) {
          setError(String(e && e.message ? e.message : e));
        }
      }, []);

      const pending = (data && data.pending) || [];
      const whitelist = (data && data.whitelist) || [];
      const online = (data && data.online) || [];
      const counts = (data && data.counts) || {
        pending: pending.length,
        allowed: whitelist.length,
        online: online.length,
      };

      // Initial load once; interval paced by pending without re-entrant reload storms.
      useEffect(() => {
        void reload();
      }, [reload]);

      useEffect(() => {
        const ms = pending.length > 0 ? 2000 : 5000;
        const t = window.setInterval(() => void reload(), ms);
        return () => window.clearInterval(t);
      }, [reload, pending.length]);

      const run = async (fn) => {
        setBusy(true);
        setError("");
        try {
          await fn();
          await reload();
        } catch (e) {
          setError(String(e && e.message ? e.message : e));
        } finally {
          setBusy(false);
        }
      };

      return h(
        "div",
        { style: c.root },
        h("h2", { style: c.heading }, "远程手机桥"),
        h(
          "p",
          { style: c.intro },
          "把手机 App 接到这个 Host，才能用 phone_* 远程操控。白名单只管 App 桥接设备；浏览器桌面 Face 用 PIN 进壳即可聊天，不会进待批准、也不必点允许。",
        ),

        h(
          "div",
          { style: c.stats },
          h(Stat, { n: counts.pending, label: "待批准" }),
          h(Stat, { n: counts.allowed, label: "已允许" }),
          h(Stat, { n: counts.online, label: "在线" }),
        ),

        h(
          "div",
          { style: c.panel },
          h("div", { style: { fontSize: 13, fontWeight: 600 } }, "连接步骤"),
          h(
            "ol",
            { style: c.ol },
            h("li", null, "手机 App → 选远程 HTTP Host → 同一 PIN 打开 Face（浏览器 PIN 不会报到）"),
            h("li", null, "本页「待批准」点允许（仅 App 会进此列表）"),
            h("li", null, "手机开「手机操控」+ 无障碍 → 「在线」亮起"),
          ),
        ),

        error ? h("p", { style: c.err }, error) : null,

        h(
          "div",
          { style: c.section },
          h("h3", { style: c.h3 }, "待批准"),
          pending.length === 0
            ? h(
                "p",
                { style: c.empty },
                "暂无。确认 App 指向本 Host、已 PIN，并保持前台约十几秒后刷新。",
              )
            : h(
                "div",
                { style: c.list },
                pending.map((p) =>
                  h(DeviceRow, {
                    key: p.deviceKey,
                    title: p.label || "手机",
                    deviceKey: p.deviceKey,
                    badge: "等待允许",
                    action: h(
                      Btn,
                      {
                        disabled: busy,
                        onClick: () =>
                          void run(() =>
                            mutateWhitelist({
                              action: "add",
                              deviceKey: p.deviceKey,
                              label: p.label || "",
                            }),
                          ),
                      },
                      "允许",
                    ),
                  }),
                ),
              ),
        ),

        h(
          "div",
          { style: c.section },
          h("h3", { style: c.h3 }, "已允许"),
          whitelist.length === 0
            ? h("p", { style: c.empty }, "还没有白名单设备")
            : h(
                "div",
                { style: c.list },
                whitelist.map((w) => {
                  const isOn = online.some((o) => o.deviceKey === w.deviceKey);
                  return h(DeviceRow, {
                    key: w.deviceKey,
                    title: w.label || "设备",
                    deviceKey: w.deviceKey,
                    badge: isOn ? "在线" : "离线",
                    action: h(
                      Btn,
                      {
                        variant: "danger",
                        disabled: busy,
                        onClick: () =>
                          void run(() =>
                            mutateWhitelist({
                              action: "remove",
                              deviceKey: w.deviceKey,
                            }),
                          ),
                      },
                      "移除",
                    ),
                  });
                }),
              ),
        ),

        h(
          "div",
          { style: c.section },
          h("h3", { style: c.h3 }, "当前在线"),
          online.length === 0
            ? h(
                "p",
                { style: c.empty },
                "无。允许后还须在手机开启操控 + 无障碍，并保持 App 打开。",
              )
            : h(
                "div",
                { style: c.list },
                online.map((b) =>
                  h(DeviceRow, {
                    key: b.deviceKey,
                    title: b.label || "在线",
                    deviceKey: b.deviceKey,
                    badge: "可操控",
                  }),
                ),
              ),
        ),

        h(
          "div",
          { style: c.section },
          h("h3", { style: c.h3 }, "手动添加"),
          h(
            "div",
            { style: c.form },
            h("input", {
              value: manualKey,
              placeholder: "deviceKey",
              onChange: (e) => setManualKey(e.target.value),
              style: c.input,
            }),
            h("input", {
              value: manualLabel,
              placeholder: "备注（可选）",
              onChange: (e) => setManualLabel(e.target.value),
              style: { ...c.input, flex: "0 1 120px" },
            }),
            h(
              Btn,
              {
                disabled: busy || !manualKey.trim(),
                onClick: () =>
                  void run(async () => {
                    await mutateWhitelist({
                      action: "add",
                      deviceKey: manualKey.trim(),
                      label: manualLabel.trim(),
                    });
                    setManualKey("");
                    setManualLabel("");
                  }),
              },
              "添加",
            ),
          ),
        ),

        h(
          "div",
          { style: c.foot },
          h(
            Btn,
            { variant: "ghost", disabled: busy, onClick: () => void reload() },
            "刷新",
          ),
          h("span", { style: c.hint }, "有待批准时约 2 秒刷新，否则约 5 秒"),
        ),
      );
    }

    const inject = ["slots"];

    function apply(ctx) {
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: "xrk-phone-bridge",
            order: 85,
            label: "远程手机桥",
          },
          PhoneBridgeSection,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
