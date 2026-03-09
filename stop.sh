#!/bin/bash
# 停止前后端服务
# 用法: ./stop.sh  或  npm run stop

cd "$(dirname "$0")"
PORT_SERVER=3101
PORT_CLIENT=3100

echo "[停止] 停止端口 $PORT_SERVER、$PORT_CLIENT 上的进程..."
lsof -ti:$PORT_SERVER | xargs kill -9 2>/dev/null || true
lsof -ti:$PORT_CLIENT | xargs kill -9 2>/dev/null || true
echo "[停止] 已停止"
