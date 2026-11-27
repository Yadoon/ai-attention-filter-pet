import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'AT Pet',
    description: '本地 AI 注意力过滤与伴生数字宠物（B 站 / 小红书 / 抖音网页版）',
    permissions: ['storage', 'offscreen'],
    host_permissions: [
      '*://*.bilibili.com/*',
      '*://*.hdslb.com/*',
      '*://*.bilivideo.com/*',
      '*://*.bilivideo.cn/*',
      'https://huggingface.co/*',
      'https://*.hf.co/*',
      'https://hf-mirror.com/*',
      'https://bsbsb.top/*',
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    web_accessible_resources: [
      {
        resources: ['pets/*'],
        matches: ['*://*.bilibili.com/*'],
      },
    ],
  },
});
