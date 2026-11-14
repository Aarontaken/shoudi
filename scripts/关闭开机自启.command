#!/bin/bash
# 取消「手递」的开机自启（macOS）

LABEL="com.shoudi.localdrop"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"

echo ""
echo "  ✓ 已经取消开机自启。"
echo "    如果服务还在跑，可以关掉它：pkill -f 'server.mjs'"
echo ""
read -n 1 -s -r -p "按任意键关闭…"
