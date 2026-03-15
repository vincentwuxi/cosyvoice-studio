# CosyVoice Studio

> 🎤 基于 [CosyVoice](https://github.com/FunAudioLLM/CosyVoice) 的 AI 声音克隆与语音合成 Web 工作站

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-blue" alt="version" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node" />
</p>

## ✨ 功能特性

### 四大合成模式
| 模式 | 说明 | 状态 |
|------|------|------|
| 🎤 **声音克隆** | 上传/录制参考音频 → AI 学习音色 → 克隆合成 | 依赖模型 |
| 🗣️ **预设音色** | 7 种内置音色（中/英/日/粤/韩）× 自由文本 | ✅ 可用 |
| 🌍 **跨语言合成** | 参考音色 + 任意语言文本 → 跨语言朗读 | 依赖模型 |
| ✨ **指令控制** | 自然语言指令（开心/悲伤/播音/温柔）控制合成效果 | 依赖模型 |

### 核心能力
- **📋 批量生成** — 每行一条文本 → 逐条排队生成 → 进度可视化 → ZIP 打包一键下载
- **🎵 格式选择** — WAV（无损）/ MP3（更小）输出格式
- **📚 声音库** — 保存、命名、标签管理克隆的声音 Profile，支持跨模式调用
- **📜 历史记录** — 所有生成结果自动保存，支持回听和下载
- **⚡ 智能模式感知** — 自动检测服务端模型能力，禁用不支持的模式
- **🎯 文本模板** — 多语言示例文本一键填充，快速体验
- **⏱️ 时长预估** — 根据文字数量估算生成时间
- **🔒 录音保护** — 10 秒倒计时提示 → 15 秒自动停止

## 🚀 快速开始

### 前置条件
- Node.js ≥ 18
- 一个运行中的 CosyVoice 服务端（[部署指南](https://github.com/FunAudioLLM/CosyVoice)）

### 安装

```bash
git clone <your-repo-url> cosyvoice-studio
cd cosyvoice-studio
npm install
```

### 配置

编辑 `vite.config.js` 中的代理目标地址，指向你的 CosyVoice 服务：

```javascript
proxy: {
  '/api': {
    target: 'http://your-server-ip:50000',  // ← 改成你的服务地址
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ''),
  }
}
```

### 运行

```bash
npm run dev
```

浏览器打开 `http://localhost:5173` 即可使用。

### 构建

```bash
npm run build
```

产物在 `dist/` 目录，可部署到任意静态服务器。

## 📁 项目结构

```
cosyvoice-studio/
├── index.html          # 主页面（4 模式 Tab + 历史侧栏 + 声音库弹窗）
├── vite.config.js      # Vite 配置（代理 + 构建）
├── package.json        # 依赖管理
└── src/
    ├── main.js         # 主入口（Tab/模式切换/生成/批量/模板/声音库）
    ├── api.js          # API 层（SFT/ZeroShot/CrossLingual/Instruct2）
    ├── batch.js        # 批量生成引擎（队列 + ZIP 打包 + 时长预估）
    ├── format.js       # 音频格式转换（WAV→MP3 + 语义化命名）
    ├── recorder.js     # 录音模块（MediaRecorder + WAV 编码）
    ├── player.js       # 播放器（波形可视化 + 播放控制）
    ├── history.js      # 历史记录（IndexedDB 持久化）
    ├── voicelib.js     # 声音库（IndexedDB + localStorage 元数据）
    └── style.css       # 全局样式（暗色主题 + 玻璃拟态）
```

## 🛠️ 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vanilla JS + HTML + CSS（无框架） |
| 构建 | Vite 6 |
| 存储 | IndexedDB + localStorage |
| 音频 | Web Audio API + MediaRecorder |
| 打包 | JSZip |
| 编码 | @breezystack/lamejs（MP3） |

## 📋 API 端点

Studio 通过 Vite 代理调用以下 CosyVoice API：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 健康检查 + 服务信息 |
| `/inference_sft` | POST | 预设音色合成 |
| `/inference_zero_shot` | POST | 声音克隆 |
| `/inference_cross_lingual` | POST | 跨语言合成 |
| `/inference_instruct2` | POST | 指令控制合成 |

## 📜 License

MIT
