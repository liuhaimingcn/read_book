#!/bin/bash
# 重启脚本 - 服务端运行
# 用法: ./restart.sh        # 前台运行
#       ./restart.sh -d     # 后台运行

cd "$(dirname "$0")"
PORT=3000

echo "[重启] 停止端口 $PORT 上的进程..."
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
sleep 1

echo "[重启] 启动服务..."
if [ "$1" = "-d" ]; then
  nohup node server/index.js > server.log 2>&1 &
  echo "[重启] 进程已后台启动，日志: server.log"
else
  node server/index.js
fi
