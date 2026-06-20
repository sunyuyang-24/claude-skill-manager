const fs = require('fs');
const path = require('path');
const os = require('os');

// ── YAML frontmatter parser (lightweight, no dependencies) ─────────────

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!match) return { data: {}, body: content };

  const yamlStr = match[1];
  const body = content.slice(match[0].length);
  const data = {};
  const lines = yamlStr.split('\n');
  let i = 0;

  function parseValue(raw) {
    raw = raw.trim();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null' || raw === '~') return null;
    if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
    if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
    // Quoted string
    if ((raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1).replace(/\\(.)/g, '$1');
    }
    return raw;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) { i++; continue; }

    const keyMatch = line.match(/^(\s*)([\w-]+)\s*:\s*(.*)/);
    if (!keyMatch) { i++; continue; }

    const indent = keyMatch[1].length;
    const key = keyMatch[2];
    const rest = keyMatch[3].trim();

    // Literal block scalar: key: | or key: |-
    if (rest === '|' || rest === '|-') {
      const lines2 = [];
      i++;
      const blockIndent = line.match(/^\s*/)[0].length + 2;
      while (i < lines.length) {
        const l = lines[i];
        const lIndent = l.match(/^(\s*)/)[1].length;
        if (l.trim() === '') { lines2.push(''); i++; continue; }
        if (lIndent < blockIndent) break;
        lines2.push(l.slice(blockIndent));
        i++;
      }
      data[key] = lines2.join('\n');
      continue;
    }

    // Handle inline arrays: [item1, item2]
    if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1);
      data[key] = inner.split(',').map(s => parseValue(s.trim().replace(/^["']|["']$/g, '')));
      i++;
      continue;
    }

    // Simple scalar
    if (rest !== '') {
      data[key] = parseValue(rest);
      i++;
      continue;
    }

    // Nested object — next lines are indented more than current
    i++;
    const nested = {};
    while (i < lines.length) {
      const nl = lines[i];
      const nlTrim = nl.trim();
      if (nlTrim === '' || nlTrim.startsWith('#')) { i++; continue; }
      const nlIndent = nl.match(/^(\s*)/)[1].length;
      if (nlIndent <= indent) break; // back to parent level
      const nkMatch = nl.match(/^(\s*)([\w-]+)\s*:\s*(.*)/);
      if (!nkMatch) { i++; continue; }
      const nk = nkMatch[2];
      const nr = nkMatch[3].trim();
      if (nr.startsWith('[') && nr.endsWith(']')) {
        nested[nk] = nr.slice(1, -1).split(',').map(s => parseValue(s.trim().replace(/^["']|["']$/g, '')));
      } else if (nr !== '') {
        nested[nk] = parseValue(nr);
      } else {
        // Deeper nesting — skip for now, we handle 2 levels max which is enough
        i++;
        nested[nk] = {};
        while (i < lines.length) {
          const dl = lines[i];
          const dlIndent = dl.match(/^(\s*)/)[1].length;
          if (dlIndent <= nlIndent) break;
          const dkMatch = dl.match(/^(\s*)([\w-]+)\s*:\s*(.*)/);
          if (dkMatch && dkMatch[3].trim()) {
            nested[nk][dkMatch[2]] = parseValue(dkMatch[3].trim());
          }
          i++;
        }
        continue;
      }
      i++;
    }
    data[key] = nested;
  }

  return { data, body };
}

// ── Skill scanning ──────────────────────────────────────────────────────

function findSkillDirs(rootDir, maxDepth = 3) {
  const results = [];
  if (!fs.existsSync(rootDir)) return results;

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return; } // skip unreadable directories

    // Check if current directory contains SKILL.md — it's a skill
    const hasSkillMd = entries.some(e => e.isFile() && e.name === 'SKILL.md');
    if (hasSkillMd) {
      results.push(dir);
    }

    // Recurse into subdirectories
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  }

  walk(rootDir, 0);
  return results;
}

function categorizeSource(dir, config) {
  const norm = (p) => path.normalize(p).toLowerCase();
  const dirNorm = norm(dir);

  // Check against known source directories to label them meaningfully
  for (const src of (config.sources || [])) {
    if (src && src.path && norm(src.path) && dirNorm.startsWith(norm(src.path))) {
      return src.label || 'custom';
    }
  }

  if (config.agentsSkillsDir && norm(config.agentsSkillsDir) && dirNorm.startsWith(norm(config.agentsSkillsDir))) {
    // Derive label from the parent grouping if available
    const rel = path.relative(config.agentsSkillsDir, dir);
    const topDir = rel.split(path.sep)[0];
    if (topDir && topDir !== '..') return topDir;
    return 'shared';
  }
  if (config.userSkillsDir && norm(config.userSkillsDir) && dirNorm.startsWith(norm(config.userSkillsDir))) {
    try {
      const stat = fs.lstatSync(dir);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(dir);
        // Derive label from symlink target's parent
        const targetParent = path.basename(path.dirname(target));
        if (targetParent && targetParent !== 'skills') return targetParent;
        return 'linked';
      }
    } catch (e) {}
    return 'user';
  }
  // Check if inside any plugins/marketplaces directory
  if (dirNorm.includes('plugins') && dirNorm.includes('marketplaces')) {
    // Extract marketplace name from path
    const parts = dirNorm.split(path.sep);
    const mpIdx = parts.indexOf('marketplaces');
    if (mpIdx >= 0 && mpIdx + 1 < parts.length) return parts[mpIdx + 1];
    return 'marketplace';
  }
  return 'local';
}

// Auto-detect common skill directories on any OS
function detectCommonSkillDirs(homedir) {
  const dirs = [];
  // Claude Code user skills
  const ccSkills = path.join(homedir, '.claude', 'skills');
  if (fs.existsSync(ccSkills)) dirs.push(ccSkills);
  // Shared agent skills (Codex / Claude Code)
  const agentSkills = path.join(homedir, '.agents', 'skills');
  if (fs.existsSync(agentSkills)) dirs.push(agentSkills);
  // Claude Code plugins directory
  const pluginsDir = path.join(homedir, '.claude', 'plugins');
  if (fs.existsSync(pluginsDir)) {
    // Add each marketplace's skills if present
    const mpDir = path.join(pluginsDir, 'marketplaces');
    if (fs.existsSync(mpDir)) {
      try {
        for (const mp of fs.readdirSync(mpDir)) {
          const mpSkills = path.join(mpDir, mp, 'skills');
          if (fs.existsSync(mpSkills)) dirs.push(mpSkills);
        }
      } catch (e) { /* skip */ }
    }
  }
  return dirs;
}

function detectStatus(skillName, config) {
  const status = { user: false, project: false, userPath: null, projectPath: null, userIsSymlink: false, projectIsSymlink: false };

  // User-level
  if (config.userSkillsDir) {
    const userPath = path.join(config.userSkillsDir, skillName);
    try {
      const stat = fs.lstatSync(userPath);
      status.user = true;
      status.userPath = userPath;
      status.userIsSymlink = stat.isSymbolicLink();
    } catch (e) { /* ENOENT or permission error — treat as not enabled */ }
  }

  // Project-level
  if (config.projectSkillsDir) {
    const projectPath = path.join(config.projectSkillsDir, skillName);
    try {
      const stat = fs.lstatSync(projectPath);
      status.project = true;
      status.projectPath = projectPath;
      status.projectIsSymlink = stat.isSymbolicLink();
    } catch (e) { /* ENOENT or permission error — treat as not enabled */ }
  }

  return status;
}

function readSkillMd(skillDir) {
  const mdPath = path.join(skillDir, 'SKILL.md');
  try {
    const content = fs.readFileSync(mdPath, 'utf-8');
    const { data, body } = parseFrontmatter(content);
    return { mdPath, content, frontmatter: data, body, size: Buffer.byteLength(content, 'utf-8') };
  } catch (e) {
    return { mdPath, content: '', frontmatter: {}, body: '', size: 0, error: e.message };
  }
}

// ── Public API ──────────────────────────────────────────────────────────

let skillCache = null;
let lastScanTime = 0;

function scanAll(config) {
  const skillMap = new Map();
  const allSources = [];

  // Auto-detect common Claude Code skill directories
  const homedir = os.homedir();
  const autoDirs = detectCommonSkillDirs(homedir);
  for (const d of autoDirs) {
    if (!allSources.includes(d)) allSources.push(d);
  }

  // User-configured custom sources
  for (const src of (config.sources || [])) {
    const dir = typeof src === 'string' ? src : src.path;
    if (dir && fs.existsSync(dir) && !allSources.includes(dir)) {
      allSources.push(dir);
    }
  }

  for (const srcDir of allSources) {
    const skillDirs = findSkillDirs(srcDir);
    for (const dir of skillDirs) {
      const skillName = path.basename(dir);
      if (skillMap.has(skillName)) continue;

      const md = readSkillMd(dir);
      const frontmatterName = md.frontmatter.name || skillName;
      const description = md.frontmatter.description || '';
      const sourceType = categorizeSource(dir, config);
      const status = detectStatus(skillName, config);

      skillMap.set(skillName, {
        name: skillName,
        displayName: frontmatterName !== skillName ? frontmatterName : null,
        description,
        version: md.frontmatter.version || null,
        metadata: md.frontmatter.metadata || null,
        sourceType,
        sourceDir: dir,
        skillMdPath: md.mdPath,
        size: md.size,
        error: md.error || null,
        installedAt: {
          user: status.userPath,
          userIsSymlink: status.userIsSymlink,
          project: status.projectPath,
          projectIsSymlink: status.projectIsSymlink,
        },
        enabled: {
          user: status.user,
          project: status.project,
        },
      });
    }
  }

  skillCache = Array.from(skillMap.values());
  lastScanTime = Date.now();
  return skillCache;
}

function getSkills(config) {
  if (!skillCache || (Date.now() - lastScanTime > 30000)) {
    return scanAll(config);
  }
  return skillCache;
}

function getSkillByName(config, name) {
  const skills = getSkills(config);
  return skills.find(s => s.name === name) || null;
}

function refreshCache(config) {
  skillCache = null;
  return scanAll(config);
}

module.exports = { parseFrontmatter, findSkillDirs, categorizeSource, detectCommonSkillDirs, detectStatus, readSkillMd, scanAll, getSkills, getSkillByName, refreshCache };
