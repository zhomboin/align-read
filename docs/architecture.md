# AlignRead（对阅）实现架构

本文记录双栏与选词翻译实现。功能范围见 [产品需求](AlignRead_PRD_v1.1.md)，兼容性与发布进度见 [测试计划](test-plan.md)。

## 1. 已实现功能

| 范围 | PRD | 实际交付 |
| --- | --- | --- |
| 操作入口 | F-01、F-08 | Popup 开启、暂停、恢复和关闭；切换语言与提取范围；Options 管理 Provider、缓存、站点禁用和阅读偏好 |
| 双栏阅读 | F-02、F-03 | 左栏保留真实原网页及原有交互；右栏是独立滚动的结构化只读译文；分隔条可拖动，默认各半，左栏可调范围为 35%–70% |
| 原译对齐 | F-04、F-05 | 段落级双向悬停高亮、直接点击定位和按锚点联动。译文支持 Enter 定位，同步默认开启 |
| 翻译执行 | F-06 | 支持 Google Cloud Translation Basic、有道智云、DeepSeek、MiniMax 和自定义 AI。分批翻译、增量展示、失败可重试，多个标签页独立运行 |
| 恢复与边界 | F-07、F-08 | 关闭和失效时清理扩展的页面改动；受限页面和布局冲突给出原因；外发前确认，排除敏感输入 |
| 选词翻译 | F-09 | 独立按标签页启停。选中原文后按需翻译，卡片支持复制、重试和关闭 |

默认源语言自动检测，目标为简体中文。默认范围是页面中可见且可阅读的文字，包含可识别的导航、侧栏和页脚，范围覆盖可滚动页面。用户可切换为仅正文。MVP 发布以 AC-01 至 AC-16 为准。

后续 P1 包括 SPA 增量翻译、原文下方插入译文、替换式翻译及句子级对齐。P2 包括词组对齐、扩展 Provider 支持、浏览器内翻译、复杂文档专项适配及个性化规则。原生 PDF、受限浏览器页面、iframe 和 Canvas 内容按 PRD 边界处理。

## 2. 技术基线与代码结构

采用 **Chrome 桌面 Manifest V3、TypeScript、WXT、React**。WXT 管理扩展入口、开发构建和打包。React 用于 Popup、Options 和右栏。提取、映射、滚动和任务编排采用独立 TypeScript 模块。翻译适配器支持 Google Cloud Translation Basic v2、有道智云 NMT 批量翻译和兼容 OpenAI Chat Completions 的 AI 服务。用户在设置页填写各自凭据，并分别授权向服务发送可翻译文本。

```text
alignread-extension/
  wxt.config.ts
  entrypoints/
    background.ts              # MV3 Service Worker
    reader.ts                  # 由 scripting API 在顶层文档按需注入
    selection.ts               # 按需注入选词功能
    popup/                     # 当前标签页的状态与操作
    options/                   # 全局配置、站点规则和隐私设置
  src/
    reader/
      session/                 # 页面会话、任务队列、页面生命周期
      extraction/              # 提取、过滤、分段和结构化阅读树
      layout/                  # 分栏、分隔条、页面改动记录和恢复
      alignment/               # 源节点映射、高亮、定位与滚动联动
      ui/                      # Shadow DOM 里的工具栏和译文面板
    selection/                 # 选区检查、翻译会话与浮动卡片
    background/
      translation/             # Provider 契约、适配器、请求校验和限流
      settings/                # 设置、授权记录、存储访问
    shared/                    # 可序列化类型、消息协议和错误码
  tests/
    release-check.cjs          # 检查生产构建，运行 Worker 和 Chromium 回归
    selection-check.cjs        # AC-P1-01 及选词边界用例
    fixtures/                  # 本地静态页面及结构样本
```

| 运行上下文 | 持有的状态与职责 |
| --- | --- |
| Popup / Options | 工具栏弹窗操作当前文档。独立标签页中的设置按翻译服务、双栏阅读、站点与缓存分区，阅读与站点偏好按分类保存。两者都通过 Worker 处理请求。弹窗关闭后翻译继续。 |
| Content Script | 每个顶层文档独立持有双栏和选词会话。各自使用 Shadow DOM 挂载界面，双栏负责段落映射、任务队列和会话缓存。 |
| Service Worker | 接收扩展操作、执行注入、管理授权和设置、核验来自页面的请求、执行 Provider 批次并统一限流。 |
| Storage | `storage.local` 保存设置、凭据和服务授权记录，`storage.session` 保存标签页与文档的临时任务授权。原文、译文和 DOM 映射留在各自会话内存。 |

双栏和选词脚本均由 Worker 用 `chrome.scripting.executeScript` 按需注入。状态查询没有回复或发送失败时，注入对应脚本。同一文档内已加载的脚本可复用。Chrome 可以回收 Worker，页面队列保留在 Content Script，设置从存储重读，Worker 内的并发槽与请求控制器只服务当前在途批次。

