# AlignRead 隐私政策

更新日期为 2026 年 11 月 18 日。本政策适用于 AlignRead（对阅）Chrome 扩展 0.1.7 的双栏翻译、选词翻译及翻译服务设置。扩展没有自营翻译服务器、用户账户、广告或遥测。

## 扩展读取什么

- 双栏翻译在你主动开启后读取当前标签页所选范围内的可见文字，包括标题、链接文字、列表、表格和图注。双栏保持开启时，原页内容更新或站内换页后，该范围内新增或修改的可见文字会按需发送。右栏布局、段落定位和高亮在浏览器本地处理，图片以本地占位显示。
- 选词翻译需在当前标签页开启。扩展读取你选中的可见文字，在你点击「译」或重试时发送选中文字。点击「复制」时，译文写入系统剪贴板。
- 扩展跳过表单、密码、可编辑区域和隐藏内容。扩展在本机检查网页地址，用于识别禁用站点、敏感页面、站内换页和失效的选词会话。切换到识别为敏感的新页面时，扩展会关闭双栏，重新开启前需要确认。可见文字本身仍可能包含个人资料。

## 数据发给谁

你保存服务凭据、同意发送待译文字并授予对应域名的访问权限后，扩展从浏览器经 HTTPS 直接向你选定的服务发送待译文字和语言参数。扩展不在请求中附带网页地址、网页 Cookie、网页结构或表单值。点击「测试连接」时，扩展用该服务的凭据发送固定示例文本。

- **Google Cloud Translation Basic**（ translation.googleapis.com ）接收你的 Google API 密钥。 [Google Cloud Translation 数据使用说明](https://docs.cloud.google.com/translate/data-usage)
- **有道智云**（ openapi.youdao.com ）接收应用 ID、请求签名和签名所需的请求时间与随机值。应用密钥留在本机生成签名。 [有道智云隐私政策](https://ai.youdao.com/DOCSIRMA/html/agreement/privacy/ydyszc/index.html)
- **ChatGPT（OpenAI）**（api.openai.com）、**Gemini**（generativelanguage.googleapis.com）、**Grok**（api.x.ai）、**GLM**（open.bigmodel.cn）、**Kimi**（api.moonshot.cn）、**豆包**（ark.cn-beijing.volces.com）、**腾讯混元**（tokenhub.tencentmaas.com）、**DeepSeek**（api.deepseek.com）、**MiniMax**（中国站 api.minimax.cn 或国际站 api.minimax.io）和**自定义 AI 翻译**（你配置的 HTTPS 接口）还会接收模型名称、用于匹配译文的临时序号，以及对应的 API 密钥。 [DeepSeek 开放平台隐私政策](https://cdn.deepseek.com/policies/zh-CN/deepseek-open-platform-privacy-policy.html) · [MiniMax 中国站隐私政策](https://design.minimax.cn/protocol/privacy-policy) · [MiniMax 国际站隐私政策](https://platform.minimax.io/protocol/privacy-policy)

第三方收到的数据由相应运营方依其条款和隐私政策处理。自定义 AI 翻译适用你所填接口的运营方条款。翻译服务的额度和计费由该服务运营方管理。

## 本地保存与删除

- 扩展在本机 Chrome 扩展存储中保存翻译服务的凭据与配置、文本外发同意、连接测试时间与结果、阅读偏好和禁用站点。扩展不使用 Chrome Sync 同步这些数据。标签页和文档的临时授权保存在浏览器会话存储中。双栏和选词会话记录开启时的网页地址，用于在本机校验翻译请求。
- 送译文字和返回的译文在当前翻译会话的内存中处理。切换到其他路径或哈希路由、关闭双栏、刷新或关闭网页时清空双栏缓存。可在设置中关闭或清空双栏缓存，识别为敏感的页面会跳过缓存。选词译文会在关闭卡片、切换选区或会话结束时释放。
- 你可以在设置中撤销发送同意、清除服务凭据或恢复默认设置，也可以在 Chrome 的扩展管理页面撤销服务域名权限或卸载扩展。已发送的数据按所选服务的条款处理。

## 浏览器权限

- 主动操作扩展时，activeTab 提供对当前标签页的临时访问，scripting 用于按需挂载双栏和选词界面、读取相应文字。storage 用于保存本机配置和当前浏览器会话的任务授权。
- 扩展按需申请所选服务的 HTTPS 主机权限，用于翻译和连接测试。自定义 AI 翻译仅申请你填写的接口主机。

## 数据使用与联系

AlignRead 仅为提供你请求的网页翻译及连接测试而使用和传输用户数据。AlignRead 不出售用户数据，也不将其用于广告、信用评估或借贷。AlignRead 对用户数据的使用和传输遵循 Chrome 网上应用店用户数据政策及其 Limited Use 要求。 [Chrome 网上应用店 Limited Use 政策](https://developer.chrome.com/docs/webstore/program-policies/limited-use)

如有隐私问题，请通过 Chrome 网上应用店 AlignRead 条目中列出的开发者联系方式联系维护者。
