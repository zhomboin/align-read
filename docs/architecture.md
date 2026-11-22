# AlignRead（对阅）实现架构

本文记录双栏、原位和选词翻译的实现。 [产品需求](AlignRead_PRD_v1.1.md) · [测试与验收](test-plan.md)

## 1. 已实现功能

| 范围 | PRD | 实际交付 |
| --- | --- | --- |
| 操作入口 | F-01、F-08 | 弹窗选择模式、语言和提取范围，控制当前标签页的翻译。设置页管理服务、缓存、站点禁用和阅读偏好 |
| 双栏阅读 | F-02、F-03 | 左栏保留真实原网页及原有交互；右栏是独立滚动的结构化只读译文；分隔条可拖动，默认各半，左栏可调范围为 35%–70% |
| 原译对齐 | F-04、F-05 | 段落级双向悬停高亮、直接点击定位和按锚点联动。译文支持 Enter 定位，同步默认开启 |
| 翻译执行 | F-06 | 支持 Google Cloud Translation Basic、有道智云、自定义 AI 和[官方 AI 服务](translation-services.md)。分批翻译、增量展示、失败可重试，多个标签页独立运行 |
| 恢复与边界 | F-07、F-08 | 关闭和失效时清理扩展的页面改动；受限页面和布局冲突给出原因；外发前确认，排除敏感输入 |
| 选词与段落翻译 | F-09、F-10 | 当前标签页中的两个独立开关。「译」打开选词卡片，按段落快捷键逐段插入译文 |
| 原位翻译 | F-11 | 在原网页写入译文，保留原有标签、链接、样式和交互。弹窗可恢复原文 |
| 单页应用 | F-13 | 原页内容变动时更新译文。站内换页后清除旧译文，等待新正文并继续翻译 |

默认模式为双栏对照，自动检测源语言并译为简体中文。默认范围包含可滚动页面中可读的导航、侧栏、正文和页脚。用户可切换为仅正文。

后续 P1 包括原文下方插入译文及句子级对齐。P2 包括词组对齐、扩展 Provider 支持、浏览器内翻译、复杂文档专项适配及个性化规则。PDF 在标签页侧边栏或手选文件的独立扩展页中由随包分发的 PDF.js 解析，网页注入仍受浏览器内部页、iframe 和 Canvas 边界限制。

## 2. 技术基线与代码结构

采用 **Chrome 桌面 Manifest V3、TypeScript、WXT、React**。WXT 管理扩展入口、开发构建和打包。React 用于 Popup、Options 和右栏。提取、映射、滚动和任务编排采用独立 TypeScript 模块。翻译适配器支持 Google Cloud Translation Basic v2、有道智云 NMT 批量翻译和兼容 OpenAI Chat Completions 的 AI 服务。用户在设置页填写各自凭据，并分别授权向服务发送可翻译文本。

```text
alignread-extension/
  wxt.config.ts
  entrypoints/
    background.ts              # MV3 Service Worker
    reader.ts                  # 由 scripting API 在顶层文档按需注入
    selection.ts               # 按需注入选词功能
    paragraph.ts               # 按需注入段落功能
    popup/                     # 当前标签页的状态与操作
    options/                   # 全局配置、站点规则和隐私设置
  src/
    reader/
      session/                 # 双栏与原位会话、任务队列、文字替换与恢复
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
    replacement-check.cjs      # AC-P1-03 及原位翻译回归
    spa-check.cjs              # AC-P1-05 及动态内容、路由与授权回归
    fixtures/                  # 本地测试页面和结构样本
```

