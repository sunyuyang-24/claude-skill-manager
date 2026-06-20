const path = require('path');
const { exec } = require('child_process');
const { loadConfig, saveConfig } = require('./lib/config-store');

// ── CLI argument parsing ────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { port: 0, noBrowser: false, project: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) { opts.port = parseInt(args[i + 1], 10); i++; }
    else if (args[i] === '--project' && args[i + 1]) { opts.project = args[i + 1]; i++; }
    else if (args[i] === '--no-browser') { opts.noBrowser = true; }
    else if (args[i] === '--help') {
      console.log('Claude Code Skill Manager');
      console.log('  --port <n>      Specify port (default: random)');
      console.log('  --project <dir> Set project directory');
      console.log('  --no-browser    Don\'t open browser');
      console.log('  --help          Show this help');
      process.exit(0);
    }
  }
  return opts;
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const cliArgs = parseArgs();
  const config = loadConfig();

  if (cliArgs.project) {
    config.projectPath = path.resolve(cliArgs.project);
    config.projectSkillsDir = path.join(config.projectPath, '.claude', 'skills');
    saveConfig(config);
  }

  // Load server module
  const { startServer } = require('./lib/server');
  const server = await startServer(config, cliArgs.port);
  const port = server.address().port;

  console.log(`\n  Claude Code Skill Manager`);
  console.log(`  ─────────────────────────`);
  console.log(`  URL:     http://localhost:${port}`);
  console.log(`  Project: ${config.projectPath || '(not set)'}\n`);

  if (!cliArgs.noBrowser) {
    const url = `http://localhost:${port}`;
    const cmd = process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
    exec(cmd, (err) => {
      if (err) console.log(`  Open ${url} in your browser.`);
    });
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
