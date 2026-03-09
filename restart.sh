#!/bin/bash
# 重启脚本 - 同时启动前后端
# 用法: ./restart.sh        # 前台运行（后端+前端）
#       ./restart.sh -d     # 后台运行（后端+前端）

cd "$(dirname "$0")"
PORT_SERVER=3101
PORT_CLIENT=3100

echo "[重启] 停止端口 $PORT_SERVER、$PORT_CLIENT 上的进程..."
lsof -ti:$PORT_SERVER | xargs kill -9 2>/dev/null || true
lsof -ti:$PORT_CLIENT | xargs kill -9 2>/dev/null || true
sleep 1

echo "[重启] 启动服务..."
if [ "$1" = "-d" ]; then
  nohup node server/index.js > server.log 2>&1 &
  sleep 1
  nohup npm run dev:client > client.log 2>&1 &
  echo "[重启] 后端+前端已后台启动"
  echo "  - 后端: http://localhost:$PORT_SERVER"
  echo "  - 前端: http://localhost:$PORT_CLIENT"
  echo "  - 日志: server.log, client.log"
else
  npm run dev
fi