| 运行上下文 | 持有的状态与职责 |
| --- | --- |
| Popup / Options | 工具栏弹窗操作当前文档。独立标签页中的设置按翻译服务、双栏阅读、快捷键、站点与缓存分区，阅读与站点偏好按分类保存。两者都通过 Worker 处理请求。弹窗关闭后翻译继续。 |
| Content Script | 每个顶层文档最多拥有一个双栏或原位会话，以及相互独立的选词和段落会话。双栏和选词通过 Shadow DOM 挂载界面，原位翻译直接写入现有文字节点。 |
| Service Worker | 接收扩展操作、执行注入、管理授权和设置、核验来自页面的请求、执行 Provider 批次并统一限流。 |
| Storage | `storage.local` 保存设置、凭据和服务授权记录，`storage.session` 保存标签页与文档的临时任务授权。原文、译文和 DOM 映射留在各自会话内存。 |

Worker 按需注入网页、选词或段落翻译脚本。状态查询没有回复或发送失败时，注入对应脚本。同一文档内可复用已加载的脚本。Chrome 可以回收 Worker，页面队列保留在 Content Script，设置从存储重读，Worker 内的并发槽与请求控制器只服务当前在途批次。

## 3. 网页翻译与段落映射

### 双栏对照

**左栏布局。** Reader 创建固定在右侧的宿主元素，工具栏、分隔条和译文挂载在闭合 Shadow DOM 内。用可撤销的样式表将原页的 `body` 约束为左侧独立滚动容器，保留原有 DOM 树。布局模块识别原页的目录和正文列，对溢出子元素以及固定页边栏、Cookie 提示条等应用受控的尺寸或位置调整。启动时先校验分栏布局，通过后才派发翻译请求。运行中发生短暂布局变动时，尝试恢复分栏。视口低于 960 CSS px 或布局持续无法安全恢复时，退出双栏并提示原因。

**布局恢复。** 初始化失败、主动关闭及会话失效走同一清理入口。对原页被调整的内联属性记录原值、优先级及扩展最后写入值，撤回前检查当前值，以保留站点自身更新。关闭时移除扩展样式和宿主元素，按原来的容器恢复滚动位置，释放观察器、事件监听、高亮和在途任务。

**提取与阅读树。** `extraction/document.ts` 在左栏缩窄前首次提取所选范围。仅正文优先识别 `main`、`article` 和语义区域，必要时回退到文档遍历。提取节点的实际位置、可见性、阅读顺序及可保留的样式属性。没有自身布局盒子的包装层仍会递归提取内部的列表、段落和代码块。跳过隐藏或收起的菜单、表单值、编辑区及扩展 UI。双栏和原位翻译根据代码标记、等宽字体与保留空白的样式识别代码区域，默认保留原文。开启对应模式的注释选项后，根据语法或高亮标记定位注释正文。识别到的公式绕过翻译队列，双栏按 MathML 或可用的公式文字呈现。双栏可以预览只有代码的页面。图片使用占位。长页提取会分片执行。

**译文布局。** 根据实际坐标识别同排卡片、嵌套列组、网格列表和导航，保留列顺序及相对权重。文件列表按行排列，保留网格中的空白列，长文件名可在所在列换行。页头导航和标签按内容宽度紧凑排列，保留原页分组及可识别的间距、边框和圆角。窄栏允许卡片、导航和标签换行，横排页签在自身区域滚动并保留可识别的选中态。新闻条等由简单行内标签和链接组成的内容保留顺序、对齐和基本样式，长文字可在行内换行。阅读树保留提示框外观、行内样式和换行、列表标记、图注及表格语义。表格拥有独立的横向滚动区域，折叠区按原页的当前可见状态更新。React 使用受支持的节点及文本渲染译文，右栏安全链接在新标签页打开。

**身份与定位。** 阅读树描述右栏的结构。每个可定位块分配独立的 `segmentId`，翻译结果使用同一 ID；相同文字在不同位置仍有独立 ID。页面会话另有一张 ID 到 `Node` / `Range`、文本指纹和位置的映射。缓存命中后把译文分发给各自的 ID。定位前验证节点仍连接且内容有效。

