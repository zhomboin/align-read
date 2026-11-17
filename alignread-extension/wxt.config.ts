import { defineConfig } from 'wxt';
import { AI_HOST_PERMISSION } from './src/shared/ai-settings';
import { TRANSLATION_PROVIDERS } from './src/shared/reader-messages';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'AlignRead',
    description: '双栏网页翻译与原译对照阅读',
    icons: {
      16: 'icons/16.png',
      32: 'icons/32.png',
      48: 'icons/48.png',
      128: 'icons/128.png',
    },
    permissions: ['activeTab', 'scripting', 'storage'],
    optional_host_permissions: [TRANSLATION_PROVIDERS.google.origin, TRANSLATION_PROVIDERS.youdao.origin, AI_HOST_PERMISSION],
    minimum_chrome_version: '116',
  },
});
