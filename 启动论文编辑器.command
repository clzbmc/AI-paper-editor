#!/bin/zsh

set -u

SCRIPT_DIR="${0:A:h}"
PORT="${PORT:-8000}"
URL="http://127.0.0.1:${PORT}"
APP_VERSION="0.7.10"

cd "$SCRIPT_DIR" || exit 1
clear
echo "========================================"
echo "  PaperCraft AI 论文编辑器"
echo "========================================"
echo

if ! command -v python3 >/dev/null 2>&1; then
  echo "未找到 Python 3，无法启动。"
  echo "请先安装 Python 3 后重试。"
  echo
  read "?按回车键关闭窗口..."
  exit 1
fi

HEALTH="$(curl --silent --fail --max-time 1 "$URL/api/health" 2>/dev/null || true)"
if [[ "$HEALTH" == *'"app": "papercraft"'* && "$HEALTH" == *"\"version\": \"${APP_VERSION}\""* ]]; then
  echo "编辑器已经在运行，正在打开浏览器..."
  open "$URL"
  echo
  echo "可以关闭此窗口。"
  sleep 2
  exit 0
fi

if curl --silent --fail --max-time 1 "$URL" 2>/dev/null | grep -q "PaperCraft"; then
  echo "检测到旧版 PaperCraft 服务，正在重新启动..."
  OLD_PID="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$OLD_PID" ]]; then
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
fi

echo "正在启动：$URL"
echo "关闭此窗口或按 Ctrl+C 即可停止服务。"
echo

AUTO_OPEN=1 python3 server.py

STATUS=$?
echo
if [[ $STATUS -ne 0 ]]; then
  echo "启动失败，错误代码：$STATUS"
  read "?按回车键关闭窗口..."
fi