**动态更新。** Reader 合并短时间内的正文变化，重新提取所选范围，更新阅读树和定位映射。仍有效的段落保留译文，删除或隐藏的段落从右栏移除。包含已离开视图内容的在途批次会取消，让新内容继续送译。暂停时更新结构，继续后才发新批次。同一文档重建 `body` 或移除分栏元素、样式表时，Reader 尝试使用原双栏会话恢复布局。

**站内导航。** 同一文档内，标签切换和普通锚点变化都会检查可见内容，包括通过 CSS `:target` 切换的面板。只改变查询参数时，取消旧地址的在途批次，重新提取并保留未变段落的译文。地址路径或以 `#/`、`#!/` 开头的哈希路由切换到其他路径时，清除旧译文和缓存，取消旧批次并等待新正文。双栏继续使用开启时选定的语言、范围和服务。识别为敏感的新页面会关闭双栏，重新开启前须确认。

**联动。** 两侧注册各自的滚动上下文，按段落 ID 选取视口锚点，通过动画帧合并更新。程序化滚动使用短期抑制标记，收到对侧真实用户输入时转移主导侧。等待、失败与跳过的块保留布局与定位锚点。原文高亮优先使用 CSS Custom Highlight 和 Range；兼容回退可采用不接收指针事件的描边。原文与译文均可直接点击普通文字定位对侧，译文块可用 Tab 聚焦并按 Enter。链接、重试按钮和拖选文字保留各自操作。

### 原位翻译

开启翻译时先识别当前网页的阅读正文。页面声明阅读模式时，优先选取可见的文章区域。有明确阅读标记的独立弹层使用自身的正文和滚动区域，译文工具栏挂在同一层。关闭或替换弹层会结束该视图的会话。浏览器原生阅读面板由 Chrome 管理。 [阅读视图识别](../alignread-extension/src/reader/layout/site-reading-view.ts) · [Chrome 页面访问权限](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)

原位会话复用可见文字提取、段落身份和翻译队列。按文字节点边界送译，保留原网页的标签、属性、样式和事件。跨标签的句子可能拆开送译。原位模式在窄窗口也可使用，右上角浮条提供模式选择和恢复原文操作，并与双栏工具栏共用进度组件。组件读取当前会话的段落计数，包括已复用的译文。 [文字提取](../alignread-extension/src/reader/extraction/document.ts) · [原位会话](../alignread-extension/src/reader/session/replacement-reader.ts)

扩展在会话内存记录每个已改节点的原文和最后写入的译文。应用译文前检查节点仍在页面上、原文与提取时一致且仍可翻译。动态提取读取已改节点的原文，避免将译文再次送译。等待或失败的段落继续显示原文。 [文字替换记录](../alignread-extension/src/reader/session/replacement-text.ts)

同页切换时，先按照当前服务、配置版本和语言方向校验，再将可复用的已完成译文交给新模式。新模式重新提取原文，按完整待译片段匹配；在途批次和原网页节点不跨会话传递。即使长文超过最近译文的缓存上限，两种模式各自最近显示的已完成片段仍可在往返切换时复用。这些译文只保存在本页内存中，清空或关闭缓存、切换页面及结束阅读时释放。

关闭、切换模式或站内换页时先处理网站的文字更新，再恢复扩展仍控制的节点。切换路径或哈希路由会取消旧批次并清空缓存，新页面可继续翻译。识别为敏感的新页面会结束会话，需要重新确认。

## 4. 会话与消息协议

