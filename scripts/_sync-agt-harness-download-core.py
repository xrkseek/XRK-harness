#!/usr/bin/env python3
"""RETIRED: harness-download-Core is no longer synced to AGT.

Desktop + operators downloads use GitHub / Pages. Phone guest runtime rebuild
still uses AGT (or a local Linux/Docker host) via xrk-mobile-apk scripts —
SSH default host: 103.236.92.5
"""
from __future__ import annotations

import sys

print(
    "RETIRED: harness-download-Core sync is removed.\n"
    "Do not deploy operators/desktop update APIs on AGT.",
    file=sys.stderr,
)
sys.exit(2)
