#!/bin/bash
# 手递.app 内部使用的启动脚本（会被打进 app 包里）
#
#   不带参数  → 确保服务在跑，然后打开页面
#   --upload  → 把后面的文件投递出去（由主流程放到后台执行）
#
# 目录结构（都在 app 包内，离开项目文件夹也能跑）：
#   Contents/Resources/node        Node 运行时
#   Contents/Resources/app/        server.mjs + web/
#   Contents/Resources/launch.sh   本文件

HERE="$(cd "$(dirname "$0")" && pwd)"
NODE="$HERE/node"
APPDIR="$HERE/app"

PORT="${SHOUDI_PORT:-7788}"
URL="http://127.0.0.1:$PORT/"
LOG="$HOME/Library/Logs/shoudi.log"

is_up() { curl -fsS -m 1 "${URL}api/state" 2>/dev/null | grep -q '"info"'; }

# 文件名 → 百分号编码（逐字节，服务端 decodeURIComponent 能还原）
urlencode() { printf '%s' "$1" | od -An -tx1 | tr -d ' \n' | sed 's/\(..\)/%\1/g'; }

# ---------- 上传模式 ----------
if [ "${1:-}" = "--upload" ]; then
  shift
  for f in "$@"; do
    [ -f "$f" ] || continue
    if ! curl -fsS -m 0 -X POST --data-binary "@$f" \
        -H "X-Filename: $(urlencode "$(basename "$f")")" \
        -H 'Content-Type: application/octet-stream' \
        "${URL}api/upload" > /dev/null 2>&1; then
      echo "投递失败：$(basename "$f")"
    fi
  done
  exit 0
fi

# ---------- 启动服务 ----------
if ! is_up; then
  mkdir -p "$(dirname "$LOG")" 2>/dev/null

  # 本机如果装过「开机自启」，优先走 launchd，保证只有一个实例
  PLIST="$HOME/Library/LaunchAgents/com.shoudi.localdrop.plist"
  if [ -f "$PLIST" ]; then
    launchctl kickstart "gui/$(id -u)/com.shoudi.localdrop" > /dev/null 2>&1 \
      || launchctl bootstrap "gui/$(id -u)" "$PLIST" > /dev/null 2>&1
  fi

  # 内置的 node 跑不起来（比如 Intel 机器）就退回系统里装的 node
  if [ ! -x "$NODE" ] || ! "$NODE" -e '0' > /dev/null 2>&1; then
    NODE="$(command -v node 2>/dev/null || true)"
  fi

  if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
    echo "这台电脑跑不了内置的 Node（可能不是 Apple 芯片），先装个 Node.js：https://nodejs.org" >&2
    exit 1
  fi

  nohup "$NODE" "$APPDIR/server.mjs" >> "$LOG" 2>&1 &
  disown 2>/dev/null || true

  for _ in $(seq 1 80); do
    is_up && break
    sleep 0.1
  done
fi

if ! is_up; then
  echo "服务没能启动。日志：$LOG" >&2
  tail -n 10 "$LOG" 2>/dev/null >&2
  exit 1
fi

# ---------- 拖进来的文件：后台投递，不卡住图标 ----------
if [ $# -gt 0 ]; then
  nohup /bin/bash "$0" --upload "$@" >> "$LOG" 2>&1 &
  disown 2>/dev/null || true
fi

open "$URL"
