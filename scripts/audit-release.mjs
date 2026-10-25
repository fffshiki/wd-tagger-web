import { execFileSync } from 'node:child_process';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { root, publicFiles, sourcePath } from './build.mjs';

export const repositoryFiles = [
  '.gitattributes', '.gitignore', '.github/workflows/pages.yml', 'README.md',
  'baseline/README.md', 'baseline/v18-original.html',
  'docs/COMPATIBILITY.md', 'docs/TESTING.md', 'docs/PUBLISHING.md',
  'package.json', 'package-lock.json', 'playwright.config.mjs',
  'scripts/build.mjs', 'scripts/serve.mjs', 'scripts/audit-release.mjs',
  'tests/browser.test.mjs', 'tests/data-compatibility.test.mjs', 'tests/migration.test.mjs',
  'tests/runtime.test.mjs', 'tests/release.test.mjs', 'tests/tag-catalog.test.mjs',
  ...publicFiles.filter(name => !name.startsWith('vendor/')).map(name => 'web/' + name),
].sort();

export async function auditDist(directory = path.join(root, 'dist')) {
  const files = [];
  const walk = async (folder, prefix = '') => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw Error('公開先にリンクがあります: ' + relative);
      if (entry.isDirectory()) await walk(path.join(folder, entry.name), relative + '/');
      else if (!entry.isFile() || !publicFiles.includes(relative)) throw Error('公開許可リスト外: ' + relative);
      else files.push(relative);
    }
  };
  await walk(directory);
  if (JSON.stringify(files.sort()) !== JSON.stringify([...publicFiles].sort())) throw Error('公開ファイルに欠落があります');
  let totalBytes = 0;
  for (const relative of files) {
    const target = path.join(directory, relative), stats = await lstat(target);
    if (stats.nlink !== 1) throw Error('公開ファイルがハードリンクです: ' + relative);
    const [actual, expected] = await Promise.all([readFile(target), readFile(sourcePath(relative))]);
    if (!actual.equals(expected)) throw Error('公開内容がソースと異なります: ' + relative);
    totalBytes += actual.length;
  }
  return { publicFiles: files, totalBytes };
}

export function auditRepository() {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean).sort();
  const allowed = new Set(repositoryFiles);
  for (const name of tracked) if (!allowed.has(name)) throw Error('Git管理対象に許可外ファイルがあります: ' + name);
  if (JSON.stringify(tracked) !== JSON.stringify(repositoryFiles)) throw Error('リポジトリの公開予定一覧とGit管理対象が一致しません');
  const history = git(['rev-list', '--objects', '--all']).split('\n').filter(Boolean);
  const historicalFiles = new Set();
  for (const line of history) {
    const separator = line.indexOf(' ');
    if (separator < 0) continue;
    const name = line.slice(separator + 1);
    if (!name) continue; // Root tree, not a file.
    // Git also lists tree names; only leaf paths are required to be in the allowlist.
    if (repositoryFiles.some(file => file.startsWith(name + '/'))) continue;
    if (!allowed.has(name)) throw Error('Git履歴に許可外のファイルがあります: ' + name);
    historicalFiles.add(name);
  }
  return { repositoryFiles: tracked, historyFileCount: historicalFiles.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({ ...auditRepository(), ...await auditDist() }, null, 2));
}
