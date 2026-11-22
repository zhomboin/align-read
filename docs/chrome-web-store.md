# Chrome 网上应用店更新与发布

AlignRead 已通过审核并上线。发布新版本时，在现有条目提交更新。 [商店详情](https://chromewebstore.google.com/detail/alignread/eknjmgokcpffbikmkcnahgmbgcmdjihf?hl=zh-CN) · [当前发布进度](progress.md#商店发布状态)

## 商店详情

商品名称使用 Manifest 中的 **AlignRead**，语言选简体中文，类别建议选「工具」。商店图标使用 [128×128 PNG](../alignread-extension/public/icons/128.png)。 [商店详情要求](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)

宣传素材可分别上传到「小型宣传图块」和「顶部宣传图块」。 [440×280 小型宣传图 PNG](store/promo-small.png) · [1400×560 顶部宣传图 JPEG](store/promo-marquee.jpg)

商品详情的「屏幕截图」按下列顺序上传。五张均为 1280×800 的 24 位 PNG，使用扩展生产构建的界面。论文截图由扩展解析原 PDF，并通过翻译流程载入校订后的示例译文。 [商店图片要求](https://developer.chrome.com/docs/webstore/images)

1. [矩阵与公式编号](store/pdf-matrix.png) 展示第 5 页的函数矩阵（2.6）及同页公式编号。
2. [长公式与多重求和](store/pdf-long-equations.png) 展示第 6 页的长求和式（2.8）和复合函数（2.9）。
3. [行内公式与图注](store/pdf-inline-math.png) 展示第 21 页的变量、上下标和行内表达式随正文排版。
4. [表格与表注](store/pdf-tables.png) 展示第 16 页的两张表格及居中表注。
5. [选择翻译服务](store/translation-settings.png) 展示翻译服务设置。

**简短描述**

> 论文 PDF 与网页对照翻译，保留公式、图表和阅读结构。

**详细描述**

> AlignRead（对阅）让你并排阅读论文 PDF 和网页的原文与译文。在 Chrome 已打开的 PDF 旁启动对照阅读，也可以选择本地文件在独立阅读器中打开。
>
> PDF 阅读器按原文栏序组织正文，保留标题层级、页码位置以及可识别的图表。图注和表注可翻译。独立公式按原页整体显示，保留矩阵、分式、求和符号的上下限、上下标和公式编号。行内公式随段落显示，周围文字继续翻译，便于对照符号和推导。
>
> 在新标签页可原位阅读和下载整份译文 PDF。滚动可连续跨页，也可以输入页码跳转。开始翻译后优先处理当前页，再预译后两页。在线文件优先分段读取，分段失败会自动重试，仍无法分段时尝试完整读取。支持 100 MiB 以内带文字层的 PDF，扫描件需先做 OCR。
>
> 双栏可联动滚动、调整宽度并点击译文定位原文。选择原位翻译可在原网页直接阅读译文，保留链接、样式和页面控件，随时恢复原文。两种模式可翻译整页可见文字或仅翻译正文，并随网站内容更新。开启选词翻译可查看并复制选中短语的译文。单独开启段落翻译，选中多段后按段落快捷键（默认 Ctrl），在每段原话下方阅读对应译文。
>
> 使用翻译功能前需配置自己的服务凭据。支持有道智云、Google Cloud Translation、OpenAI、Gemini、Grok、GLM、Kimi、豆包、腾讯混元、DeepSeek、MiniMax 和自定义 AI。PDF 文件与页面图像在本机处理，待译文字在用户开启翻译后发送给已授权的服务。服务额度与费用由服务方管理。
>
> 截图与宣传图中的论文选自《KAN: Kolmogorov-Arnold Networks》，作者为 Ziming Liu、Yixuan Wang、Sachin Vaidya、Fabian Ruehle、James Halverson、Marin Soljačić、Thomas Y. Hou 和 Max Tegmark。原文为 arXiv:2404.19756v1，采用 CC BY 4.0。展示包含原页节选及校订的简体中文示例译文。
>
> [论文原文](https://arxiv.org/abs/2404.19756v1) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

## 隐私申报

**单一用途**

> 应用户请求翻译网页或 PDF 中的文字，在对照阅读栏、原网页或选词卡片中显示译文。

**权限用途**

| 权限 | 可填写的用途 |
| --- | --- |
| `activeTab` | 用户主动点击扩展时，临时访问当前标签页以执行所选的翻译。 |
| `sidePanel` | 在用户打开的原生 PDF 旁显示该标签页的译文。 |
| `file:///*` | 用户允许访问文件网址并在本地 PDF 上启动阅读后，读取该文件的待译页。 |
| `scripting` | 用户开启翻译功能时，按需运行翻译脚本，读取待译的可见文字并显示译文。 |
| `storage` | 在本机保存翻译服务凭据、授权、设置与连接测试结果，并用会话存储维护当前标签页和文档的临时翻译授权。 |
| `translation.googleapis.com` | 用户配置并授权 Google Cloud 后，用 HTTPS 调用 Cloud Translation Basic 来翻译文字和测试连接。 |
| `openapi.youdao.com` | 用户配置并授权有道智云后，用 HTTPS 调用批量文本翻译接口来翻译文字和测试连接。 |
| `https://*/*`（可选） | 扩展在用户保存并授权时仅申请所选 AI 接口的 HTTPS 主机，用于翻译和连接测试。AI 预设使用官方接口，自定义 AI 服务由用户填写地址。 |

**远程代码**填「否」。扩展代码随 ZIP 分发，翻译接口返回文本数据。

**数据类型与用途**按实际行为申报「网站内容」和「身份验证信息」。网站内容包括用户主动翻译的当前页、预译页或下载整份 PDF 时待补译的正文、选词卡片发送的选中文字、使用段落快捷键时选区涉及的各段完整可见正文，以及双栏或原位翻译开启期间所选范围内的可见文本和后续更新。身份验证信息是用户填写的服务凭据，用于本机配置与已授权的服务请求。Google 和 AI 的 API 密钥仅用于各自的服务请求。有道应用密钥保存在本机，用于签名。查看完整处理方式后，由发布者勾选数据使用承诺。 [隐私申报说明](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)

**隐私政策网址**填写部署并验证后的 [公开隐私政策页面](https://align-read.zhomboin.com/privacy-policy.html)。申报、商店描述和审核测试说明应与送审包一致。 [隐私政策正文](privacy-policy.md)

## 发布隐私政策页面

1. 在域名管理中将 `align-read.zhomboin.com` 解析到公网服务器。在 Nginx 的 HTTPS 站点中为该域名设置静态文件根目录，证书需覆盖该域名。 [Nginx HTTPS 配置](https://nginx.org/en/docs/http/configuring_https_servers.html)
2. 在 WSL 的项目根目录运行下方命令，把 SSH 用户、主机和站点根目录换成部署环境的值。远程用户需对站点目录有写入权限。如果调整了 Nginx 配置，在服务器上执行 `sudo nginx -t`，检查通过后执行 `sudo systemctl reload nginx`。

   ```bash
   scp docs/store/privacy-policy.html '<SSH 用户>@<SSH 主机>:<站点根目录>/privacy-policy.html'
   ```
3. 在 Chrome 无痕窗口打开最终网址，确认无需登录即可看到「AlignRead 隐私政策」完整正文，且功能范围与送审包一致。在 WSL 中运行下列命令，核对响应为 `200`、内容类型为 `text/html`。

   ```bash
   curl --fail --silent --show-error --location --max-time 20 --output /dev/null \
     --write-out '%{http_code} %{content_type}\n%{url_effective}\n' \
     'https://align-read.zhomboin.com/privacy-policy.html'
   ```

4. 在原商品的 **Privacy → Privacy policy URL** 填写并保存这个 HTTPS 网址。随后上传与政策正文匹配的 ZIP 和截图。 [Google 隐私申报说明](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) · [拒审排查](https://developer.chrome.com/docs/webstore/troubleshooting)

## 审核测试说明

> 点击 AlignRead 弹窗的「设置」打开完整设置页。在「配置服务」下拉框选择有道智云，填写测试应用 ID 和应用密钥。同意发送待译文本，点击「保存有道设置」，允许访问翻译服务域名，然后点击「测试连接」。点击「设为当前服务」启用有道智云。用桌面 Chrome 打开一篇公开英文文章，确保浏览器内容区域宽度至少为 960 CSS px。点击 AlignRead 图标，选择简体中文并点击「开启双栏」。确认右栏显示译文，点击译文段落可定位左栏原文，关闭双栏后原页恢复。
>
> 在同一页面的弹窗中选择「原位翻译」并点击「开启原位翻译」。确认原网页直接显示译文，原有链接仍可使用。点击「恢复原文」，确认网页重新显示英文。
>
> 在同一页面通过扩展弹窗开启「选词翻译」，选中英文短语并点击旁边的「译」。确认卡片显示对应原文和译文，复制后按 Esc 关闭。关闭选词翻译，开启段落翻译，跨三段选中文字并按段落快捷键（默认 Ctrl），逐段核对原话下方的译文。关闭段落翻译后，本页段落译文应全部清除。
>
> 在 Chrome 中打开 KAN 论文的 PDF，点击扩展弹窗的「在此页对照翻译」。在侧栏输入页码 5，点击「翻译并预译后两页」。对照原文核查矩阵（2.6）和公式编号，再滚动到第 6 页查看长求和式（2.8）和后续公式。核查页码更新，确认可以使用「选择 PDF」打开手选文件。

提供凭据时，把专用测试凭据填入开发者后台的审核测试说明。 [审核测试说明](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions)

## 上传与送审

1. 在 WSL 中完成 [发布验收](test-plan.md#运行)。在扩展目录运行下列命令，核对 ZIP 内的 `manifest.json` 和版本，并记录 SHA-256。

   ```bash
   npm run zip
   version="$(node -p 'require("./package.json").version')"
   zip=".output/alignread-extension-${version}-chrome.zip"
   unzip -t "$zip"
   sha256sum "$zip"
   ```
2. 登录 Chrome 网上应用店开发者后台，打开 **AlignRead → Package → Upload New Package**，上传验收过的 ZIP。包版本号须高于商店已发布版本。 [开发者后台](https://chrome.google.com/webstore/devconsole) · [更新条目](https://developer.chrome.com/docs/webstore/update)
3. 填写 **Store listing** 和 **Privacy**，在 **Distribution** 选择地区和可见性。如需提供给审核员的测试步骤和凭据，填写 **Test instructions**。
4. 点击 **Submit for Review**。希望审核通过后自己决定上线时间，可以取消勾选自动发布。 [送审与延迟发布](https://developer.chrome.com/docs/webstore/publish#submit-your-item)
5. 如选择手动发布，审核通过后在后台发布。打开公开条目，核对版本和上次更新日期，再同步项目首页、项目进度和版本记录。 [项目首页](../README.md) · [项目进度](progress.md) · [版本记录](version.md)
