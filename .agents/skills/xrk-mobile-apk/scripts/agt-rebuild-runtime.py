#!/usr/bin/env python3
"""Upload ENGINE_TGZ (+ build-runtime.sh), rebuild arm64 on AGT, print clear STATUS.

Exit codes:
  0  STATUS=DONE_OK   (rootfs MATCH + merge xrk-phone seen)
  1  STATUS=DONE_FAIL (build finished but verify failed)
  2  missing password / local inputs
  3  STATUS=TIMEOUT

Env:
  XRK_AGT_SSH_PASSWORD  preferred; else skill .agt-password
  ENGINE_VERSION        default 0.7.16
  POLL_SEC              default 20
  MAX_POLLS             default 180  (~1h at 20s)

Not for product users — maintainer / Coding Agent only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

import paramiko

HOST = "103.236.89.174"
PORT = 46184
USER = "root"
REMOTE_ROOT = "/root/xrk-mobile"
REMOTE_ENGINE_DIR = f"{REMOTE_ROOT}/engine"
REMOTE_OUT = f"{REMOTE_ROOT}/out/arm64-v8a"
REMOTE_ROOTFS = f"{REMOTE_OUT}/assets/runtime/rootfs-arm64-v8a.tar.xz"
REMOTE_MANIFEST = f"{REMOTE_OUT}/assets/runtime/manifest.json"
REMOTE_SH = f"{REMOTE_ROOT}/_rebuild_arm64.sh"
REMOTE_LOG = f"{REMOTE_ROOT}/build-arm64.log"
REMOTE_PID = f"{REMOTE_ROOT}/build-arm64.pid"
REMOTE_STATUS = f"{REMOTE_ROOT}/build-arm64.status"


def harness_root() -> Path:
    # …/XRK-harness/.agents/skills/xrk-mobile-apk/scripts/this.py → 5 parents up
    return Path(__file__).resolve().parents[4]


def password() -> str:
    pw = os.environ.get("XRK_AGT_SSH_PASSWORD", "").strip()
    if pw:
        return pw
    path = harness_root() / ".agents" / "skills" / "xrk-desktop-update-feed" / ".agt-password"
    if path.is_file():
        return path.read_text(encoding="utf-8").strip()
    raise SystemExit("STATUS=DONE_FAIL reason=missing_password")


def status(line: str) -> None:
    print(line, flush=True)


def connect(pw: str) -> paramiko.SSHClient:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        HOST,
        port=PORT,
        username=USER,
        password=pw,
        timeout=30,
        banner_timeout=30,
        auth_timeout=30,
        allow_agent=False,
        look_for_keys=False,
    )
    return c


def run(c: paramiko.SSHClient, cmd: str, timeout: int = 90) -> tuple[int, str]:
    _i, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    code = o.channel.recv_exit_status()
    text = out if not err.strip() else (out + ("\n" + err if out else err))
    return code, text


def sftp_put(pw: str, local: Path, remote: str) -> None:
    transport = paramiko.Transport((HOST, PORT))
    transport.connect(username=USER, password=pw)
    sftp = paramiko.SFTPClient.from_transport(transport)
    assert sftp is not None
    try:
        parent = remote.rsplit("/", 1)[0]
        try:
            sftp.stat(parent)
        except FileNotFoundError:
            # only one level under /root/xrk-mobile normally
            try:
                sftp.mkdir(parent)
            except OSError:
                pass
        status(f"STATUS=UPLOAD path={remote} bytes={local.stat().st_size}")
        sftp.put(str(local), remote)
        st = sftp.stat(remote)
        if st.st_size != local.stat().st_size:
            raise RuntimeError(f"upload size mismatch {st.st_size} != {local.stat().st_size}")
    finally:
        sftp.close()
        transport.close()


def build_remote_script(engine_remote: str, engine_version: str) -> str:
    # Write STATUS file so pollers never need fuzzy pgrep.
    return f"""#!/bin/bash
