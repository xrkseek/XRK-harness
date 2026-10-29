#!/usr/bin/env python3
"""Upload staged Desktop artifacts to AGT harness-download (exe/blockmap first, then yml)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

HOST = os.environ.get("XRK_AGT_SSH_HOST", "103.236.89.174")
PORT = int(os.environ.get("XRK_AGT_SSH_PORT", "46184"))
USER = os.environ.get("XRK_AGT_SSH_USER", "root")
PASSWORD = os.environ.get("XRK_AGT_SSH_PASSWORD", "")
REMOTE_ROOT = os.environ.get(
    "XRK_AGT_HARNESS_DOWNLOAD",
    "/root/cs/XRK-AGT/data/harness-download",
)
STAGE = Path(
    os.environ.get(
        "XRK_DESKTOP_UPLOAD_STAGE",
        "apps/desktop/.desktop-build/targets/win-x64/upload-stage-0.7.0-rc.1",
    )
)

if not PASSWORD:
    print("XRK_AGT_SSH_PASSWORD missing", file=sys.stderr)
    sys.exit(2)

bin_dir = STAGE / "desktop" / "bin" / "win-x64"
yml_dir = STAGE / "desktop" / "win-x64"
exe = next(bin_dir.glob("xrk-harness-*-win-x64.exe"))
blockmap = Path(str(exe) + ".blockmap")
nightly = yml_dir / "nightly.yml"
latest = yml_dir / "latest.yml"
for p in (exe, blockmap, nightly, latest):
    if not p.is_file():
        print(f"missing {p}", file=sys.stderr)
        sys.exit(1)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
print(f"connecting {USER}@{HOST}:{PORT} …")
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


def put(local: Path, remote: str) -> None:
    print(f"put {local.name} → {remote} ({local.stat().st_size} bytes)")
    sftp.put(str(local), remote)
    st = sftp.stat(remote)
    if st.st_size != local.stat().st_size:
        raise SystemExit(
            f"size mismatch {remote}: remote={st.st_size} local={local.stat().st_size}"
        )
    print(f"  ok size={st.st_size}")


remote_bin = f"{REMOTE_ROOT}/desktop/bin/win-x64"
remote_yml = f"{REMOTE_ROOT}/desktop/win-x64"
ensure_dir(remote_bin)
ensure_dir(remote_yml)

# 1) binaries first
put(exe, f"{remote_bin}/{exe.name}")
put(blockmap, f"{remote_bin}/{blockmap.name}")
# 2) feeds last
put(nightly, f"{remote_yml}/nightly.yml")
put(latest, f"{remote_yml}/latest.yml")

sftp.close()
client.close()
print("upload complete")