## 3. 双栏与段落映射

**左栏布局。** Reader 创建固定在右侧的宿主元素，工具栏、分隔条和译文挂载在闭合 Shadow DOM 内。用可撤销的样式表将原页的 `body` 约束为左侧独立滚动容器，保留原有 DOM 树。布局模块识别原页的目录和正文列，对溢出子元素以及固定页边栏、Cookie 提示条等应用受控的尺寸或位置调整。启动时先校验分栏布局，通过后才派发翻译请求。视口低于 960 CSS px、网页进入全屏或布局校验失败时，退出双栏并提示原因。

**布局恢复。** 初始化失败、主动关闭及会话失效走同一清理入口。对原页被调整的内联属性记录原值、优先级及扩展最后写入值，撤回前检查当前值，以保留站点自身更新。关闭时移除扩展样式和宿主元素，按原来的容器恢复滚动位置，释放观察器、事件监听、高亮和在途任务。

**提取与阅读树。** `extraction/document.ts` 在左栏缩窄前提取所选范围。仅正文优先识别 `main`、`article` 和语义区域，必要时回退到文档遍历。提取节点的实际位置、可见性、阅读顺序及可保留的样式属性。跳过隐藏内容、表单值、编辑区及扩展 UI。代码等保留内容使用原文，图片使用占位。长页提取会分片执行。

**译文布局。** 根据实际坐标识别同排卡片、嵌套列组、网格列表和导航，保留列顺序及相对权重。窄栏允许卡片换行，横排 Tab 在自身区域滚动并保留可识别的选中态。阅读树保留提示框外观、行内样式和换行、列表标记、图注及表格语义。表格拥有独立的横向滚动区域，折叠区使用启动时的可见状态。React 使用受支持的节点及文本渲染译文，右栏安全链接在新标签页打开。

**身份与定位。** 阅读树描述右栏的结构。每个可定位块分配独立的 `segmentId`，翻译结果使用同一 ID；相同文字在不同位置仍有独立 ID。页面会话另有一张 ID 到 `Node` / `Range`、文本指纹和位置的映射。缓存命中后把译文分发给各自的 ID。定位前验证节点仍连接且内容有效。静态页面发生相关结构变化时，失效旧映射和任务，提示重新翻译；SPA 增量修复进入 P1。

**联动。** 两侧注册各自的滚动上下文，按段落 ID 选取视口锚点，通过动画帧合并更新。程序化滚动使用短期抑制标记，收到对侧真实用户输入时转移主导侧。等待、失败与跳过的块保留布局与定位锚点。原文高亮优先使用 CSS Custom Highlight 和 Range；兼容回退可采用不接收指针事件的描边。原文与译文均可直接点击普通文字定位对侧，译文块可用 Tab 聚焦并按 Enter。链接、重试按钮和拖选文字保留各自操作。

## 4. 会话与消息协议

| 协议 | 方向 | 关键约束 |
| --- | --- | --- |
| `page`、`start`、`control` | Popup → Worker | Worker 校验标签页、服务配置和页面授权。注入 Reader 后把操作绑定到浏览器返回的 `documentId`。 |
| `reader:start`、`reader:state`、`reader:pause`、`reader:resume`、`reader:stop` | Worker → Reader | 定向操作当前文档的 Reader 会话。 |
| `batch` | Reader → Worker | Worker 根据浏览器提供的标签页和文档身份核验顶层发送者，并检查 `sessionId`、批次内容、配置版本与翻译授权。 |
| 批次响应 | Worker → Reader | 通过原消息返回批次 ID 和翻译项 ID。Reader 将结果归入当前阅读块，处理超时、缺失结果或会话取消。 |
| `closed`、`resize` | Reader → Worker | 当前文档关闭会话或保存栏宽偏好。关闭后 Worker 取消对应在途任务并移除临时授权。 |
| `reader:clear-cache` | Worker → Reader | 在设置页清空或关闭缓存时，通知活跃 Reader。 |
| `selection-start`、`selection-stop` | Popup → Worker | 校验服务和当前文档，独立管理选词会话。 |
| `selection:start`、`selection:state`、`selection:stop` | Worker → 选词脚本 | 绑定到当前文档，挂载、查询或清理选词界面。 |
| `selection:translate`、`selection:cancel`、`selection:closed` | 选词脚本 → Worker | 验证会话、文档、页面地址和请求编号，复用 Provider 调度执行单项请求。 |

每次开启生成独立会话 ID。Worker 维护标签页与文档的授权，Reader 维护阅读树、翻译项与段落映射。刷新、导航、`pagehide` 或关闭会令旧会话失效。切换翻译服务后需重新开启。切换标签页只改变 Popup 的操作目标，各文档的翻译独立进行。

Reader 状态为 `preparing`、`translating`、`paused`、`partial`、`ready`、`error`。无活动会话时显示原文。暂停停止派发后续批次，在途批次可完成。关闭立即阻止迟到结果应用，Worker 中断或请求失败的批次可重试。

