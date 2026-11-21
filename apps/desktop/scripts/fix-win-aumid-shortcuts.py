"""Write Desktop / Start Menu / TaskBar .lnk with System.AppUserModel.ID.

Must match apps/desktop DESKTOP_BUILDER_CONFIG.appId. WScript.Shell cannot set
AUMID (strips it). Requires pywin32.
"""

from __future__ import annotations

import os
import sys

import pythoncom
from win32com.propsys import propsys, pscon
from win32com.shell import shell

APP_ID = os.environ.get("XRK_DESKTOP_AUMID", "com.xrkseek.XRKHarness")
DISPLAY = "XRK Harness"


def default_install_dir() -> str:
    override = os.environ.get("XRK_DESKTOP_INSTALL_DIR", "").strip()
    if override:
        return override
    local = os.environ.get("LOCALAPPDATA") or os.path.expandvars(r"%LOCALAPPDATA%")
    return os.path.join(local, "Programs", "XRK Harness")


def write_lnk(path: str, *, exe: str, workdir: str) -> None:
    sl = pythoncom.CoCreateInstance(
        shell.CLSID_ShellLink,
        None,
        pythoncom.CLSCTX_INPROC_SERVER,
        shell.IID_IShellLink,
    )
    sl.SetPath(exe)
    sl.SetWorkingDirectory(workdir)
    sl.SetIconLocation(exe, 0)
    sl.SetDescription(DISPLAY)
    ps = sl.QueryInterface(propsys.IID_IPropertyStore)
    ps.SetValue(pscon.PKEY_AppUserModel_ID, propsys.PROPVARIANTType(APP_ID))
    ps.SetValue(
        pscon.PKEY_AppUserModel_RelaunchDisplayNameResource,
        propsys.PROPVARIANTType(DISPLAY),
    )
    ps.SetValue(
        pscon.PKEY_AppUserModel_RelaunchIconResource,
        propsys.PROPVARIANTType(f"{exe},0"),
    )
    ps.SetValue(
        pscon.PKEY_AppUserModel_RelaunchCommand,
        propsys.PROPVARIANTType(f'"{exe}"'),
    )
    ps.Commit()
    pf = sl.QueryInterface(pythoncom.IID_IPersistFile)
    pf.Save(path, 0)
    sl2 = pythoncom.CoCreateInstance(
        shell.CLSID_ShellLink,
        None,
        pythoncom.CLSCTX_INPROC_SERVER,
        shell.IID_IShellLink,
    )
    sl2.QueryInterface(pythoncom.IID_IPersistFile).Load(path)
    raw = sl2.QueryInterface(propsys.IID_IPropertyStore).GetValue(
        pscon.PKEY_AppUserModel_ID
    )
    value = raw.GetValue() if hasattr(raw, "GetValue") else raw
    print(f"wrote {path} AUMID={value!r}")
    if value != APP_ID:
        raise SystemExit(f"verify failed: {value!r}")


def main() -> int:
    workdir = default_install_dir()
    exe = os.path.join(workdir, "XRK Harness.exe")
    if not os.path.isfile(exe):
        print(f"missing {exe}", file=sys.stderr)
        return 1
    paths = [
        os.path.join(os.environ["USERPROFILE"], "Desktop", "XRK Harness.lnk"),
        os.path.join(
            os.environ["APPDATA"],
            r"Microsoft\Windows\Start Menu\Programs\XRK Harness.lnk",
        ),
        os.path.join(
            os.environ["APPDATA"],
            r"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\XRK Harness.lnk",
        ),
    ]
    for path in paths:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        write_lnk(path, exe=exe, workdir=workdir)
    for name in ("Electron.lnk",):
        pin = os.path.join(
            os.environ["APPDATA"],
            r"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar",
            name,
        )
        if os.path.exists(pin):
            os.remove(pin)
            print(f"removed {pin}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
