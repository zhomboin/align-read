# Chrome 网上应用店上架材料

## 商店详情

商品名称使用 Manifest 中的 **AlignRead**，语言选简体中文，类别建议选「工具」。商店图标使用 [128×128 PNG](../alignread-extension/public/icons/128.png)。 [商店详情要求](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)

宣传素材可分别上传到「小型宣传图块」和「顶部宣传图块」。 [440×280 小型宣传图 PNG](store/promo-small.png) · [1400×560 顶部宣传图 JPEG](store/promo-marquee.jpg)

商品详情的「屏幕截图」可以按下列顺序上传。四张均为 1280×800 的 24 位 PNG，取自实际安装的生产扩展，使用本地演示文章和预设译文。发布验收步骤见 [测试与验收](test-plan.md)。

1. [双栏对照阅读](store/dual-pane.png)
2. [点击译文定位并高亮原文](store/paragraph-highlight.png)
3. [技术文档的代码块和表格](store/technical-document.png)
4. [调整栏宽后的阅读布局](store/adjustable-layout.png)

**详细描述**

> AlignRead（对阅）让你在同一标签页里对照阅读网页原文和译文。左栏保留原网页及其链接、按钮等操作，右栏按标题、段落、列表和表格展示译文。
>
> 可翻译当前网页的可见文字，也可只翻译正文。点击译文段落可定位并高亮原文。两栏可联动滚动，也可以拖动分隔线调整宽度。通过选词翻译可快速查看选中短语的译文并复制。
>
> 使用前需配置自己的有道智云批量文本翻译或 Google Cloud Translation Basic 凭据。开启双栏或点击选区旁的「译」后，待译文字会通过 HTTPS 发送给已授权的服务。翻译服务的额度与费用由该服务提供商管理。

## 隐私申报

**单一用途**

> 应用户请求翻译当前标签页的可见文字，并在双栏或选词卡片中显示译文。

**权限用途**

| 权限 | 可填写的用途 |
| --- | --- |
| `activeTab` | 用户主动点击扩展时，临时访问当前标签页以管理双栏或选词翻译。 |
| `scripting` | 用户开启翻译功能时，向当前网页注入对应界面，读取待译的可见文字。 |
| `storage` | 在本机保存翻译服务凭据、授权、设置与连接测试结果，并用会话存储维护当前标签页和文档的临时翻译授权。 |
| `translation.googleapis.com` | 用户配置并授权 Google Cloud 后，用 HTTPS 调用 Cloud Translation Basic 来翻译文字和测试连接。 |
| `openapi.youdao.com` | 用户配置并授权有道智云后，用 HTTPS 调用批量文本翻译接口来翻译文字和测试连接。 |

**远程代码**填「否」。扩展代码随 ZIP 分发，翻译接口返回文本数据。

**数据类型与用途**按实际行为申报「网站内容」和「身份验证信息」。网站内容是用户主动送译的可见文本。身份验证信息是用户填写的服务凭据，用于本机配置与已授权的服务请求。Google API 密钥用于 Google 请求。有道应用密钥保存在本机，用于签名。查看完整处理方式后，由发布者勾选数据使用承诺。 [隐私申报说明](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)

**隐私政策网址**填写 [隐私政策](privacy-policy.md) 发布后的公开 HTTPS 地址。发布后用未登录窗口打开该地址，确认页面正文可以访问。

## 审核测试说明

> 打开 AlignRead 设置，选择有道智云，填写测试应用 ID 和应用密钥。同意发送待译文本，点击「保存有道设置」，允许访问翻译服务域名，然后点击「测试连接」。用桌面 Chrome 打开一篇公开英文文章，确保浏览器内容区域宽度至少为 960 CSS px。点击 AlignRead 图标，选择简体中文并点击「开启双栏」。确认右栏显示译文，点击译文段落可定位左栏原文，关闭双栏后原页恢复。
>
> 在同一页面通过扩展弹窗开启「选词翻译」，选中英文短语并点击旁边的「译」。确认卡片显示对应原文和译文，复制后按 Esc 关闭，再通过扩展弹窗关闭选词翻译。

提供凭据时，把专用测试凭据填入开发者后台的审核测试说明。 [审核测试说明](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions)

## 上传与送审

1. 在 WSL 中完成 [发布验收](test-plan.md#运行)。在扩展目录运行下列命令，核对 ZIP 内的 `manifest.json` 和版本，并记录 SHA-256。

   ```bash
   npm run zip
   unzip -t .output/alignread-extension-0.1.4-chrome.zip
   sha256sum .output/alignread-extension-0.1.4-chrome.zip
   ```
2. 登录 Chrome 网上应用店开发者后台，确认开发者账户和两步验证已设置。首次发布点击 **Add new item → Choose file → Upload**。已有商店条目时进入原条目的 **Package → Upload New Package**，版本号须高于已发布版本。 [开发者后台](https://chrome.google.com/webstore/devconsole) · [首次上传](https://developer.chrome.com/docs/webstore/publish) · [更新条目](https://developer.chrome.com/docs/webstore/update)
3. 填写 **Store listing** 和 **Privacy**，在 **Distribution** 选择地区和可见性。如需提供给审核员的测试步骤和凭据，填写 **Test instructions**。
4. 点击 **Submit for Review**。希望审核通过后自己决定上线时间，可以取消勾选自动发布。 [送审与延迟发布](https://developer.chrome.com/docs/webstore/publish#submit-your-item)
