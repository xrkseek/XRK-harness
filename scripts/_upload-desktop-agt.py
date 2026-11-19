#!/usr/bin/env python3
"""RETIRED: Desktop update assets ship on GitHub Releases only.

Do not upload exe/yml to AGT harness-download. Use:
  gh release upload vN <exe> <blockmap> nightly.yml latest.yml --repo xrkseek/XRK-harness

AGT SSH host (runtime builds only): 103.236.92.5
"""
from __future__ import annotations

import sys

print(
    "RETIRED: AGT harness-download desktop upload is removed.\n"
    "Ship Desktop updates via GitHub Releases (exe + blockmap + nightly.yml / latest.yml)\n"
    "with relative filenames - same model as the phone App update.json + APK.",
    file=sys.stderr,
)
sys.exit(2)
