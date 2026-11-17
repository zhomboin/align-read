# 项目进度

设置页在独立标签页打开，按翻译服务、双栏阅读、站点与缓存分区，通过下拉框选择要配置的服务。设置页和工具栏弹窗采用白底，弹窗支持切换已配置的服务。 [设置说明](../README.md#配置翻译和开始使用) · [定向检查](test-plan.md#运行)

双栏和选词支持 DeepSeek、MiniMax 和自定义 HTTPS Chat Completions 服务。用户已通过真实接口验证 DeepSeek 的双栏和选词翻译，并确认 MiniMax 国际站真实接口复测通过。 [配置与验证](development.md#ai-翻译验证)

- 商店当前审核的是 0.1.3，发布者于 2026-11-17 确认已送审。 [送审源码基线](https://github.com/zhomboin/align-read/tree/377970ffb8fb74f42549121edfb3fd29b1c4cd52)
- [测试与验收](test-plan.md)列出选词翻译和双栏回归。 [上架材料](chrome-web-store.md)提供打包与更新步骤。
- 后续产品功能为 SPA 动态内容兼容。 [产品需求](AlignRead_PRD_v1.1.md#14-里程碑与当前进度) · [版本记录](version.md)
