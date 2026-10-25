import { mkdir, readdir, copyFile, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const publicFiles = [
  'index.html', 'css/app.css', 'js/v18-core.js', 'js/v18-dataset.js',
  'js/v18-extensions.js', 'js/compatibility.js', 'js/data-compatibility.js',
];

export async function build() {
  const destination = path.join(root, 'dist');
  const allowedDirectories = new Set(['css', 'js']);
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
    const source = path.join(root, 'web', relative);
    if (!(await lstat(source)).isFile()) throw Error(`通常ファイルではありません: ${relative}`);
    const target = path.join(destination, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  console.log(`公開用ファイルを${publicFiles.length}件作成しました: dist/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
