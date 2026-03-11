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

# 仅在 package.json/package-lock.json 有变动时执行 npm install
do_install() {
  local dir="$1"
  (cd "$dir" 2>/dev/null) || return
  if [ ! -d "$dir/node_modules" ]; then
    echo "[依赖] $dir: node_modules 不存在，安装中..."
    (cd "$dir" && npm install)
    return
  fi
  local need=0
  [ "$dir/package.json" -nt "$dir/node_modules" ] 2>/dev/null && need=1
  [ -f "$dir/package-lock.json" ] && [ "$dir/package-lock.json" -nt "$dir/node_modules" ] 2>/dev/null && need=1
  if [ "$need" = "1" ]; then
    echo "[依赖] $dir: 检测到变动，安装中..."
    (cd "$dir" && npm install)
  else
    echo "[依赖] $dir: 无变动，跳过"
  fi
}
echo "[重启] 检查依赖..."
do_install .
do_install client
do_install server

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