| 协议 | 方向 | 关键约束 |
| --- | --- | --- |
| `page`、`start`、`control` | Popup → Worker | Worker 校验模式、标签页、服务配置和页面授权。注入 Reader 后把操作绑定到浏览器返回的 `documentId`。 |
| `reader:start`、`reader:state`、`reader:pause`、`reader:resume`、`reader:retry`、`reader:stop` | Worker → Reader | 当前文档的 Reader 按模式启动并回报当前模式及进度。重试命令用于原位翻译。 |
| `switch-mode` | Reader → Worker | 页内切换要求当前会话、标签页、文档、页面地址及服务授权仍然有效。保留语言、翻译范围和服务。 |
| `reader:switch-mode` | Worker → Reader | 当前文档验证旧会话 ID 后切换模式，成功时启用新的会话 ID 并停止旧批次。 |
| `batch`、`cancel` | Reader → Worker | Worker 核验发送者的标签页、文档及会话，检查批次内容、配置、翻译授权和当前页面路由。取消时只停止对应的批次。 |
| 批次响应 | Worker → Reader | Worker 返回批次 ID 和翻译项 ID。Reader 只把结果归入当前页面仍有效的阅读块，处理超时、结果缺失或取消。 |
| `closed`、`resize` | Reader → Worker | 当前文档关闭会话或保存栏宽偏好。关闭后 Worker 取消对应在途任务并移除临时授权。 |
| `reader:clear-cache` | Worker → Reader | 在设置页清空或关闭缓存时，通知活跃 Reader。 |
| `selection-start`、`selection-stop`、`paragraph-start`、`paragraph-stop` | Popup → Worker | 校验服务和当前文档，分别管理选词和段落会话。 |
| `selection:*`、`paragraph:*` 控制消息 | Worker → 对应内容脚本 | 按功能启动、查询或停止。快捷键更改仅发给段落脚本。 |
| `selection:translate`、`paragraph:translate` 及对应的取消和关闭消息 | 选词或段落脚本 → Worker | 验证会话、文档、页面地址和请求编号，复用 Provider 调度执行单项请求。 |

选词和段落会话允许在相同路径和查询参数下跳转到当前文档中存在的章节锚点。地址带有新的章节标记时，后台在送译前向原文档核实会话。路径、查询参数、哈希路由或无法定位的片段发生变化时，会话结束。

每次开启或成功切换模式都会生成独立会话 ID。Worker 维护标签页、文档及开启地址的授权，Reader 维护翻译项和文字映射。Worker 在请求前后比对批次路由与浏览器提供的当前地址。刷新、跨文档导航、`pagehide` 或关闭会令旧会话失效。切换翻译服务后需重新开启。切换标签页只改变 Popup 的操作目标，各文档的翻译独立进行。

Reader 状态为 `preparing`、`translating`、`paused`、`partial`、`ready`、`error`。无活动会话时显示原文。暂停停止派发后续批次，在途批次可完成。关闭立即阻止迟到结果应用，Worker 中断或请求失败的批次可重试。

选词脚本读取选区显示的文字，过滤不可见或受限选区。点击「译」最多发送 1000 字符，卡片随选区变化清理。按段落快捷键时，脚本按块或显式换行识别选区触及的各段，发送每一段完整可见正文。快捷键保存在本机，Worker 将更改发给已开启的段落会话。段落请求独立排队，长段分片后合并回同一位置。响应按原段校验，原文更新或移除时清理，切换选区可继续阅读已有段落译文。

## 5. Provider、缓存与权限

