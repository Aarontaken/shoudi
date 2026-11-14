#!/bin/bash
# 双击这个文件 → 在「后台」启动手递，并打开浏览器。
# 服务不依赖这个窗口，关掉也不会停。

cd "$(dirname "$0")" || exit 1

PORT="${SHOUDI_PORT:-7788}"
URL="http://127.0.0.1:$PORT/"
LOG="$HOME/Library/Logs/shoudi.log"

is_up() { curl -fsS -m 1 "${URL}api/state" 2>/dev/null | grep -q '"info"'; }
stop_here() { echo ""; read -n 1 -s -r -p "  按任意键关闭…"; exit "${1:-1}"; }

# 1. 已经在跑了：直接开页面
if is_up; then
  open "$URL"
  echo ""
  echo "  手递本来就在跑，页面已经打开："
  echo "  $URL"
  echo ""
  sleep 1
  exit 0
fi

# 2. 检查 node
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  没找到 Node.js，先装一个：https://nodejs.org"
  echo "  （或者：brew install node）"
  stop_here 1
fi

# 3. 后台启动（脱离当前终端）
mkdir -p "$(dirname "$LOG")" 2>/dev/null
echo ""
echo "  正在启动…"

nohup node server.mjs >>"$LOG" 2>&1 &
PID=$!
disown 2>/dev/null || true

OK=0
for _ in $(seq 1 60); do
  sleep 0.1
  if is_up; then OK=1; break; fi
  kill -0 "$PID" 2>/dev/null || break
done

# 4. 起不来就把日志摊开给他看
if [ "$OK" != "1" ]; then
  echo ""
  echo "  ✗ 没起来。日志最后几行："
  echo ""
  tail -n 15 "$LOG" 2>/dev/null | sed 's/^/    /'
  echo ""
  echo "    完整日志：$LOG"
  stop_here 1
fi

LAN=$(curl -fsS -m 2 "${URL}api/state" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const i=JSON.parse(s).info;process.stdout.write(i.ip+":"+i.port)}catch(e){}})')

echo ""
echo "  ✓ 跑起来了，在后台。这个窗口可以直接关掉。"
echo ""
echo "    电脑上打开   $URL"
[ -n "$LAN" ] && echo "    手机上打开   http://$LAN"
echo "    文件存放     ~/Downloads/LocalDrop"
echo ""
echo "    下次再双击这个文件，就是打开页面。"
echo "    想开机自动运行：scripts/开启开机自启.command"
echo ""

open "$URL"
sleep 1.2
exit 0
