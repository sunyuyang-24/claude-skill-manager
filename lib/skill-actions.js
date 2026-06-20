const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { getSkillByName, refreshCache } = require('./skill-store');
const { SCOPES, scopeLabel } = require('./config-store');

// ── Mutex (serialize operations on the same skill) ──────────────────────

const locks = new Map();

async function withLock(skillName, fn) {
  while (locks.has(skillName)) {
    await locks.get(skillName).catch(() => {});
  }
  const promise = (async () => { try { return await fn(); } finally { locks.delete(skillName); } })();
  locks.set(skillName, promise);
  return promise;
}

// ── Enable operations ───────────────────────────────────────────────────

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function trySymlink(sourceDir, targetPath) {
  try {
    // Use junction on Windows for directory symlinks (doesn't need admin)
    if (process.platform === 'win32') {
      // Normalize paths for Windows
      const src = path.resolve(sourceDir);
      const dst = path.resolve(targetPath);
      execSync(`cmd /c mklink /J "${dst}" "${src}"`, { stdio: 'pipe' });
      return 'junction';
    } else {
      fs.symlinkSync(sourceDir, targetPath, 'dir');
      return 'symlink';
    }
  } catch (e) {
    // Fallback to dir symlink if junction fails (might need Developer Mode)
    try {
      fs.symlinkSync(sourceDir, targetPath, 'dir');
      return 'symlink';
    } catch (e2) {
      return null; // Both failed
    }
  }
}

function copySkill(sourceDir, targetPath) {
  // Copy the directory contents manually (Node 16+ has fs.cpSync but use recursive mkdir + copy for compat)
  ensureDir(targetPath);
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(sourceDir, entry.name);
    const dst = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      copySkill(src, dst); // recursive
    } else {
      fs.copyFileSync(src, dst);
    }
  }
  // Write metadata file to indicate this was a copy
  const metaPath = path.join(targetPath, '.skill-source');
  fs.writeFileSync(metaPath, JSON.stringify({
    sourceDir,
    createdAt: new Date().toISOString(),
    method: 'copy',
  }, null, 2), 'utf-8');
}

async function enableSkill(config, skillName, scope) {
  return withLock(skillName, async () => {
    const skill = getSkillByName(config, skillName);
    if (!skill) {
      return { success: false, error: 'not_found', message: `Skill "${skillName}" not found in any source.` };
    }

    const targetDir = scope === SCOPES.PROJECT ? config.projectSkillsDir : config.userSkillsDir;
    if (!targetDir) {
      return { success: false, error: 'no_target', message: `${scopeLabel(scope)} skills directory is not configured.` };
    }

    const targetPath = path.join(targetDir, skillName);

    ensureDir(targetDir);

    // Three-tier fallback (trySymlink handles EEXIST naturally)
    let method = trySymlink(skill.sourceDir, targetPath);
    if (method) {
      refreshCache(config);
      return { success: true, method, message: `"${skillName}" enabled (${method}) at ${scope} level.` };
    }

    // Copy fallback
    try {
      copySkill(skill.sourceDir, targetPath);
      refreshCache(config);
      return { success: true, method: 'copy', message: `"${skillName}" enabled (copy) at ${scope} level. Developer Mode may be needed for symlinks.` };
    } catch (e) {
      if (e.code === 'EEXIST') {
        return { success: false, error: 'already_enabled', message: `"${skillName}" is already enabled at the ${scope} level.` };
      }
      return { success: false, error: 'copy_failed', message: `Failed to enable "${skillName}": ${e.message}` };
    }
  });
}

// ── Disable operations ──────────────────────────────────────────────────

async function disableSkill(config, skillName, scope) {
  return withLock(skillName, async () => {
    const targetDir = scope === SCOPES.PROJECT ? config.projectSkillsDir : config.userSkillsDir;
    if (!targetDir) {
      return { success: false, error: 'no_target', message: `${scopeLabel(scope)} skills directory is not configured.` };
    }

    const targetPath = path.join(targetDir, skillName);

    try {
      const stat = fs.lstatSync(targetPath);

      if (stat.isSymbolicLink()) {
        fs.unlinkSync(targetPath);
      } else if (stat.isDirectory()) {
        const metaPath = path.join(targetPath, '.skill-source');
        if (fs.existsSync(metaPath)) {
          fs.rmSync(targetPath, { recursive: true, force: true });
        } else {
          return {
            success: false,
            error: 'not_managed',
            message: `"${skillName}" at ${scope} level is a real directory, not a symlink or managed copy. Remove it manually if needed.`,
          };
        }
      } else {
        fs.unlinkSync(targetPath);
      }

      refreshCache(config);
      return { success: true, message: `"${skillName}" disabled at ${scope} level.` };
    } catch (e) {
      if (e.code === 'ENOENT') {
        return { success: false, error: 'not_enabled', message: `"${skillName}" is not enabled at the ${scope} level.` };
      }
      return { success: false, error: 'remove_failed', message: `Failed to disable "${skillName}": ${e.message}` };
    }
  });
}

module.exports = { enableSkill, disableSkill, ensureDir, trySymlink, copySkill };
