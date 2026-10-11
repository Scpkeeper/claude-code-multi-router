@echo off
rem ============================================================
rem  启动 Claude Code 路由器（并带上 OpenRouter key）
rem
rem  key 的读取顺序：
rem    1) 已经存在的环境变量 OPENROUTER_API_KEY（比如你用 setx 设过）
rem    2) %USERPROFILE%\.claude-code-router\.key 文件的第一行
rem
rem  推荐做法： setx OPENROUTER_API_KEY sk-or-xxxxxxxx
rem  之后就可以直接 ccr start，不必再跑这个脚本。
rem ============================================================

setlocal

set "KEY_FILE=%USERPROFILE%\.claude-code-router\.key"

if "%OPENROUTER_API_KEY%"=="" if exist "%KEY_FILE%" (
  set /p OPENROUTER_API_KEY=<"%KEY_FILE%"
)

if "%OPENROUTER_API_KEY%"=="" (
  echo.
  echo   [x] 没找到 OpenRouter API Key
  echo.
  echo   二选一：
  echo     1. setx OPENROUTER_API_KEY sk-or-xxxxxxxx      ^(推荐，永久生效^)
  echo     2. 把 key 单行写进 %KEY_FILE%
  echo.
  pause
  exit /b 1
)

echo 正在启动路由器，端口 3456 ...
ccr restart

endlocal
