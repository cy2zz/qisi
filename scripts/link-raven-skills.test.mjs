import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { linkRavenSkills } from './link-raven-skills.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'qisi-raven-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), realpathSync(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('qisi-raven-test-'));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function skill(root, name, content = '---\nname: ' + name + '\n---\n') {
  const dir = path.join(root, '.codex', 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), content);
  return dir;
}

test('links Raven skills and shared references; reruns are idempotent', (t) => {
  const root = fixture(t);
  const source = skill(root, 'sdd-new-change');
  mkdirSync(path.join(root, '.codex', 'skills', '_shared'));
  writeFileSync(path.join(root, '.codex', 'skills', '_shared', 'context.md'), 'shared');
  assert.deepEqual(linkRavenSkills(root), { created: 2, existing: 0 });
  assert.equal(realpathSync(path.join(root, '.agents', 'skills', 'sdd-new-change')), realpathSync(source));
  assert.equal(readFileSync(path.join(root, '.agents', 'skills', '_shared', 'context.md'), 'utf8'), 'shared');
  assert.deepEqual(linkRavenSkills(root), { created: 0, existing: 2 });
});

test('rejects missing or incomplete Raven installation', (t) => {
  const root = fixture(t);
  assert.throws(() => linkRavenSkills(root), /not installed/);
  skill(root, 'another-skill');
  assert.throws(() => linkRavenSkills(root), /initialization is incomplete/);
});

test('preserves unrelated skills and refuses conflicts before creating links', (t) => {
  const root = fixture(t);
  skill(root, 'sdd-new-change');
  skill(root, 'aaa-first');
  const custom = path.join(root, '.agents', 'skills', 'sdd-new-change');
  mkdirSync(custom, { recursive: true });
  writeFileSync(path.join(custom, 'SKILL.md'), 'user content');
  assert.throws(() => linkRavenSkills(root), /Refusing to overwrite/);
  assert.equal(readFileSync(path.join(custom, 'SKILL.md'), 'utf8'), 'user content');
  assert.equal(existsSync(path.join(root, '.agents', 'skills', 'aaa-first')), false);
});

test('resolves Raven junctions to their real target', (t) => {
  const root = fixture(t);
  const global = path.join(root, 'global-cache');
  mkdirSync(global);
  writeFileSync(path.join(global, 'SKILL.md'), 'global skill');
  mkdirSync(path.join(root, '.codex', 'skills'), { recursive: true });
  symlinkSync(global, path.join(root, '.codex', 'skills', 'sdd-new-change'), process.platform === 'win32' ? 'junction' : 'dir');
  linkRavenSkills(root);
  assert.equal(realpathSync(path.join(root, '.agents', 'skills', 'sdd-new-change')), realpathSync(global));
});

test('keeps pre-existing KnowVault skills untouched', (t) => {
  const root = fixture(t);
  skill(root, 'sdd-new-change');
  const knowledge = path.join(root, '.agents', 'skills', 'raven-knowvault-local-query');
  mkdirSync(knowledge, { recursive: true });
  writeFileSync(path.join(knowledge, 'SKILL.md'), 'knowledge');
  linkRavenSkills(root);
  assert.equal(readFileSync(path.join(knowledge, 'SKILL.md'), 'utf8'), 'knowledge');
});
