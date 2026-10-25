import { mkdir, readdir, copyFile, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const applicationFiles = [
  'index.html', 'css/app.css', 'js/v18-core.js', 'js/v18-dataset.js',
  'js/v18-extensions.js', 'js/compatibility.js', 'js/data-compatibility.js', 'js/model-sources.js',
  'licenses/onnxruntime-MIT.txt', 'licenses/onnxruntime-ThirdPartyNotices.txt',
];
export const runtimeFiles = ['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];
export const publicFiles = [...applicationFiles, ...runtimeFiles.map(name => 'vendor/onnxruntime/' + name)];
export function sourcePath(relative) {
  if (!publicFiles.includes(relative)) throw Error('公開許可リストにないファイルです: ' + relative);
  return relative.startsWith('vendor/onnxruntime/')
    ? path.join(root, 'node_modules/onnxruntime-web/dist', path.basename(relative))
    : path.join(root, 'web', relative);
}

export async function build() {
  const destination = path.join(root, 'dist');
  const allowedDirectories = new Set(['css', 'js', 'licenses', 'vendor', 'vendor/onnxruntime']);
  async function check(directory, prefix = '') {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw Error(`公開先にリンクがあります: ${relative}`);
      if (entry.isDirectory() && allowedDirectories.has(relative)) {
        await check(path.join(directory, entry.name), relative + '/');
      } else if (!entry.isFile() || !publicFiles.includes(relative)) {
        throw Error(`公開対象外のファイルがあります。distを確認してください: ${relative}`);
      }
    }
  }
  await check(destination);
  for (const relative of publicFiles) {
    const source = sourcePath(relative);
    if (!(await lstat(source)).isFile()) throw Error(`通常ファイルではありません: ${relative}`);
    const target = path.join(destination, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  console.log(`公開用ファイルを${publicFiles.length}件作成しました: dist/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
