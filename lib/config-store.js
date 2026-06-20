const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Constants ────────────────────────────────────────────────────────────

const SCOPES = Object.freeze({ USER: 'user', PROJECT: 'project' });
const SCOPE_LABELS = Object.freeze({ user: 'User', project: 'Project' });

function getConfigPath() {
  return path.join(__dirname, '..', 'skill-manager-config.json');
}

// ── Default config ───────────────────────────────────────────────────────

function buildDefaultConfig() {
  const homedir = os.homedir();
  return {
    userSkillsDir: path.join(homedir, '.claude', 'skills'),
    agentsSkillsDir: path.join(homedir, '.agents', 'skills'),
    projectSkillsDir: null,
    projectPath: null,
    sources: [],
  };
}

// ── Load / Save ──────────────────────────────────────────────────────────

function loadConfig() {
  const defaults = buildDefaultConfig();
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const fileData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return { ...defaults, ...fileData };
    }
  } catch (e) { /* ignore, use defaults */ }
  return { ...defaults };
}

function saveConfig(config) {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    projectPath: config.projectPath || null,
    sources: config.sources || [],
  }, null, 2), 'utf-8');
}

function resolveTargetDir(config, scope) {
  return scope === SCOPES.PROJECT ? config.projectSkillsDir : config.userSkillsDir;
}

function resolveTargetPath(config, skillName, scope) {
  const dir = resolveTargetDir(config, scope);
  return dir ? path.join(dir, skillName) : null;
}

function scopeLabel(scope) {
  return SCOPE_LABELS[scope] || scope;
}

module.exports = {
  SCOPES,
  buildDefaultConfig,
  loadConfig,
  saveConfig,
  resolveTargetDir,
  resolveTargetPath,
  scopeLabel,
  getConfigPath,
};
