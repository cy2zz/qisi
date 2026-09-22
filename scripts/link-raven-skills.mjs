import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Raven 0.35.12 installs to .codex/skills; expose the same files via .agents/skills.
// Keep relative skill references (including _shared) intact. Never replace user skills.
export function linkRavenSkills(root) {
  const source = path.join(root, '.codex', 'skills');
  const destination = path.join(root, '.agents', 'skills');
  if (!existsSync(source)) {
    throw new Error('Raven skills not installed. Run raven init -a codex first.');
  }

  const names = readdirSync(source).filter((name) => {
    const stat = lstatSync(path.join(source, name));
    return stat.isDirectory() || stat.isSymbolicLink();
  });
  if (!names.includes('sdd-new-change') || !existsSync(path.join(source, 'sdd-new-change', 'SKILL.md'))) {
    throw new Error('sdd-new-change/SKILL.md is missing; Raven initialization is incomplete.');
  }

  // Preflight every path before creating anything, including dangling user links.
  const links = names.map((name) => {
    const from = realpathSync(path.join(source, name));
    const to = path.join(destination, name);
    let existing;
    try {
      existing = lstatSync(to);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (existing) {
      let actual;
      try { actual = realpathSync(to); } catch { /* dangling links are conflicts */ }
      if (actual !== from) throw new Error('Refusing to overwrite existing skill: ' + to);
    }
    return { from, to, exists: Boolean(existing) };
  });

  mkdirSync(destination, { recursive: true });
  for (const link of links) {
    if (!link.exists) {
      symlinkSync(link.from, link.to, process.platform === 'win32' ? 'junction' : 'dir');
    }
  }
  return { created: links.filter((link) => !link.exists).length, existing: links.filter((link) => link.exists).length };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    const root = fileURLToPath(new URL('../', import.meta.url));
    console.log(JSON.stringify(linkRavenSkills(root)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
