# 项目进度

设置页在独立标签页打开，按翻译服务、双栏阅读、站点与缓存分区，通过下拉框选择要配置的服务。设置页和工具栏弹窗采用白底，弹窗支持切换已配置的服务。 [设置说明](../README.md#配置翻译和开始使用) · [定向检查](test-plan.md#运行)

双栏和选词支持 [ChatGPT（OpenAI）、Gemini、Grok、GLM、Kimi、豆包、腾讯混元、DeepSeek、MiniMax 和自定义 AI](translation-services.md)。新增预设使用模拟接口验证；真实接口验收按[本地开发步骤](development.md#ai-翻译验证)执行。

双栏译文支持新闻条横排和窄栏内长链接换行。 [译文样式验收](test-plan.md#译文样式覆盖)

双栏支持单页应用（SPA）的内容增量更新和站内导航。同页标签和查询参数变化时，右栏更新内容与布局，保留未变译文。切换到其他路径或哈希路由后，右栏等待并翻译新正文。 [SPA 验收](test-plan.md#spa-验收)

- 商店分发前按[上架指南](chrome-web-store.md)部署对应的隐私政策并核对截图和 ZIP。
- [测试与验收](test-plan.md)列出选词翻译和双栏回归。 [上架材料](chrome-web-store.md)提供打包与更新步骤。
- 段落双语、替换式整页翻译和句子级对齐列入后续迭代。 [产品需求](AlignRead_PRD_v1.1.md#14-里程碑与当前进度) · [版本记录](version.md)
