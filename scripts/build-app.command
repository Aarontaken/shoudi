#!/bin/bash
# 重新生成「手递.app」
#
#   ./build-app.command                 生成 app（Apple 芯片）
#   ./build-app.command --share         顺便打一个方便分享的 zip
#   ./build-app.command --arch x64 --share  生成 Intel 版
#
# 生成出来的 app 是自包含的：Node 运行时、服务端、页面全在里面，
# 整个 app 拷给别人就能用（对方不需要装 Node）。

set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

APP="手递.app"
BUILD="$DIR/.build"
CACHE="$DIR/.cache"
NODE_VER="v24.18.1"

SHARE=0
ARCH="arm64"
while [ $# -gt 0 ]; do
  case "$1" in
    --share) SHARE=1; shift ;;
    --arch) ARCH="${2:-arm64}"; shift 2 ;;
    *) shift ;;
  esac
done
if [ "$ARCH" != "arm64" ] && [ "$ARCH" != "x64" ]; then
  echo "  --arch 只能是 arm64 或 x64"
  exit 1
fi

NODE="$CACHE/node-$ARCH"

# ---------------------------------------------------------------- 运行时
# 优先用已有的：缓存 → 旧 app 里的那份（仅 arm64）→ 都没有才下载
if [ ! -x "$NODE" ] && [ "$ARCH" = "arm64" ] && [ -x "$APP/Contents/Resources/node" ]; then
  NODE="$APP/Contents/Resources/node"
fi
if [ ! -x "$NODE" ]; then
  echo ""
  echo "  下载内置的 Node 运行时（${ARCH}，约 50MB，只下一次）…"
  mkdir -p "$CACHE"
  TARBALL="node-$NODE_VER-darwin-$ARCH"
  curl -fL --retry 2 --progress-bar \
    "https://nodejs.org/dist/$NODE_VER/$TARBALL.tar.gz" \
    -o "$CACHE/$TARBALL.tar.gz"
  tar -xzf "$CACHE/$TARBALL.tar.gz" -C "$CACHE"
  cp "$CACHE/$TARBALL/bin/node" "$CACHE/node-$ARCH"
  chmod +x "$CACHE/node-$ARCH"
  rm -rf "$CACHE/$TARBALL.tar.gz" "$CACHE/$TARBALL"
  NODE="$CACHE/node-$ARCH"
fi

# ---------------------------------------------------------------- 图标
SRC="web/icon-1024.png"
[ -f "$SRC" ] || SRC="web/icon-512.png"

rm -rf "$BUILD"
mkdir -p "$BUILD"
ICONSET="$BUILD/手递.iconset"
mkdir -p "$ICONSET"
mk() { sips -z "$2" "$2" "$SRC" --out "$ICONSET/$1" > /dev/null; }
mk icon_16x16.png 16
mk icon_16x16@2x.png 32
mk icon_32x32.png 32
mk icon_32x32@2x.png 64
mk icon_128x128.png 128
mk icon_128x128@2x.png 256
mk icon_256x256.png 256
mk icon_256x256@2x.png 512
mk icon_512x512.png 512
mk icon_512x512@2x.png 1024
iconutil -c icns "$ICONSET" -o "$BUILD/手递.icns"

# ---------------------------------------------------------------- 组装
APP_STAGE="$BUILD/手递.app"
osacompile -o "$APP_STAGE" scripts/app.applescript

RES="$APP_STAGE/Contents/Resources"
mkdir -p "$RES/app"
cp server.mjs "$RES/app/server.mjs"
cp -R web "$RES/app/web"
cp "$NODE" "$RES/node"
chmod +x "$RES/node"
cp scripts/bundle-launch.sh "$RES/launch.sh"
chmod +x "$RES/launch.sh"

rm -f "$RES/Assets.car"
cp "$BUILD/手递.icns" "$RES/droplet.icns"

PB=/usr/libexec/PlistBuddy
PL="$APP_STAGE/Contents/Info.plist"
set_plist() {
  $PB -c "Set :$1 $2" "$PL" > /dev/null 2>&1 || $PB -c "Add :$1 string $2" "$PL" > /dev/null 2>&1 || true
}
$PB -c "Delete :CFBundleIconName" "$PL" > /dev/null 2>&1 || true
# 让 applet 常驻：这样程序坞里的图标不会做完工就消失
$PB -c "Add :OSAAppletStayOpen bool true" "$PL" > /dev/null 2>&1 || \
  $PB -c "Set :OSAAppletStayOpen true" "$PL" > /dev/null 2>&1 || true
set_plist CFBundleName 手递
set_plist CFBundleDisplayName 手递
set_plist CFBundleIdentifier local.shoudi.drop
set_plist CFBundleShortVersionString 1.1.0
set_plist CFBundleVersion 1
set_plist LSMinimumSystemVersion 13.5
set_plist LSApplicationCategoryType public.app-category.utilities

# 动过包内容必须重新签名，否则 Apple 芯片上会直接打不开
codesign --force --deep --sign - "$APP_STAGE" > /dev/null 2>&1
codesign --verify --deep --strict "$APP_STAGE" > /dev/null 2>&1

rm -rf "$APP"
mv "$APP_STAGE" "$APP"
touch "$APP"
rm -rf "$BUILD"

echo ""
echo "  ✓ 生成好了：$DIR/$APP  ($(du -sh "$APP" | cut -f1)，$ARCH)"
echo "    自包含的，直接拷给别人就能用。"

# ---------------------------------------------------------------- 分享
if [ "$SHARE" = "1" ]; then
  if [ "$ARCH" = "x64" ]; then ZIP="$DIR/手递-macOS-x64.zip"; else ZIP="$DIR/手递-macOS.zip"; fi
  rm -f "$ZIP"
  echo ""
  echo "  正在打包 zip…"
  ditto -c -k --keepParent "$APP" "$ZIP"
  echo "  ✓ $ZIP  ($(du -sh "$ZIP" | cut -f1))"
  echo ""
  echo "    对方收到后第一次打开：右键 →「打开」。"
fi
echo ""