- **调度。** 页面会话维护段落优先级、去重和批次进度。Worker 校验批次大小与来源并限制并发。服务适配器负责网络超时，Google 适配器对 429 执行限次退避，有道和 AI 适配器返回限流状态。鉴权失败、配额不足和不支持的语言对返回独立错误。部分失败时保留成功译文，并允许重试失败项。
- **契约。** `translateSegments(request, credentials, signal)` 接受带批次 ID、阅读选项及译文项 ID 的请求，以及服务凭据和取消信号。Provider 适配器校验并规范化返回值，遗漏、重复和未知 ID 不得错误回填。服务只支持按输入顺序返回时，以明确的服务契约为依据并核验返回数量与类型，异常批次不得盲配。外部请求从 Worker 发起，业务正文只发可翻译文本和必要语言参数，段落 ID 留在本地，服务协议确需关联标识时使用不含页面身份的临时标识。
- **AI 请求。** 服务目录定义显示名称、默认模型和允许使用的接口地址。请求策略复用 Chat Completions 的请求和响应处理，可为指定模型调整推理或 JSON 参数、为流式服务接入专用解析器。 [服务目录](../alignread-extension/src/shared/ai-settings.ts) · [请求策略](../alignread-extension/src/background/translation/ai-strategies.ts)
- **AI 响应。** DeepSeek 使用 JSON 输出模式。MiniMax、GLM 和 Kimi 使用流式响应。后台跳过推理内容，拼接译文片段后再校验。流式请求等待首次响应或连续无数据的时限为 27 秒，单次请求最多 90 秒。Worker 用批次内临时序号匹配译文，要求每个序号恰好出现一次且译文非空。修改当前服务的端点、模型或密钥后，重新开启需要的翻译功能。 [AI 适配器](../alignread-extension/src/background/translation/ai.ts) · [DeepSeek JSON 输出](https://api-docs.deepseek.com/guides/json_mode/) · [MiniMax 流式响应](https://platform.minimax.io/docs/api-reference/text-openai-api#streaming-response)
- **缓存。** Reader 在当前路径或哈希路由内按规范化待译文本复用结果，语言方向、Provider 和配置版本由会话绑定。最近译文缓存最多 750 项或约 256 KB，敏感页面跳过缓存。设置页可关闭、查看估算占用和清空。换到其他路径或哈希路由时清空缓存，旧批次无法写回。
- **页面权限。** 使用 `activeTab`、`scripting` 和 `storage` 管理网页翻译，`sidePanel` 用于在 PDF 旁显示译文。`file:///*` 受 Chrome 的文件网址开关控制，仅在用户打开对应 PDF 时读取该文件。站点禁用先于注入检查，受限页面显示不可用原因。
- **外发权限。** Worker 每批次检查当前服务的授权和配置。Google、有道和官方 AI 预设使用固定 HTTPS 接口，MiniMax 的接口随所选站点变化，自定义 AI 使用用户填写的地址。保存并同意外发时仅申请对应主机的可选权限，与网页的临时访问权限独立。页面消息无法指定服务地址，请求不跟随重定向。页面 URL、Cookies、表单内容及 DOM 不进入外发请求。密钥保存在受信任的扩展存储中，设置摘要返回配置状态、公开字段及脱敏信息。 [Chrome 可选权限](https://developer.chrome.com/docs/extensions/reference/api/permissions)

## 6. 实施与验收

| 阶段 | 实施内容 | 验证方式 |
| --- | --- | --- |
| M0 工程与布局原型 | 起 WXT 工程，打通 Popup、Options、Worker、Reader，验证空面板挂载与卸载 | 用本地 HTTP fixture 检查 Manifest、真实网页交互、固定或粘性元素、窄窗口、重复启停与恢复（AC-06、AC-09、AC-14、AC-16 的基础场景） |
| M1 提取与对齐 | 范围过滤、拖拽、结构化阅读树、段落 ID 和双向滚动 | 用预置译文验证结构、重复段落、原站点击与双向定位（AC-01 至 AC-07） |
| M2 真实翻译 | Provider 接入、外发确认、调度、缓存、错误反馈和多标签隔离 | 验证部分失败、关闭/导航、多标签、授权与敏感输入（AC-08 至 AC-15）；模拟 Worker 中断并核对批次状态 |
| M3 稳定与发布 | 实测普通博客、技术文档及 README，验证长页性能和分发权限 | 通过 AC-01 至 AC-16；记录 100、500、1000 段表现和点击到初次反馈的时间，确认最低 Chrome 版本及站点适配范围 |

选词卡片和段落双语分别按 AC-P1-01、AC-P1-02 验收，原位翻译按 AC-P1-03 验收，SPA 动态更新按 AC-P1-05 验收。GitHub Actions 执行 Chromium、Worker 和 ZIP 全量回归。最低支持版本在 Manifest 中声明为 Chrome 116。 [回归与验收](test-plan.md)

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
