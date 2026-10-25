import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Script } from 'node:vm';
import { root, publicFiles, build, sourcePath } from '../scripts/build.mjs';

const original = await readFile(new URL('../baseline/v18-original.html', import.meta.url));
const source = original.toString('utf8');
const names = ['v18-core.js', 'v18-dataset.js', 'v18-extensions.js'];

test('v18 baseline matches the recorded SHA256 and recoverable Git tag', () => {
  assert.equal(createHash('sha256').update(original).digest('hex'), '3b8eefa13cd38dbd0a497c08c3169933f8e669a70252004216bcd85439e52f76');
  assert.deepEqual(execFileSync('git', ['show', 'v18-baseline:baseline/v18-original.html'], { cwd: root }), original);
});

test('original scripts retain behavior with only reviewed runtime deployment edits', async () => {
  const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, names.length);
  for (let i = 0; i < names.length; i++) {
    const actual = await readFile(new URL(`../web/js/${names[i]}`, import.meta.url), 'utf8');
    const expected = i === 0 ? scripts[i][1]
      .replace("const version='1.20.1',base=`https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`;", "const version='1.20.1',base=new URL('./vendor/onnxruntime/',document.baseURI).href;")
      .replace("loadScript(base+'ort.min.js')", "loadScript(base+'ort.wasm.min.js')") : scripts[i][1];
    assert.equal(actual, expected);
    new Script(actual, { filename: names[i] });
  }
  assert.equal(await readFile(new URL('../web/css/app.css', import.meta.url), 'utf8'), source.match(/<style>([\s\S]*?)<\/style>/)[1]);
});

test('HTML retains original markup and classic script execution order', async () => {
  let i = 0;
  const expected = source.replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="./css/app.css">')
    .replace(/<script>[\s\S]*?<\/script>/g, () => `<script src="./js/${names[i++]}"></script>`)
    .replace('</head>', '<link rel="stylesheet" href="./css/tag-catalog.css"></head>')
    .replace('</body>', '<script src="./js/compatibility.js"></script><script src="./js/data-compatibility.js"></script><script src="./js/model-sources.js"></script><script src="./js/tag-catalog.js"></script></body>');
  assert.equal(await readFile(new URL('../web/index.html', import.meta.url), 'utf8'), expected);
  new Script(await readFile(new URL('../web/js/compatibility.js', import.meta.url), 'utf8'));
  new Script(await readFile(new URL('../web/js/data-compatibility.js', import.meta.url), 'utf8'));
  new Script(await readFile(new URL('../web/js/model-sources.js', import.meta.url), 'utf8'));
  new Script(await readFile(new URL('../web/js/tag-catalog.js', import.meta.url), 'utf8'));
});

test('private artifacts are ignored by Git while source and tests are allowed', () => {
  const privateNames = ['IMG_0001.png', 'web/IMG_0001_教師データ_v10.json', 'web/js/private.json', 'private/dictionary.json', 'model.onnx', 'dist/index.html', 'node_modules/example.js', '.env', 'tests/private-photo.jpg'];
  const ignored = execFileSync('git', ['check-ignore', '--stdin'], { cwd: root, input: privateNames.join('\n') + '\n', encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.equal(ignored.length, privateNames.length);
  for (const relative of publicFiles) assert.ok(!relative.endsWith('.json') && !relative.includes('baseline'));
});

test('publish artifact contains only the explicit application allowlist', async () => {
  await build();
  const files = (await readdir(new URL('../dist/', import.meta.url), { recursive: true, withFileTypes: true })).filter(x => x.isFile());
  assert.equal(files.length, publicFiles.length);
  for (const relative of publicFiles) assert.deepEqual(await readFile(new URL('../dist/' + relative, import.meta.url)), await readFile(sourcePath(relative)));
});
