# 本地开发

1. 在 WSL Ubuntu 中打开项目根目录。按 [Node.js 版本文件](../alignread-extension/.nvmrc) 切换 Node.js，安装依赖并构建。

   ```bash
   cd alignread-extension
   nvm install
   nvm use
   npm ci
   npm run check
   npm run build
   ```

2. 在桌面 Chrome 116 或更新版本中打开 `chrome://extensions`，启用开发者模式，选择「加载已解压的扩展程序」，选择扩展目录下的 `.output/chrome-mv3`。使用 Windows Chrome 时，在文件选择器中通过 `\\wsl.localhost` 浏览到 Ubuntu 中的构建目录。
3. 按 [配置与使用说明](../README.md#配置翻译和开始使用) 在扩展设置中配置开发用翻译服务并测试连接。凭据保存在本机扩展设置中。修改代码后，从当前开发工作树的扩展目录重新运行 `npm run build`。在 `chrome://extensions` 核对加载目录，点击「重新加载」。刷新每个已打开的测试网页，再重新开启待验证的翻译模式。

## AI 翻译验证

1. 要验证扩展与后台的集成，在 WSL 的扩展目录执行下面的命令。测试模拟 AI 接口响应，覆盖域名授权、连接测试、双栏、选词和异常响应，无需准备密钥。

   ```bash
   npm run check
   npm run build
   npm run test:settings
   ```

2. 要验证真实服务，在「设置 → 翻译服务」打开对应面板，根据[翻译服务配置](translation-services.md)填写该平台的测试密钥和可用模型。勾选外发授权，保存并授予对应域名的访问权限，然后点击「测试连接」。
3. 将当前服务切换为已配置的服务，打开公开测试网页。分别开启双栏、原位和选词翻译，检查译文语言、段落定位、恢复原文和选词结果。清除对应配置后，确认扩展提示重新设置。

验证 MiniMax 国际站时使用该站点的密钥。若请求超时，记录所选模型、等待时长和设置页错误提示。

## 手动验证

在扩展目录执行下方命令，把 `<本地测试端口>` 替换为本机可用端口。

```bash
python3 -m http.server '<本地测试端口>' --bind 127.0.0.1 --directory tests/fixtures
```

在 Chrome 打开 `http://localhost:<本地测试端口>/` 和同目录下的 `layout-structures.html`，检查以下行为。

- 两处重复原文分别定位正确，链接、锚点、折叠区和文本选择可用，关闭双栏后原页恢复。
- 网格列表、提示框、折叠摘要、图注和宽表格在默认及较窄译文栏中可用。
- 新闻条的标签、分隔符和链接同排显示。缩窄译文栏时，长链接在自己的位置换行。
- 两个标签页可独立启停，关闭或刷新页面会清理译文。检查窄窗口、禁用站点、缺少授权、服务鉴权及失败重试。
- 在同目录的 `replacement.html` 开启原位翻译，检查链接和样式、被保护的文字、窄窗口使用及「恢复原文」。
- 开启选词翻译，分别在普通网页、双栏原文及原位翻译后的网页选择文字。点击「译」，检查卡片是否使用选中的可见文字。再验证复制、重试、Esc 关闭和选区保留。选取编辑区或隐藏内容时，检查界面与翻译请求。

保持选词翻译关闭，开启段落翻译，选中三个相邻段落的部分文字，单按 Ctrl，逐段核对完整译文及插入位置。再次单按 Ctrl 收起，再用 Ctrl+C 检查复制行为。从弹窗底部打开「段落快捷键」，录入 F8，回到原标签页核对 F8 生效、旧键停用。

在 PostgreSQL 文档中开启段落翻译，点击目录的「4.1.1. Identifiers and Key Words」。用鼠标选中正文里的 SELECT，单按并松开 Ctrl，核对该段下方的加载提示和完整译文。 [PostgreSQL 测试页](https://www.postgresql.org/docs/17/sql-syntax-lexical.html)

验证结束后在启动测试服务的终端按 `Ctrl+C`。自动化回归命令见 [发布验收](test-plan.md#运行)，打包和远程分发步骤见 [Chrome 网上应用店上架](chrome-web-store.md)。

在开发环境验证 SPA 时，按 [SPA 验收](test-plan.md#spa-验收) 检查页面内更新、站内换页及原页恢复。

## 提交与回归

验证 PDF 原位阅读和下载时，在 WSL 扩展目录执行下列命令。测试使用合成 PDF 和模拟翻译服务，检查预译页数、全文翻译和下载。修改 PDF 默认范围时也运行 `npm run test:settings`，核对保存和恢复默认值。

```bash
npm run check
npm run build
npm run test:pdf
```

从最新的 `main` 创建开发分支。修改设置界面时，在扩展目录执行下面的定向检查。若浏览器不在 PATH，按 [测试计划](test-plan.md#运行) 设置 `CHROMIUM_BIN`。

```bash
npm run check
npm run build
npm run test:settings
```

修改选词翻译时，在扩展目录检查类型、构建并运行选词定向测试。

```bash
npm run check
npm run build
npm run test:selection
```

修改网页双栏或 PDF 阅读时，在扩展目录检查类型并构建。网页双栏使用 `npm run test:layout`，PDF 使用 `npm run test:pdf`。

```bash
npm run check
npm run build
```

按改动范围执行上述定向测试。PDF 浏览器手动验收步骤见 [论文与 PDF 验收](test-plan.md#论文与-pdf-验收)。

修改原位翻译、整页段落双语或双栏句子定位时，执行以下定向检查。使用窄窗验证段下译文，再切换到宽窗双栏，选中译句检查原文高亮及重复句回退。

```bash
npm run check
npm run build
npm run test:replace
```

修改 SPA 路由、动态提取或后台页面授权时，在扩展目录检查类型、构建并运行 SPA 定向测试。

```bash
npm run check
npm run build
npm run test:spa
```

推送开发分支并向 `main` 发起 PR。检查 PR 的 **AlignRead regression** 结果，完成代码检视后再合入。全量回归和 ZIP 完整性检查由 GitHub Actions 执行。
