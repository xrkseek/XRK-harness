#!/usr/bin/env python3
"""SFTP local harness-download-Core → AGT server core tree."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

HOST = os.environ.get("XRK_AGT_SSH_HOST", "103.236.89.174")
PORT = int(os.environ.get("XRK_AGT_SSH_PORT", "46184"))
USER = os.environ.get("XRK_AGT_SSH_USER", "root")
PASSWORD = os.environ.get("XRK_AGT_SSH_PASSWORD", "")
REMOTE_CORE = os.environ.get(
    "XRK_AGT_REMOTE_HARNESS_DOWNLOAD_CORE",
    "/root/cs/XRK-AGT/core/harness-download-Core",
)

_HERE = Path(__file__).resolve()
_PASSWORD_FILE = _HERE.parents[1] / (
    ".agents/skills/xrk-desktop-update-feed/.agt-password"
)
if not PASSWORD and _PASSWORD_FILE.is_file():
    PASSWORD = _PASSWORD_FILE.read_text(encoding="utf-8").strip()

_CANDIDATES = []
if os.environ.get("XRK_AGT_LOCAL_HARNESS_DOWNLOAD_CORE"):
    _CANDIDATES.append(Path(os.environ["XRK_AGT_LOCAL_HARNESS_DOWNLOAD_CORE"]))
_CANDIDATES.extend(
    [
        _HERE.parents[1].parent / "XRK-AGT" / "core" / "harness-download-Core",
        Path(r"C:\Users\xrkseek\Desktop\主仓库\XRK-AGT\core\harness-download-Core"),
    ]
)
LOCAL_CORE = next((p for p in _CANDIDATES if p.is_dir()), None)

if not PASSWORD:
    print("XRK_AGT_SSH_PASSWORD missing", file=sys.stderr)
    sys.exit(2)
if not LOCAL_CORE:
    print("local harness-download-Core not found", file=sys.stderr)
    sys.exit(2)

FILES = [
    "README.md",
    "catalog.example.json",
    "http/releases.js",
    "http/operators.js",
    "lib/store.js",
    "lib/operators.js",
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
print(f"connecting {USER}@{HOST}:{PORT}")
print(f"local core: {LOCAL_CORE}")
client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=30)
sftp = client.open_sftp()


def ensure_dir(remote: str) -> None:
    parts = remote.strip("/").split("/")
    cur = ""
    for part in parts:
        cur += "/" + part
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


ensure_dir(REMOTE_CORE)
ensure_dir(f"{REMOTE_CORE}/http")
ensure_dir(f"{REMOTE_CORE}/lib")
ensure_dir("/root/cs/XRK-AGT/data/harness-download/operators/packs")
ensure_dir("/root/cs/XRK-AGT/data/harness-download/operators/cards")

for rel in FILES:
    local = LOCAL_CORE / rel
    if not local.is_file():
        print(f"skip missing {rel}")
        continue
    remote = f"{REMOTE_CORE}/{rel}"
    print(f"put {rel}")
    sftp.put(str(local), remote)

sftp.close()
print("sync complete — restart AGT so HttpApiLoader picks operators.js")
if "--restart" in sys.argv:
    _i, o, e = client.exec_command(
        "cd /root/cs/XRK-AGT && (pm2 restart agt || systemctl restart xrk-agt || echo restart-manually)",
        timeout=120,
    )
    print(o.read().decode("utf-8", "replace"))
    print(e.read().decode("utf-8", "replace"))
client.close()
