# AlignRead（对阅）

AlignRead 是 Chrome 桌面扩展。左栏保留可交互的原网页，右栏显示结构化译文，两侧可按段落定位和联动滚动。也可直接翻译选中的单词或短句。 [项目进度](docs/progress.md)

- [产品需求](docs/AlignRead_PRD_v1.1.md)
- [实现架构](docs/architecture.md)
- [本地开发](docs/development.md)
- [Chrome 网上应用店上架](docs/chrome-web-store.md)
- [隐私政策](docs/privacy-policy.md)
- [项目进度](docs/progress.md)与[版本记录](docs/version.md)

## 配置翻译和开始使用

1. 点击 AlignRead 图标，再点击「设置」打开完整设置页。在「配置服务」下拉框选择服务，填写下方表单。保存并授权后，点击「设为当前服务」启用所选服务。
   - **有道智云**。在有道控制台开通「批量文本翻译（NMT）」，填写应用 ID 和应用密钥，勾选外发授权，点击「保存有道设置」并允许访问 `openapi.youdao.com`。已保存凭据时，可留空并直接保存授权。 [有道智云批量翻译文档](https://ai.youdao.com/DOCSIRMA/html/trans/api/plwbfy/index.html)
   - **Google Cloud Translation Basic**。在 Google Cloud 项目开启计费并启用 Cloud Translation API，创建仅允许调用该 API 的密钥。在扩展里填写密钥，勾选外发授权，点击「保存 Google 设置」并允许访问 `translation.googleapis.com`。 [Google Cloud Translation 设置](https://docs.cloud.google.com/translate/docs/setup)
   - **AI 翻译**。填写兼容 OpenAI Chat Completions 的完整 HTTPS 地址（如 `https://api.example.com/v1/chat/completions`）、模型名称和 API 密钥。勾选文本外发授权，点击「保存 AI 设置」并允许访问配置的域名，然后点击「测试连接」。更换接口地址时需要重新填写密钥。 [兼容接口示例](https://docs.vllm.ai/en/latest/serving/openai_compatible_server/)
   - **DeepSeek**。使用官方接口，默认模型为 `deepseek-flash`。填写自己的 DeepSeek API 密钥，勾选外发授权，保存后允许访问 `api.deepseek.com`，再测试连接。 [DeepSeek API 文档](https://api-docs.deepseek.com/)
   - **MiniMax**。按密钥所属平台选择中国站或国际站，默认模型为 `MiniMax-M3.1-Flash`。填写对应站点的 API 密钥，勾选外发授权，保存后允许访问该站点的 API 域名，再测试连接。 [中国站文档](https://platform.minimax.cn/docs/api-reference/text-openai-api) · [国际站文档](https://platform.minimax.io/docs/api-reference/text-openai-api)
2. 打开普通文章或技术文档，选择原文、译文语言以及「整页可见文字」或「仅正文」，点击「开启双栏」。默认自动检测原文语言、译为简体中文。
3. 译文分批到达。直接点击译文文字，左栏会滚动并高亮对应原文段落。用 Tab 聚焦译文段落后，按 Enter 也可定位。点击原文普通文字可反向定位，链接和文本选区保留各自的操作。
4. 拖动分隔条或聚焦后按左右方向键调整宽度。同步滚动和悬停高亮默认开启，可在右栏切换。翻译可暂停、继续或重试失败段落。
5. 点击右栏「关闭」或扩展弹窗的「关闭双栏」，恢复原页。视口宽度不足 960 CSS px 或网页无法安全分栏时，扩展会提示原因。

可以在工具栏弹窗的「翻译服务」中切换已保存凭据的服务。标为「待授权」的服务需要在设置页完成授权。切换后，重新开启双栏或选词翻译即可使用新服务。

在设置页的「双栏阅读」中调整默认语言、翻译范围和阅读偏好。在「站点与缓存」中管理禁用域名和会话缓存，或恢复默认设置。修改偏好后，在所在分类点击「保存设置」。

### 选词翻译

在扩展弹窗选择语言，点击「开启选词翻译」。在普通网页或双栏原文中选中单词或短句，再点击选区旁的「译」。卡片可复制译文或重试，按 Esc 或点击卡片外可关闭。只有点击「译」或重试时，才向当前服务发送选中文字，每次最多 1000 字符。

在扩展弹窗点击「关闭选词翻译」可停用。刷新、地址变化或切换翻译服务后，需要重新开启。

译文尽量保留原页的阅读结构。卡片和页脚分组在有空间时横排，拖窄后可换行。横排 Tab 保留顺序和可识别的选中态，空间不足时可在 Tab 条内横向滚动。普通列表保留编号或项目符号，宽表格可独立横向滚动。图片使用占位，图注照常翻译。

凭据保存在本机扩展存储中，各服务分别授权。设置页可以测试连接，结果和测试时间会保留在本机。表单、可编辑区域及隐藏内容会被排除，识别为敏感的页面需要额外确认。双栏缓存仅保留在当前阅读会话。扩展支持普通网页，原生 PDF、浏览器内部页、iframe 和 Canvas 内容暂未支持。