选词脚本过滤不可见或受限选区。用户触发后，最多发送 1000 字符，选区或页面变化时丢弃旧响应。保存原选区供定位，卡片在双栏之上显示。界面和会话各自清理，选词译文仅保留在当前卡片内存。

## 5. Provider、缓存与权限

- **调度。** 页面会话维护段落优先级、去重和批次进度。Worker 校验批次大小与来源并限制并发。服务适配器负责网络超时，Google 适配器对 429 执行限次退避，有道和 AI 适配器返回限流状态。鉴权失败、配额不足和不支持的语言对返回独立错误。部分失败时保留成功译文，并允许重试失败项。
- **契约。** `translateSegments(request, credentials, signal)` 接受带批次 ID、阅读选项及译文项 ID 的请求，以及服务凭据和取消信号。Provider 适配器校验并规范化返回值，遗漏、重复和未知 ID 不得错误回填。服务只支持按输入顺序返回时，以明确的服务契约为依据并核验返回数量与类型，异常批次不得盲配。外部请求从 Worker 发起，业务正文只发可翻译文本和必要语言参数，段落 ID 留在本地，服务协议确需关联标识时使用不含页面身份的临时标识。
- **AI 响应。** DeepSeek 使用 JSON 输出模式。MiniMax 使用流式响应，后台拼接译文片段后再校验，推理内容跳过。MiniMax 等待首次响应或连续无数据的时限为 27 秒，单次请求最多 90 秒。Worker 用批次内临时序号匹配译文，要求每个序号恰好出现一次且译文非空。修改当前服务的端点、模型或密钥后，重新开启双栏和选词。 [AI 适配器](../alignread-extension/src/background/translation/ai.ts) · [DeepSeek JSON 输出](https://api-docs.deepseek.com/guides/json_mode/) · [MiniMax 流式响应](https://platform.minimax.io/docs/api-reference/text-openai-api#streaming-response)
- **缓存。** Reader 在单次会话内按规范化待译文本复用结果，语言方向、Provider 和配置版本由会话绑定。每个会话最多 750 项或约 256 KB，敏感页面跳过缓存。设置页可关闭、查看估算占用和清空。关闭或清空时通知活跃 Reader，并阻止旧批次写回缓存。
- **页面权限。** 基础权限采用 `activeTab`、`scripting`、`storage`，点击后只注入支持的顶层文档。站点禁用先于注入检查，受限页面显示不可用原因。
- **外发权限。** Worker 每批次检查当前服务的授权和配置。Google、有道和 DeepSeek 使用固定 HTTPS 域名，MiniMax 按所选站点访问官方域名，自定义 AI 使用用户填写的地址。保存并同意外发时仅申请对应主机的可选权限，与网页的临时访问权限独立。页面消息无法指定服务地址，请求不跟随重定向。页面 URL、Cookies、表单内容及 DOM 不进入外发请求。密钥保存在受信任的扩展存储中，设置摘要返回配置状态、公开字段及脱敏信息。 [Chrome 可选权限](https://developer.chrome.com/docs/extensions/reference/api/permissions)

## 6. 实施与验收

| 阶段 | 实施内容 | 验证方式 |
| --- | --- | --- |
| M0 工程与布局原型 | 起 WXT 工程，打通 Popup、Options、Worker、Reader，验证空面板挂载与卸载 | 用本地 HTTP fixture 检查 Manifest、真实网页交互、固定或粘性元素、窄窗口、重复启停与恢复（AC-06、AC-09、AC-14、AC-16 的基础场景） |
| M1 提取与对齐 | 范围过滤、拖拽、结构化阅读树、段落 ID 和双向滚动 | 用预置译文验证结构、重复段落、原站点击与双向定位（AC-01 至 AC-07） |
| M2 真实翻译 | Provider 接入、外发确认、调度、缓存、错误反馈和多标签隔离 | 验证部分失败、关闭/导航、多标签、授权与敏感输入（AC-08 至 AC-15）；模拟 Worker 中断并核对批次状态 |
| M3 稳定与发布 | 实测普通博客、技术文档及 README，验证长页性能和分发权限 | 通过 AC-01 至 AC-16；记录 100、500、1000 段表现和点击到初次反馈的时间，确认最低 Chrome 版本及站点适配范围 |

选词翻译按 AC-P1-01 验收。GitHub Actions 执行 Chromium、Worker 和 ZIP 全量回归。最低支持版本在 Manifest 中声明为 Chrome 116。 [回归与验收](test-plan.md)

## 参考资料

- [Chrome activeTab 权限](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome 扩展网络请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Chrome 扩展 Service Worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome 扩展 Runtime API](https://developer.chrome.com/docs/extensions/reference/api/runtime)
- [Chrome 扩展 Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [WXT Scripting](https://wxt.dev/guide/essentials/scripting)
- [MDN CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API)
- [MDN CSS width 媒体特性](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/width)
