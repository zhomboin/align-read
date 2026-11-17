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
3. 按 [配置与使用说明](../README.md#配置翻译和开始使用) 在扩展设置中配置开发用翻译服务并测试连接。凭据保存在本机扩展设置中。修改代码后，从扩展目录重新运行 `npm run build`，在 `chrome://extensions` 点击「重新加载」，再刷新测试网页。

## 手动验证

在扩展目录执行下方命令，把 `<本地测试端口>` 替换为本机可用端口。

```bash
python3 -m http.server '<本地测试端口>' --bind 127.0.0.1 --directory tests/fixtures
```

在 Chrome 打开 `http://localhost:<本地测试端口>/` 和同目录下的 `layout-structures.html`，检查以下行为。

- 两处重复原文分别定位正确，链接、锚点、折叠区和文本选择可用，关闭双栏后原页恢复。
- 网格列表、提示框、折叠摘要、图注和宽表格在默认及较窄译文栏中可用。
- 两个标签页可独立启停，关闭或刷新页面会清理译文。检查窄窗口、禁用站点、缺少授权、服务鉴权及失败重试。
- 开启选词翻译，分别在普通网页和双栏原文选择文字。点击「译」，检查原文、译文、复制、重试、Esc 关闭和选区保留。选取编辑区或隐藏内容时，检查界面与翻译请求。

验证结束后在启动测试服务的终端按 `Ctrl+C`。自动化回归命令见 [发布验收](test-plan.md#运行)，打包和远程分发步骤见 [Chrome 网上应用店上架](chrome-web-store.md)。

## 提交与回归

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

推送开发分支并向 `main` 发起 PR。检查 PR 的 **AlignRead regression** 结果，完成代码检视后再合入。全量回归和 ZIP 完整性检查由 GitHub Actions 执行。
