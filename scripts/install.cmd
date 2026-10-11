@echo off
rem 一键安装（Windows）—— 实际逻辑在 install.js
node "%~dp0install.js"
if errorlevel 1 (
  echo.
  echo 安装未完成，请把上面的报错发出来。
  pause
)
