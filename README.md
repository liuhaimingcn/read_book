# 两人共读

两人一起读书的网站，支持上传 txt 文件，创建房间后两人可同步阅读，双方都点击「读完了」后自动翻页。

## 快速开始

### 1. 安装依赖

```bash
npm install
cd client && npm install
cd ../server && npm install
```

### 2. 启动服务

**方式一：分别启动（推荐开发时使用）**

终端 1 - 启动后端：
```bash
cd server && npm start
```

终端 2 - 启动前端：
```bash
cd client && npm run dev
```

**方式二：同时启动**
```bash
npm run dev
```

### 3. 使用

1. 打开浏览器访问 http://localhost:3100（或终端显示的地址）
2. 上传一个或多个 txt 文件
3. 选择要读的书，点击「创建房间并开始阅读」
4. 复制房间链接或房间 ID，分享给好友
5. 好友通过链接或输入房间 ID 加入
6. 两人都点击「读完了」后，自动翻到下一页
7. 点击「开始语音」可实时语音通话（支持电脑和手机）

## 技术栈

- 前端：React + Vite
- 后端：Node.js + Express
- 实时通信：Socket.io
- 语音通话：WebRTC (simple-peer)

## 项目结构

```
read_book/
├── client/          # 前端
├── server/          # 后端
├── 方案.md          # 详细方案文档
└── README.md
```
