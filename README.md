# Hangla Rank

一个用于制作“从夯到拉排行榜”视频的 Next.js 应用。应用支持导入素材、配置排行榜行、编辑分阶段旁白，并在浏览器中生成带动画和字幕的视频。

## 功能

- 本地导入图片素材并编辑排行榜行。
- 导入符合 `/.well-known/hangla-products.json` 约定的产品数据。
- 使用 MiMo TTS 或自定义 TTS 接口生成旁白。
- 在浏览器端合成带动画、字幕和 BGM 的视频。

## 开发

```bash
npm install
cp .env.example .env.local
npm run dev
```

默认开发地址：

```text
http://localhost:3000
```

## 常用命令

```bash
npm run dev
npm run build
npm run start
```

## 环境变量

```bash
MIMO_API_KEY=your_mimo_api_key
# XIAOMI_API_KEY=your_legacy_xiaomi_api_key
# MIMO_CHAT_COMPLETIONS_URL=https://api.xiaomimimo.com/v1/chat/completions
# MIMO_VOICE_CLONE_REFERENCE_PATH=.voice-clone/default-reference.mp3
# TTS_RATE_LIMIT_MAX_REQUESTS=20
# TTS_RATE_LIMIT_WINDOW_MS=60000
# TTS_MAX_TEXT_LENGTH=1000
# TTS_MAX_AUDIO_BYTES=12582912
# TTS_MAX_JSON_BYTES=1048576
```

默认情况下，服务端 TTS 代理会拒绝访问 localhost、内网和保留地址。仅在可信本地环境调试私有 TTS 上游时，才设置：

```bash
ALLOW_PRIVATE_TTS_UPSTREAMS=true
```

## 开源说明

- 代码使用 MIT License，详见 [LICENSE](LICENSE)。
- 内置 BGM 文件 `public/audio/si-tu-vois-ma-mere.mp3` 来源于网络，仅作为演示素材记录在 [NOTICE.md](NOTICE.md)。该来源标注不代表已获得开源再分发授权；正式公开或商用发布前，建议替换为你拥有明确授权的音频。
- 请不要提交 `.env.local` 或任何真实 API key。

## 说明

- 生成视频依赖浏览器端媒体能力和 `@ffmpeg/ffmpeg`。
- 语音生成默认通过 `app/api/tts/route.ts` 代理到 MiMo `mimo-v2.5-tts-voiceclone`，服务端需要设置 `MIMO_API_KEY`，并在 `.voice-clone/default-reference.mp3` 放入已授权的参考音频；生成面板中仍可切换到 MiMo 内置声线或自定义兼容旧格式的 TTS API 地址模板。
- `/api/tts` 包含基础内存限流、文本长度限制、音频大小限制和公网 URL 校验；如果部署在多实例或边缘环境，建议额外接入平台级限流。
- `.next/`、`node_modules/`、Playwright 输出和本地生成文件不会进入 Git。

## Vercel 部署

- 在 Vercel 项目 Settings → Environment Variables 中添加 `MIMO_API_KEY`，按需勾选 Production、Preview、Development 环境。
- `.voice-clone/default-reference.mp3` 会随 Git 部署，并通过 `next.config.mjs` 的 `outputFileTracingIncludes` 打包进 `/api/tts` 函数；通常不需要设置 `MIMO_VOICE_CLONE_REFERENCE_PATH`。
- 如果后续更换参考音频，直接替换 `.voice-clone/default-reference.mp3` 后重新提交部署；如果改用其他路径，需要同步更新 `MIMO_VOICE_CLONE_REFERENCE_PATH` 和 `next.config.mjs` 的 tracing include。
