#!/usr/bin/env python3
"""Pull AGT arm64 runtime into XRK-harness-mobile/runtime/out with clear STATUS.

Exit 0 → STATUS=DONE_OK (sha+size MATCH, size ≥80MB)
Exit 1 → STATUS=DONE_FAIL
Exit 2 → missing password
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

import paramiko

HOST = "103.236.89.174"
PORT = 46184
REMOTE_DIR = "/root/xrk-mobile/out/arm64-v8a"
REMOTE_ROOTFS = f"{REMOTE_DIR}/assets/runtime/rootfs-arm64-v8a.tar.xz"
REMOTE_MANIFEST = f"{REMOTE_DIR}/assets/runtime/manifest.json"


def harness_root() -> Path:
    return Path(__file__).resolve().parents[4]


def password() -> str:
    pw = os.environ.get("XRK_AGT_SSH_PASSWORD", "").strip()
    if pw:
        return pw
    path = harness_root() / ".agents" / "skills" / "xrk-desktop-update-feed" / ".agt-password"
    if path.is_file():
        return path.read_text(encoding="utf-8").strip()
    print("STATUS=DONE_FAIL reason=missing_password", flush=True)
    raise SystemExit(2)


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
    pw = password()
    local_out = harness_root().parent / "XRK-harness-mobile" / "runtime" / "out" / "arm64-v8a"

    print("STATUS=PULLING", flush=True)
    transport = paramiko.Transport((HOST, PORT))
    transport.connect(username="root", password=pw)
    sftp = paramiko.SFTPClient.from_transport(transport)
    assert sftp is not None

    try:
        with sftp.file(REMOTE_MANIFEST, "r") as f:
            manifest = json.loads(f.read().decode("utf-8"))
        want_sha = manifest["rootfsSha256"]
        want_bytes = int(manifest["rootfsBytes"])
        print(
            "remote",
            manifest.get("runtimeVersion"),
            manifest.get("engineVersion"),
            want_bytes,
            want_sha[:16] + "…",
            flush=True,
        )

        st = sftp.stat(REMOTE_ROOTFS)
        if st.st_size != want_bytes:
            print(f"STATUS=DONE_FAIL reason=remote_size {st.st_size}!={want_bytes}", flush=True)
            return 1

        assets = local_out / "assets" / "runtime"
        jni = local_out / "jniLibs" / "arm64-v8a"
        assets.mkdir(parents=True, exist_ok=True)
        jni.mkdir(parents=True, exist_ok=True)

        local_rootfs = assets / "rootfs-arm64-v8a.tar.xz"
        local_manifest = assets / "manifest.json"
        tmp = assets / "rootfs-arm64-v8a.tar.xz.partial"

        print(f"STATUS=DOWNLOAD bytes={want_bytes}", flush=True)
        sftp.get(REMOTE_ROOTFS, str(tmp))
        got = tmp.stat().st_size
        if got != want_bytes:
            tmp.unlink(missing_ok=True)
            print(f"STATUS=DONE_FAIL reason=download_size {got}!={want_bytes}", flush=True)
            return 1

        print("STATUS=HASHING", flush=True)
        h = hashlib.sha256()
        with tmp.open("rb") as f:
            while True:
                chunk = f.read(1024 * 1024)
                if not chunk:
                    break
                h.update(chunk)
        actual = h.hexdigest()
        if actual != want_sha:
            tmp.unlink(missing_ok=True)
            print(f"STATUS=DONE_FAIL reason=sha {actual}!={want_sha}", flush=True)
            return 1
        print(f"MATCH {actual} {got}", flush=True)
        tmp.replace(local_rootfs)

        with sftp.file(REMOTE_MANIFEST, "r") as f:
            local_manifest.write_bytes(f.read())

        try:
            for name in sftp.listdir(f"{REMOTE_DIR}/assets/runtime/licenses"):
                lic_dir = assets / "licenses"
                lic_dir.mkdir(exist_ok=True)
                sftp.get(f"{REMOTE_DIR}/assets/runtime/licenses/{name}", str(lic_dir / name))
        except FileNotFoundError:
            pass

        for name in sftp.listdir(f"{REMOTE_DIR}/jniLibs/arm64-v8a"):
            sftp.get(f"{REMOTE_DIR}/jniLibs/arm64-v8a/{name}", str(jni / name))

        try:
            sftp.get(f"{REMOTE_DIR}/build-report.json", str(local_out / "build-report.json"))
        except FileNotFoundError:
            pass
    finally:
        sftp.close()
        transport.close()

    m2 = json.loads(local_manifest.read_text(encoding="utf-8"))
    size = local_rootfs.stat().st_size
    print(
        "local",
        m2.get("runtimeVersion"),
        m2.get("engineVersion"),
        size,
        flush=True,
    )
    print("jni", sorted(p.name for p in jni.iterdir()), flush=True)
    if size < 80 * 1024 * 1024:
        print("STATUS=DONE_FAIL reason=size_floor", flush=True)
        return 1
    print("STATUS=DONE_OK", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
