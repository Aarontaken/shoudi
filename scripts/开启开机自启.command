#!/bin/bash
# 让「手递」开机自动在后台运行（macOS）
# 双击运行一次即可；以后开机会自动启动，不用再管它。

set -uo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node || true)"
LABEL="com.shoudi.localdrop"
DOMAIN="gui/$(id -u)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/shoudi.log"
URL="http://127.0.0.1:7788/"

is_up() { curl -fsS -m 1 "${URL}api/state" 2>/dev/null | grep -q '"info"'; }
pause() { echo ""; read -n 1 -s -r -p "  按任意键关闭…"; }

if [ -z "$NODE" ]; then
  echo ""
  echo "  没找到 Node.js，先装一个：https://nodejs.org"
  pause
  exit 1
fi

esc() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
NODE_X="$(printf %s "$NODE" | esc)"
DIR_X="$(printf %s "$DIR" | esc)"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_X</string>
    <string>$DIR_X/server.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$DIR_X</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>$(printf %s "$LOG" | esc)</string>
  <key>StandardErrorPath</key>
  <string>$(printf %s "$LOG" | esc)</string>
</dict>
</plist>
EOF

if ! plutil -lint "$PLIST" > /dev/null 2>&1; then
  echo ""
  echo "  ✗ plist 写得不对：$PLIST"
  pause
  exit 1
fi

# 先停掉旧任务，等它真的退干净（launchctl 是异步的，不等会撞车）
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
for _ in $(seq 1 30); do
  launchctl print "$DOMAIN/$LABEL" > /dev/null 2>&1 || break
  sleep 0.2
done

# 如果之前用「启动手递.command」手动跑着，先让位
if is_up; then
  pkill -f "server.mjs" 2>/dev/null || true
  for _ in $(seq 1 20); do is_up || break; sleep 0.15; done
fi

ERR="$(mktemp /tmp/shoudi.XXXXXX)"
if ! launchctl bootstrap "$DOMAIN" "$PLIST" 2>"$ERR"; then
  echo ""
  echo "  ✗ 注册失败，原因："
  echo ""
  sed 's/^/    /' "$ERR"
  echo ""
  echo "    可以改用「启动手递.command」先手动跑起来。"
  rm -f "$ERR"
  pause
  exit 1
fi
rm -f "$ERR"

echo ""
echo "  正在等它起来…"
for _ in $(seq 1 60); do
  is_up && break
  sleep 0.2
done

echo ""
if is_up; then
  LAN="$(curl -fsS -m 2 "${URL}api/state" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const i=JSON.parse(s).info;process.stdout.write(i.ip+":"+i.port)}catch(e){}})')"
  echo "  ✓ 已开启开机自启，现在就在后台跑着了。"
  echo ""
  echo "    电脑上打开   $URL"
  [ -n "$LAN" ] && echo "    手机上打开   http://$LAN"
  echo ""
  echo "    以后开机会自动启动。想打开页面，双击「打开手递.webloc」。"
  echo "    取消自启：双击 scripts/关闭开机自启.command"
  open "$URL"
else
  echo "  ✓ 已注册，但服务还没起来（等一两秒再刷新页面试试）。"
  echo "    日志：$LOG"
  echo ""
  tail -n 8 "$LOG" 2>/dev/null | sed 's/^/    /'
fi
echo ""
pause