set -euo pipefail
cd {REMOTE_ROOT}
: > {REMOTE_LOG}
exec >>{REMOTE_LOG} 2>&1
echo RUNNING > {REMOTE_STATUS}
echo "[rebuild] start $(date -Is)"
test -f {engine_remote}
test -f runtime/build-runtime.sh
rm -f {REMOTE_ROOTFS} {REMOTE_MANIFEST}
export ENGINE_TGZ={engine_remote}
export ENGINE_VERSION={engine_version}
export RUNTIME_OUT={REMOTE_ROOT}/out
set +e
bash runtime/build-runtime.sh arm64-v8a
code=$?
set -e
echo "[rebuild] exit:$code"
echo "[rebuild] done $(date -Is)"
if [ "$code" -eq 0 ] && [ -f {REMOTE_ROOTFS} ] && [ -f {REMOTE_MANIFEST} ]; then
  echo DONE_OK > {REMOTE_STATUS}
else
  echo DONE_FAIL > {REMOTE_STATUS}
fi
exit "$code"
"""


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="AGT arm64 runtime rebuild with clear STATUS lines")
    p.add_argument(
        "--tgz",
        type=Path,
        default=None,
        help="Local ENGINE_TGZ (default: .release/mobile-engine/xrkseek-harness-cli-<ver>.tgz)",
    )
    p.add_argument("--version", default=os.environ.get("ENGINE_VERSION", "0.7.16"))
    p.add_argument("--skip-upload", action="store_true", help="Reuse remote ENGINE_TGZ already on AGT")
    p.add_argument(
        "--sync-build-runtime",
        action="store_true",
        default=True,
        help="Upload local mobile runtime/build-runtime.sh (default on)",
    )
    p.add_argument("--no-sync-build-runtime", action="store_true")
    p.add_argument("--poll-sec", type=int, default=int(os.environ.get("POLL_SEC", "20")))
    p.add_argument("--max-polls", type=int, default=int(os.environ.get("MAX_POLLS", "180")))
    p.add_argument("--status-only", action="store_true", help="Print remote STATUS and exit")
    return p.parse_args()


def read_remote_status(c: paramiko.SSHClient) -> str:
    _code, text = run(c, f"cat {REMOTE_STATUS} 2>/dev/null || echo UNKNOWN")
    return text.strip().splitlines()[0].strip() if text.strip() else "UNKNOWN"


def verify_remote(c: paramiko.SSHClient) -> tuple[bool, str]:
    """Return (ok, detail). Requires MATCH + xrk-phone merge line in log."""
    code, body = run(
        c,
        f"""
python3 - <<'PY'
import json, hashlib, pathlib, sys
rootfs = pathlib.Path("{REMOTE_ROOTFS}")
manifest = pathlib.Path("{REMOTE_MANIFEST}")
log = pathlib.Path("{REMOTE_LOG}")
if not rootfs.is_file() or not manifest.is_file():
    print("MISSING_ARTIFACTS")
    sys.exit(2)
m = json.load(manifest.open())
h = hashlib.sha256(rootfs.read_bytes()).hexdigest()
size = rootfs.stat().st_size
match = h == m.get("rootfsSha256") and size == int(m.get("rootfsBytes", -1))
log_text = log.read_text(encoding="utf-8", errors="replace") if log.is_file() else ""
merged = "merged mobile skill seed" in log_text and "xrk-phone" in log_text
print("runtimeVersion", m.get("runtimeVersion"))
print("engineVersion", m.get("engineVersion"))
print("bytes", size)
print("sha", h)
print("MATCH" if match else "MISMATCH")
print("MERGED_XRK_PHONE" if merged else "NO_MERGE_LINE")
sys.exit(0 if match and merged else 1)
PY
""",
        timeout=180,
    )
    ok = code == 0 and "MATCH" in body and "MERGED_XRK_PHONE" in body
    return ok, body.strip()


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
    args = parse_args()
    ver = str(args.version).strip()
    pw = password()
    root = harness_root()
    mobile = root.parent / "XRK-harness-mobile"
    tgz = args.tgz
    if tgz is None:
        tgz = root / ".release" / "mobile-engine" / f"xrkseek-harness-cli-{ver}.tgz"
    engine_remote = f"{REMOTE_ENGINE_DIR}/xrkseek-harness-cli-{ver}.tgz"

    if args.status_only:
        c = connect(pw)
        try:
            st = read_remote_status(c)
            status(f"STATUS={st}")
            _c, tail = run(c, f"tail -n 15 {REMOTE_LOG} 2>/dev/null || true")
            if tail.strip():
                print("--- log ---", flush=True)
                print(tail.rstrip(), flush=True)
            if st.startswith("DONE"):
                ok, detail = verify_remote(c)
                print(detail, flush=True)
                status("STATUS=DONE_OK" if ok else "STATUS=DONE_FAIL")
                return 0 if ok else 1
            return 0
        finally:
            c.close()

    if not args.skip_upload:
        if not tgz.is_file():
            status(f"STATUS=DONE_FAIL reason=missing_tgz path={tgz}")
            return 2
        sftp_put(pw, tgz, engine_remote)

    sync_br = args.sync_build_runtime and not args.no_sync_build_runtime
    if sync_br:
        br = mobile / "runtime" / "build-runtime.sh"
        if not br.is_file():
            status(f"STATUS=DONE_FAIL reason=missing_build_runtime path={br}")
            return 2
        sftp_put(pw, br, f"{REMOTE_ROOT}/runtime/build-runtime.sh")

    # Upload launcher script
    script = build_remote_script(engine_remote, ver)
    transport = paramiko.Transport((HOST, PORT))
    transport.connect(username=USER, password=pw)
    sftp = paramiko.SFTPClient.from_transport(transport)
    assert sftp is not None
    with sftp.file(REMOTE_SH, "w") as f:
        f.write(script)
    sftp.chmod(REMOTE_SH, 0o755)
    sftp.close()
    transport.close()

    c = connect(pw)
    try:
        status("STATUS=STARTING")
        _code, body = run(
            c,
            f"""
