import fs from 'node:fs';
import path from 'node:path';

const srcDir = path.resolve('node_modules/@huggingface/transformers/dist');
const dstDir = path.resolve('public/ort');
const files = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
];

fs.mkdirSync(dstDir, { recursive: true });
for (const file of files) {
  const from = path.join(srcDir, file);
  const to = path.join(dstDir, file);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, to);
  }
}
