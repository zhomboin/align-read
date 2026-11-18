# 翻译服务配置

在扩展弹窗点击「设置」，从「配置服务」中选择一个服务并填写凭据。勾选文本外发授权，点击「保存设置」，同意 Chrome 对该服务域名的访问请求。点「测试连接」后，点击「设为当前服务」。各服务分别保存配置、凭据和测试结果。

## AI 翻译 API

下表为预设和默认模型。可改为账户已开通、支持文本 Chat Completions 的其他模型；AI 订阅与开放平台的 API 凭据和额度分别管理。

| 服务 | 默认模型 | 获取凭据与配置 |
| --- | --- | --- |
| ChatGPT（OpenAI） | `gpt-5.4-mini` | 使用 [OpenAI API 平台](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) 的项目 API 密钥 |
| Gemini | `gemini-3.1-flash-lite` | 使用 [Gemini API](https://ai.google.dev/gemini-api/docs/openai) 的 Google AI Studio 密钥 |
| Grok | `grok-4.3` | 使用 [xAI API](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions) 的推理 API 密钥 |
| GLM（智谱） | `glm-5.3-flash` | 使用 [智谱开放平台](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash) 的 API 密钥 |
| Kimi | `kimi-k3` | 使用 [Kimi API 开放平台](https://platform.kimi.com/docs/models) 的 API 密钥 |
| 豆包（火山方舟） | `doubao-seed-2-0-lite-260215` | 使用[火山方舟数据面](https://docs.volcengine.com/docs/ark/base-url-and-authentication?lang=zh) API 密钥，模型栏也可填写自己的推理接入点 ID |
| 腾讯混元 | `hy3` | 使用[腾讯云 TokenHub（中国大陆）](https://cloud.tencent.com/document/product/1823/132252)的 API 密钥 |
| DeepSeek | `deepseek-flash` | 使用 [DeepSeek API](https://api-docs.deepseek.com/) 的 API 密钥 |
| MiniMax | `MiniMax-M3.1-Flash` | 按密钥所属站点选择[中国站](https://platform.minimax.cn/docs/api-reference/text-openai-api)或[国际站](https://platform.minimax.io/docs/api-reference/text-openai-api) |
| AI 翻译 | 由用户填写 | 填写完整 HTTPS Chat Completions 地址、模型名称及 API 密钥，例如地址 `https://api.example.com/v1/chat/completions` |

更换自定义接口地址或 MiniMax 站点时，需要为新地址填写密钥并重新授权。浏览器只会申请所选接口的主机权限。密钥保存在本机扩展存储，清除某个服务配置后可重新填写。

## 其他翻译 API

- **有道智云**：在控制台开通[批量文本翻译（NMT）](https://ai.youdao.com/DOCSIRMA/html/trans/api/plwbfy/index.html)，填写应用 ID 和应用密钥，按提示授予 `openapi.youdao.com` 的访问权限。
- **Google Cloud Translation Basic**：在 Google Cloud 项目启用计费和 [Cloud Translation API](https://docs.cloud.google.com/translate/docs/setup)，创建仅允许此 API 的密钥，按提示授予 `translation.googleapis.com` 的访问权限。
