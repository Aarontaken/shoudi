@echo off
chcp 65001 >nul
title 手递 · 局域网投递
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   没找到 Node.js
  echo   先装一个 LTS 版: https://nodejs.org
  echo.
  pause
  exit /b 1
)

echo.
echo   正在启动手递...
echo.
node server.mjs --open

echo.
echo   服务已停止。
pause
