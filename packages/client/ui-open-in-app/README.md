# @xrkseek/client-ui-open-in-app

English | [中文](README.zh.md)

Session-header **Open In…** split button: opens the current session workspace directory in a Face-probed editor, terminal, or file manager. Availability comes from Face `host.listOpenInApps`; launches use `host.openInApp`. The control is hidden when Face returns no apps, the session has no cwd, the page is not loopback, or `host.describe.canOpenPath` is false.

SSH / remote Host launches return an empty app list (same decision as the DSH open-in-app Host package). Catalog is a fixed whitelist with verified launchers only — not a disk-wide scan.
