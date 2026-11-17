# 项目进度

设置页在独立标签页打开，按翻译服务、双栏阅读、站点与缓存分区，通过下拉框选择要配置的服务。设置页和工具栏弹窗采用白底，弹窗支持切换已配置的服务。 [设置说明](../README.md#配置翻译和开始使用) · [定向检查](test-plan.md#运行)

双栏和选词支持 DeepSeek、MiniMax 和自定义 HTTPS Chat Completions 服务。用户已通过真实接口验证 DeepSeek 的双栏和选词翻译，并确认 MiniMax 国际站真实接口复测通过。 [配置与验证](development.md#ai-翻译验证)

- 0.1.6 送审 ZIP 已核验，类型检查、设置与 AI 翻译、选词翻译定向回归均通过。发布者已提交 Chrome 网上应用店审核，等待审核结果。公网隐私政策通过 HTTPS 匿名访问检查，返回正文与仓库 HTML 文件一致。 [公开隐私政策](https://align-read.zhomboin.com/privacy-policy.html)
- 五张商店截图与 0.1.6 匹配，包含双栏、段落高亮、技术文档、选词翻译和服务设置。 [上传顺序](chrome-web-store.md#商店详情)
- [测试与验收](test-plan.md)列出选词翻译和双栏回归。 [上架材料](chrome-web-store.md)提供打包与更新步骤。
- 后续产品功能为 SPA 动态内容兼容。 [产品需求](AlignRead_PRD_v1.1.md#14-里程碑与当前进度) · [版本记录](version.md)
