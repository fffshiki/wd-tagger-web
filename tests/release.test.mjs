import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from '../scripts/build.mjs';
import { auditRepository, auditDist } from '../scripts/audit-release.mjs';

test('repository and all reachable history contain only reviewed source paths', () => {
  const result = auditRepository();
  assert.ok(result.repositoryFiles.includes('.github/workflows/pages.yml'));
  assert.ok(!result.repositoryFiles.some(name => /private-validation|model\.onnx|selected_tags\.csv/.test(name)));
});

test('publish artifact contains matching runtime assets and no private data', async () => {
  const result = await auditDist();
  assert.ok(result.publicFiles.includes('vendor/onnxruntime/ort-wasm-simd-threaded.wasm'));
  assert.ok(result.totalBytes > 11_000_000 && result.totalBytes < 15_000_000);
});

test('release audit rejects an unexpected teacher JSON in an artifact', async () => {
  const directory = await mkdtemp(path.join(root, 'release-audit-test-'));
  const file = path.join(directory, 'private-teacher.json');
  try {
    await writeFile(file, '{"synthetic":true}');
    await assert.rejects(auditDist(directory), /公開許可リスト外/);
  } finally { await unlink(file); await rmdir(directory); }
});

test('deployment is manual-only and uploads only dist after audit', async () => {
  const workflow = await readFile(path.join(root, '.github/workflows/pages.yml'), 'utf8');
  assert.match(workflow, /on:\s*\n\s+workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*(push|pull_request|schedule):/m);
  assert.match(workflow, /path: dist\s/);
  assert.ok(workflow.indexOf('npm run audit:release') < workflow.indexOf('uses: actions/upload-pages-artifact'));
  assert.match(workflow, /needs: build/);
});
