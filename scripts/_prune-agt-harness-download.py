#!/usr/bin/env python3
"""Prune old Desktop artifacts on AGT harness-download; keep yml-referenced files only."""
from __future__ import annotations

import os
import re
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
DRY = "--apply" not in sys.argv

_PASSWORD_FILE = Path(__file__).resolve().parents[1] / (
    ".agents/skills/xrk-desktop-update-feed/.agt-password"
)
if not PASSWORD and _PASSWORD_FILE.is_file():
    PASSWORD = _PASSWORD_FILE.read_text(encoding="utf-8").strip()

if not PASSWORD:
    print("XRK_AGT_SSH_PASSWORD missing", file=sys.stderr)
    sys.exit(2)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
print(f"connecting {USER}@{HOST}:{PORT} … dry_run={DRY}")
client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=30)


def run(cmd: str) -> str:
    _i, o, e = client.exec_command(cmd, timeout=180)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    if e.channel.recv_exit_status() not in (0, None) and err.strip():
        print(err, file=sys.stderr)
    return out


print("==== disk")
print(run("df -h / | tail -1"))
print(run(f"du -sh {REMOTE_ROOT} {REMOTE_ROOT}/* 2>/dev/null | sort -hr"))

# Parse nightly.yml for current exe basename
yml = run(f"cat {REMOTE_ROOT}/desktop/win-x64/nightly.yml 2>/dev/null || true")
keep = set()
for m in re.finditer(r"(xrk-harness-[^\s\"']+?\.exe)", yml):
    keep.add(m.group(1))
    keep.add(m.group(1) + ".blockmap")
# Also keep latest.yml twin names
print("keep (from nightly.yml):", sorted(keep) or "(none — abort delete)")

listing = run(
    f"find {REMOTE_ROOT}/desktop/bin -type f -printf '%s\\t%p\\n' 2>/dev/null | sort -nr"
)
print("==== bin files")
print(listing)

to_delete = []
for line in listing.splitlines():
    if not line.strip():
        continue
    size_s, path = line.split("\t", 1)
    name = path.rsplit("/", 1)[-1]
    if name.endswith((".exe", ".blockmap", ".dmg", ".zip")) and name not in keep:
        if keep:  # only delete when we know current keep set
            to_delete.append((int(size_s), path))

freed = sum(s for s, _ in to_delete)
print(f"==== prune candidates: {len(to_delete)} files, ~{freed/1024/1024:.1f} MiB")
for size, path in to_delete:
    print(f"  {'RM' if not DRY else 'would RM'} {size}\t{path}")

if not DRY and to_delete:
    for _, path in to_delete:
        run(f"rm -f -- '{path}'")
    print("==== after")
    print(run(f"du -sh {REMOTE_ROOT} {REMOTE_ROOT}/desktop/bin/* 2>/dev/null | sort -hr"))
elif DRY:
    print("dry-run only; re-run with --apply to delete")

# Soft junk
print("==== other bulky dirs (info)")
print(run("du -sh /root/cs/XRK-AGT/logs /root/cs/XRK-AGT/trash /root/cs/XRK-AGT/data/uploads 2>/dev/null"))

client.close()
print("done")
