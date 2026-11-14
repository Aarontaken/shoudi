#!/bin/bash
# 生成 Windows 版：手递-Windows.zip
#
# 里面已经带了 Windows 版 node.exe，对方不需要装任何东西。
# 名字全部用 ASCII，避免不同解压工具把中文搞成乱码；
# 中文只出现在桌面快捷方式的名字上。

set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

VER="v24.18.1"
CACHE="$DIR/.cache"
NODE_WIN="$CACHE/node-win-x64.exe"
BUILD="$DIR/.build/win"
NAME="shoudi-win"
ZIP="$DIR/手递-Windows.zip"

# ---------------------------------------------------------------- node.exe
if [ ! -f "$NODE_WIN" ]; then
  echo ""
  echo "  下载 Windows 版 Node 运行时（约 30MB，只下一次）…"
  mkdir -p "$CACHE"
  curl -fL --retry 2 --progress-bar \
    "https://nodejs.org/dist/$VER/node-$VER-win-x64.zip" \
    -o "$CACHE/node-win.zip"
  unzip -o -q "$CACHE/node-win.zip" "node-$VER-win-x64/node.exe" -d "$CACHE"
  mv "$CACHE/node-$VER-win-x64/node.exe" "$NODE_WIN"
  rm -rf "$CACHE/node-win.zip" "$CACHE/node-$VER-win-x64"
fi

# ---------------------------------------------------------------- 图标
rm -rf "$BUILD"
mkdir -p "$BUILD/ico"
SRC="web/icon-1024.png"
[ -f "$SRC" ] || SRC="web/icon-512.png"
for s in 16 32 48 64 128 256; do
  sips -z "$s" "$s" "$SRC" --out "$BUILD/ico/icon-$s.png" > /dev/null
done
node scripts/make-ico.mjs "$BUILD/ico" "$BUILD/shoudi.ico"

# ---------------------------------------------------------------- 组装
PKG="$BUILD/$NAME"
mkdir -p "$PKG/app"
cp "$NODE_WIN" "$PKG/node.exe"
cp server.mjs "$PKG/app/server.mjs"
cp -R web "$PKG/app/web"
cp scripts/win/launch.mjs "$PKG/app/launch.mjs"
cp "$BUILD/shoudi.ico" "$PKG/shoudi.ico"

# VBScript 里有中文，用 UTF-16LE + BOM 存，Windows 才认得（iconv 的 UTF-16 会写成大端）
utf16le() {
  printf '\xff\xfe' > "$2"
  iconv -f UTF-8 -t UTF-16LE "$1" >> "$2"
}
utf16le scripts/win/start.vbs "$PKG/start.vbs"
utf16le scripts/win/install-shortcut.vbs "$PKG/install-shortcut.vbs"

# 记事本打开不超过 15 年的中文乱码：UTF-8 带 BOM
printf '\xef\xbb\xbf' > "$PKG/README.txt"
cat scripts/win/README.txt >> "$PKG/README.txt"

# 去掉 macOS 的扩展属性，免得 zip 里多出 ._ 文件
xattr -cr "$PKG" 2>/dev/null || true
find "$PKG" -name '.DS_Store' -delete 2>/dev/null || true

rm -f "$ZIP"
(cd "$BUILD" && zip -rX -q "$ZIP" "$NAME")

echo ""
echo "  ✓ 生成好了：$ZIP  ($(du -sh "$ZIP" | cut -f1))"
echo "    解压后双击 start.vbs 就能用；install-shortcut.vbs 建桌面图标。"
echo ""
