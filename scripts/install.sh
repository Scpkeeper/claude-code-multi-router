#!/usr/bin/env bash
# 一键安装（macOS / Linux）—— 实际逻辑在 install.js
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$DIR/install.js"
