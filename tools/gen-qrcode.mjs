/**
 * 生成站点二维码（PNG + SVG），用于分享给听众。
 *
 * 用法：
 *   npm run qrcode -- https://zbenhan.github.io/ai-course-qa/
 * 或直接：
 *   node tools/gen-qrcode.mjs https://zbenhan.github.io/ai-course-qa/
 *
 * 生成结果：
 *   docs/qrcode.png   页面顶部展示用（也是听众直接保存的图片）
 *   docs/qrcode.svg   矢量版，投屏更清晰
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(__dirname, '..', 'docs');

const url = process.argv[2];
if (!url) {
  console.error('请传入要生成二维码的网址，例如：npm run qrcode -- https://xxx.github.io/repo/');
  process.exit(1);
}

fs.mkdirSync(docsDir, { recursive: true });

const options = {
  errorCorrectionLevel: 'M',
  margin: 2,
  width: 1024,
  color: { dark: '#14161fff', light: '#ffffffff' },
};

await QRCode.toFile(path.join(docsDir, 'qrcode.png'), url, options);
fs.writeFileSync(path.join(docsDir, 'qrcode.svg'), await QRCode.toString(url, { ...options, type: 'svg' }));

console.log('✅ 二维码已生成');
console.log('   网址: ' + url);
console.log('   docs/qrcode.png');
console.log('   docs/qrcode.svg');