rm -f {REMOTE_LOG} {REMOTE_PID} {REMOTE_STATUS}
setsid bash {REMOTE_SH} </dev/null >/dev/null 2>&1 &
echo $! > {REMOTE_PID}
sleep 2
echo STARTED:$(cat {REMOTE_PID})
cat {REMOTE_STATUS} 2>/dev/null || echo RUNNING
""",
            timeout=60,
        )
        print(body.rstrip(), flush=True)
        if "STARTED:" not in body:
            status("STATUS=DONE_FAIL reason=start_failed")
            return 1

        for n in range(1, args.max_polls + 1):
            time.sleep(args.poll_sec)
            # Prefer STATUS file; fall back to pid + log markers. Never pgrep the build cmdline
            # (poll exec_command can self-match and stick on ALIVE forever).
            code, body = run(
                c,
                f"""
st=$(cat {REMOTE_STATUS} 2>/dev/null || echo UNKNOWN)
pid=$(cat {REMOTE_PID} 2>/dev/null || true)
alive=0
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then alive=1; fi
echo STATUS_FILE:$st
echo ALIVE:$alive PID:$pid
tail -n 8 {REMOTE_LOG} 2>/dev/null || true
# If status file missing but log has terminal marker, synthesize
if [ "$st" = "UNKNOWN" ] && grep -q '\\[rebuild\\] done' {REMOTE_LOG} 2>/dev/null; then
  if grep -q '\\[rebuild\\] exit:0' {REMOTE_LOG} 2>/dev/null; then echo SYNTH:DONE_OK; else echo SYNTH:DONE_FAIL; fi
fi
""",
                timeout=120,
            )
            print(f"--- poll {n}/{args.max_polls} ---", flush=True)
            print(body.rstrip(), flush=True)

            st = "UNKNOWN"
            for line in body.splitlines():
                if line.startswith("STATUS_FILE:"):
                    st = line.split(":", 1)[1].strip()
                elif line.startswith("SYNTH:"):
                    st = line.split(":", 1)[1].strip()

            if st in ("DONE_OK", "DONE_FAIL") or st.startswith("DONE"):
                ok, detail = verify_remote(c)
                print(detail, flush=True)
                if st == "DONE_OK" and ok:
                    status("STATUS=DONE_OK")
                    return 0
                status("STATUS=DONE_FAIL")
                return 1

            # Defensive: pid dead + no status → fail fast after a couple polls
            if "ALIVE:0" in body and n >= 2 and st in ("UNKNOWN", "RUNNING"):
                # still assembling? status should be RUNNING while pid alive.
                # pid dead with RUNNING/UNKNOWN means crash before status write.
                if "ALIVE:0" in body and st != "RUNNING":
                    status("STATUS=DONE_FAIL reason=process_dead_no_status")
                    return 1

            status(f"STATUS=RUNNING poll={n}")

        status("STATUS=TIMEOUT")
        return 3
    finally:
        c.close()


if __name__ == "__main__":
    raise SystemExit(main())
