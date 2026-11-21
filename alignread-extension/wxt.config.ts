import { defineConfig } from 'wxt';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { AI_HOST_PERMISSION } from './src/shared/ai-settings';
import { TRANSLATION_PROVIDERS } from './src/shared/reader-messages';

export default defineConfig({
  hooks: {
    async 'build:publicAssets'(_wxt, files) {
      const resolve = createRequire(import.meta.url).resolve;
      const root = dirname(resolve('pdfjs-dist/package.json'));
      files.push({ absoluteSrc: resolve('prismjs/LICENSE'), relativeDest: 'licenses/prismjs.txt' });
      const copy = (source: string, dest = source) => files.push({ absoluteSrc: join(root, source), relativeDest: 'pdfjs/' + dest });
      copy('legacy/build/pdf.worker.min.mjs', 'pdf.worker.mjs');
      copy('LICENSE');
      for (const directory of ['cmaps', 'standard_fonts', 'iccs', 'wasm']) {
        for (const file of await readdir(join(root, directory))) {
          if (!file.includes('quickjs') && !file.includes('QUICKJS')) copy(directory + '/' + file);
        }
      }
    },
  },
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'AlignRead',
    description: '论文 PDF 与网页对照翻译，保留公式、图表和阅读结构。',
    icons: {
      16: 'icons/16.png',
      32: 'icons/32.png',
      48: 'icons/48.png',
      128: 'icons/128.png',
    },
    permissions: ['activeTab', 'scripting', 'storage', 'sidePanel'],
    host_permissions: ['file:///*'],
    optional_host_permissions: [TRANSLATION_PROVIDERS.google.origin, TRANSLATION_PROVIDERS.youdao.origin, AI_HOST_PERMISSION],
    minimum_chrome_version: '116',
  },
});
