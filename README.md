# 手递 · LocalDrop

**电脑 ⇄ 手机，同一个 Wi-Fi 下直接递文件。**
不装 App、不经云端、不压缩、不限大小。

[English →](README.en.md) · [下载](#下载) · [安全](#安全陌生设备连不进来) · [自己构建](#自己构建)

![桌面端](docs/screenshot-desktop.png)

## 为什么又造一个轮子

微信传文件会压图、有大小限制；QQ 要登录；蓝牙慢得离谱；AirDrop 只认苹果设备。
而「把手机里的照片弄到电脑上」这件事，本来应该点一下就完。

这里的取舍是：**电脑上跑一个小服务，手机什么都不用装。**
扫码进网页就是传输页，加到主屏幕以后就是一个图标，点开即用。

## 功能

- **手机零安装** —— 浏览器打开，没有权限、没有更新
- **双向** —— 手机投递 / 电脑投递 / 文字剪贴板互通
- **不限大小、不压缩** —— 局域网直连，照片和视频原样过去
- **拖一下就行** —— 文件拖到 Mac 程序坞图标或 Windows 桌面图标上，直接发
- **实时** —— 两边都开着页面时，哪边传的对面秒出现（SSE）
- **设备配对** —— 陌生设备连不进来，授权可随时撤销
- **零依赖** —— 服务端和页面只用 Node 标准库，没有 npm 包；app 内置运行时
- 深色模式、手机主屏幕图标、Range 断点续传

## 下载

| 系统 | 文件 | 说明 |
| --- | --- | --- |
| macOS 13.5+（Apple 芯片） | [shoudi-macos-arm64.zip](https://github.com/Aarontaken/shoudi/releases/latest/download/shoudi-macos-arm64.zip) | 37MB，自带 Node 运行时 |
| Windows 10/11 x64 | [shoudi-windows-x64.zip](https://github.com/Aarontaken/shoudi/releases/latest/download/shoudi-windows-x64.zip) | 33MB，自带 node.exe |

> 没有代码签名证书：macOS 第一次要右键 →「打开」，Windows 第一次可能提示「仍要运行」。只有这一次。

### macOS

1. 解压，把 `手递.app` 拖进「应用程序」或「程序坞」
2. 点一下 → 浏览器打开传输页；图标会常驻程序坞
3. 手机扫码 → 电脑上点「允许」→ 连上

把文件拖到程序坞里那个图标上，会直接投递出去。

### Windows

1. 解压 `shoudi-win` 到固定位置（比如 `D:\Tools\shoudi`）
2. 双击 `start.vbs` → 浏览器打开传输页（没有黑窗口）
3. 双击 `install-shortcut.vbs` → 桌面多一个「手递」图标，以后点它

Windows 第一次会弹防火墙提示，**必须允许并勾上「专用网络」**，否则手机连不上。

### 手机

扫码 → 浏览器打开 → 电脑上点「允许」→ 浏览器菜单里「添加到主屏幕」。
以后手机上就是一个图标。**不用装任何 App。**

## 怎么传

| 想干什么 | 怎么做 |
| --- | --- |
| 手机 → 电脑 | 点「把文件丢进来」选文件，电脑 `~/Downloads/LocalDrop` 里就有了 |
| 电脑 → 手机 | 拖进页面，或直接拖到桌面/程序坞图标上；手机上点 `↓` |
| 文字 / 链接 | 任意一边贴进去，另一边点「复制」 |
| 截图 | 电脑上 `Cmd+V` 直接粘进页面 |

## 安全：陌生设备连不进来

光知道地址是打不开的。第一次连接要在电脑上点一次「允许」：

```
手机扫码 ──► 等待电脑确认 ──► 电脑弹出「iPhone 想连接」──► 允许
                                        │
                                        └─ 记住这台设备（180 天），以后免确认
```

- 电脑页面右侧有「已授权的设备」，可单独撤销，**撤销立即生效**
- **删文件、打开文件夹、关闭服务** 只有电脑自己能做，手机上不显示这些按钮
- 二维码只是地址，不代表放行
- 授权记录存在 `~/Downloads/LocalDrop/.devices.json`（删掉 = 清空所有授权）

数据只在局域网内传输，不上云、不经第三方服务器。别把 7788 端口映射到公网。

## 自己构建

需要 Node 18+。打包 Mac app 需要 macOS。

```bash
git clone https://github.com/Aarontaken/shoudi.git
cd shoudi

# 直接跑（不需要安装任何依赖）
node server.mjs --open

# 生成 Mac app + 分享 zip
./scripts/build-app.command --share

# 生成 Windows 包
./scripts/build-win.command
```

构建时会从 nodejs.org 下载一次 Node 运行时（macOS 52MB / Windows 30MB），之后走 `.cache/` 缓存。

## 项目结构

```
server.mjs                 服务端：页面 + 上传/下载 + 配对 + SSE，零依赖
web/                       前端（原生 JS，无框架）
scripts/build-app.command  打包 macOS app
scripts/build-win.command  打包 Windows 包
scripts/app.applescript    app 的拖放入口
scripts/bundle-launch.sh   app 内的启动逻辑
docs/                      截图
```

## 常见问题

**换 Wi-Fi 后手机连不上？**
二维码里的地址是当前局域网 IP，换网络重新扫一次就行。路由器的 DHCP 通常会给同一台机器保留地址。

**端口被占用？**
`node server.mjs --port 8080`，或设置 `SHOUDI_PORT`。

**文件存在哪？**
默认 `~/Downloads/LocalDrop`（Windows 是 `%USERPROFILE%\Downloads\LocalDrop`），可以用 `--dir` 改。

**为什么手机不装 App？**
装 App 是对每台新设备都要重复的成本。浏览器页面没有安装、没有权限、没有更新。
代价是需要知道地址 —— 用二维码解决，扫一次存成图标。

**和 LocalSend 比？**
LocalSend 很好，但要每台设备都装。这里的取舍是：电脑上多一个后台进程，换手机零成本。

**想改配色 / 名字 / 端口？**
`web/style.css` 顶部的 `:root` 变量；`SHOUDI_DEVICE="书房的 Mac" node server.mjs`；`node server.mjs --help`。

## License

[MIT](LICENSE)。`web/qrcode.js` 来自 Kazuhiko Arase（MIT）。
