const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');

const { getSkills, getSkillByName, refreshCache, findSkillDirs, readSkillMd } = require('./skill-store');
const { enableSkill, disableSkill } = require('./skill-actions');
const { detectCommonSkillDirs } = require('./skill-store');
const { SCOPES, saveConfig: persistConfig, resolveTargetDir } = require('./config-store');

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { resolve({}); }
    });
  });
}

function createServer(config) {
  const publicDir = path.join(__dirname, '..', 'public');

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const pathname = parsedUrl.pathname;
    const method = req.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    // ── API Routes ──────────────────────────────────────────────────

    // GET /api/skills
    if (method === 'GET' && pathname === '/api/skills') {
      const search = (parsedUrl.searchParams.get('search') || '').toLowerCase();
      const source = parsedUrl.searchParams.get('source') || '';
      const status = parsedUrl.searchParams.get('status') || '';

      let skills = getSkills(config);

      if (search) {
        skills = skills.filter(s =>
          s.name.toLowerCase().includes(search) ||
          (s.description && s.description.toLowerCase().includes(search))
        );
      }
      if (source) {
        skills = skills.filter(s => s.sourceType === source);
      }
      if (status === 'enabled') {
        skills = skills.filter(s => s.enabled.user || s.enabled.project);
      } else if (status === 'disabled') {
        skills = skills.filter(s => !s.enabled.user && !s.enabled.project);
      }

      // Return summary (no full content)
      const result = skills.map(s => ({
        name: s.name,
        displayName: s.displayName,
        description: s.description,
        version: s.version,
        sourceType: s.sourceType,
        size: s.size,
        enabled: s.enabled,
        installedAt: s.installedAt,
      }));

      return sendJSON(res, 200, { skills: result, total: result.length });
    }

    // GET /api/skills/:name — lazy-load full content
    const skillMatch = pathname.match(/^\/api\/skills\/(.+)$/);
    if (method === 'GET' && skillMatch) {
      const name = decodeURIComponent(skillMatch[1]);
      const skill = getSkillByName(config, name);
      if (!skill) {
        return sendJSON(res, 404, { error: 'not_found', message: `Skill "${name}" not found.` });
      }
      // Lazy-load the full SKILL.md content only when viewing a single skill
      const md = readSkillMd(skill.sourceDir);
      return sendJSON(res, 200, {
        ...skill,
        skillMdContent: md.content,
        skillMdBody: md.body,
      });
    }

    // POST /api/skills/:name/enable and /api/skills/:name/disable
    const toggleMatch = pathname.match(/^\/api\/skills\/(.+)\/(enable|disable)$/);
    if (method === 'POST' && toggleMatch) {
      const name = decodeURIComponent(toggleMatch[1]);
      const action = toggleMatch[2]; // 'enable' | 'disable'
      const body = await readBody(req);
      const scope = body.scope || SCOPES.USER;
      if (scope !== SCOPES.USER && scope !== SCOPES.PROJECT) {
        return sendJSON(res, 400, { error: 'invalid_scope', message: 'Scope must be "user" or "project".' });
      }
      const fn = action === 'enable' ? enableSkill : disableSkill;
      const result = await fn(config, name, scope);
      const statusCode = result.success ? 200 : 400;
      return sendJSON(res, statusCode, result);
    }

    // GET /api/sources
    if (method === 'GET' && pathname === '/api/sources') {
      const homedir = os.homedir();
      const autoDirs = detectCommonSkillDirs(homedir);

      const sources = [];
      for (const dir of autoDirs) {
        const basename = path.basename(dir);
        const parent = path.basename(path.dirname(dir));
        sources.push({ path: dir, label: parent + '/' + basename, autoDetected: true });
      }
      for (let i = 0; i < (config.sources || []).length; i++) {
        const src = config.sources[i];
        const dir = typeof src === 'string' ? src : src.path;
        const label = typeof src === 'string' ? path.basename(dir) : (src.label || path.basename(dir));
        sources.push({ path: dir, label, autoDetected: false, index: i });
      }
      return sendJSON(res, 200, { sources });
    }

    // POST /api/sources/add
    if (method === 'POST' && pathname === '/api/sources/add') {
      const body = await readBody(req);
      const dir = body.path || body.dir || '';
      if (!dir || !fs.existsSync(dir)) {
        return sendJSON(res, 400, { error: 'invalid_path', message: 'Directory does not exist: ' + dir });
      }
      // Check if already added
      if ((config.sources || []).some(s => (typeof s === 'string' ? s : s.path) === dir)) {
        return sendJSON(res, 400, { error: 'already_added', message: 'This directory is already a source.' });
      }
      const entry = { path: path.resolve(dir), label: body.label || path.basename(dir) };
      if (!config.sources) config.sources = [];
      config.sources.push(entry);
      persistConfig(config);
      refreshCache(config);
      return sendJSON(res, 200, { message: 'Source added', source: entry, total: getSkills(config).length });
    }

    // DELETE /api/sources/:index
    if (method === 'DELETE' && pathname.startsWith('/api/sources/')) {
      const idx = parseInt(pathname.split('/').pop(), 10);
      if (isNaN(idx) || idx < 0 || idx >= (config.sources || []).length) {
        return sendJSON(res, 400, { error: 'invalid_index', message: 'Invalid source index.' });
      }
      const removed = config.sources.splice(idx, 1)[0];
      persistConfig(config);
      refreshCache(config);
      return sendJSON(res, 200, { message: 'Source removed', removed, total: getSkills(config).length });
    }

    // POST /api/scan-directory — scan an arbitrary local folder for skills (read-only preview)
    if (method === 'POST' && pathname === '/api/scan-directory') {
      const body = await readBody(req);
      const dir = body.path || '';
      if (!dir || !fs.existsSync(dir)) {
        return sendJSON(res, 400, { error: 'invalid_path', message: 'Directory does not exist.' });
      }
      const dirs = findSkillDirs(path.resolve(dir));
      const found = dirs.map(d => {
        const md = readSkillMd(d);
        return {
          name: md.frontmatter.name || path.basename(d),
          dirName: path.basename(d),
          description: md.frontmatter.description || '',
          path: d,
          size: md.size,
        };
      });
      return sendJSON(res, 200, { path: path.resolve(dir), skills: found, total: found.length });
    }

    // POST /api/scan
    if (method === 'POST' && pathname === '/api/scan') {
      refreshCache(config);
      const skills = getSkills(config);
      return sendJSON(res, 200, { message: 'Scan complete', total: skills.length });
    }

    // GET /api/config
    if (method === 'GET' && pathname === '/api/config') {
      return sendJSON(res, 200, {
        projectPath: config.projectPath || null,
        projectSkillsDir: config.projectSkillsDir || null,
        userSkillsDir: config.userSkillsDir,
        agentsSkillsDir: config.agentsSkillsDir,
        sources: config.sources || [],
      });
    }

    // PUT /api/config
    if (method === 'PUT' && pathname === '/api/config') {
      const body = await readBody(req);
      if (body.projectPath !== undefined) {
        config.projectPath = body.projectPath || null;
        config.projectSkillsDir = config.projectPath
          ? path.join(config.projectPath, '.claude', 'skills')
          : null;
      }
      if (body.sources !== undefined) {
        config.sources = body.sources;
      }
      persistConfig(config);
      refreshCache(config);
      return sendJSON(res, 200, {
        message: 'Config updated',
        projectPath: config.projectPath,
        projectSkillsDir: config.projectSkillsDir,
      });
    }

    // POST /api/translate — proxy to Google Translate (avoids CORS)
    if (method === 'POST' && pathname === '/api/translate') {
      const body = await readBody(req);
      const text = body.text || '';
      const targetLang = body.targetLang || 'zh-CN';
      const sourceLang = body.sourceLang || 'en';
      if (!text) {
        return sendJSON(res, 400, { error: 'no_text', message: 'No text provided.' });
      }
      try {
        const translated = await translateText(text, sourceLang, targetLang);
        return sendJSON(res, 200, { translated, original: text });
      } catch (e) {
        return sendJSON(res, 500, { error: 'translate_failed', message: e.message });
      }
    }

    // POST /api/translate-batch — parallel chunked translation
    if (method === 'POST' && pathname === '/api/translate-batch') {
      const body = await readBody(req);
      const texts = body.texts || [];
      const targetLang = body.targetLang || 'zh-CN';
      const sourceLang = body.sourceLang || 'en';
      if (!texts.length) {
        return sendJSON(res, 400, { error: 'no_texts', message: 'No texts provided.' });
      }
      try {
        // Translate in parallel with concurrency limit of 8
        const concurrency = 8;
        const results = new Array(texts.length);
        let idx = 0;
        const workers = [];
        for (let w = 0; w < concurrency; w++) {
          workers.push((async () => {
            while (idx < texts.length) {
              const i = idx++;
              results[i] = await translateText(texts[i], sourceLang, targetLang);
            }
          })());
        }
        await Promise.all(workers);
        return sendJSON(res, 200, { translations: results });
      } catch (e) {
        return sendJSON(res, 500, { error: 'translate_failed', message: e.message });
      }
    }

    async function translateText(text, sourceLang, targetLang) {
      const langPair = `${sourceLang}|${targetLang}`;
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langPair)}`;
      return new Promise((resolve, reject) => {
        https.get(url, (resp) => {
          let data = '';
          resp.on('data', (chunk) => { data += chunk; });
          resp.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              const translated = (parsed.responseData && parsed.responseData.translatedText) || text;
              resolve(translated);
            } catch (e) { reject(e); }
          });
        }).on('error', reject);
      });
    }

    // ── Static file serving ──────────────────────────────────────────

    if (method === 'GET') {
      let filePath;
      if (pathname === '/' || pathname === '') {
        filePath = path.join(publicDir, 'index.html');
      } else {
        // Only serve files from public dir (prevent directory traversal)
        const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
        filePath = path.join(publicDir, safePath);
        // Ensure the resolved path is within publicDir
        if (!filePath.startsWith(publicDir)) {
          return sendJSON(res, 403, { error: 'forbidden' });
        }
      }

      try {
        const content = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.json': 'application/json',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      } catch (e) {
        if (e.code === 'ENOENT') {
          return sendJSON(res, 404, { error: 'not_found', message: 'File not found.' });
        }
        return sendJSON(res, 500, { error: 'server_error', message: e.message });
      }
      return;
    }

    // 404 for unmatched routes
    sendJSON(res, 404, { error: 'not_found', message: `No route for ${method} ${pathname}` });
  });

  return server;
}

function startServer(config, port = 0) {
  return new Promise((resolve, reject) => {
    const server = createServer(config);
    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Try another port
        server.listen(0, '127.0.0.1', () => resolve(server));
      } else {
        reject(err);
      }
    });
  });
}

module.exports = { createServer, startServer };
