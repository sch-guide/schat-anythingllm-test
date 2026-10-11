// Opt-in integration test: actual Prisma + disposable SQLite, separate processes.
// Never uses the application's configured storage or calls an external model.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

async function worker() {
  const { PrismaClient } = require(process.env.SCHAT_TEST_PRISMA);
  const dbPath = process.env.SCHAT_TEST_BUDGET_DB;
  if (!dbPath || !path.basename(path.dirname(dbPath)).startsWith('schat-budget-restart-'))
    throw Error('Disposable database required');
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  const modules = new Map();
  const root = path.resolve(__dirname, '../../utils');
  function load(name) {
    if (modules.has(name)) return modules.get(name).exports;
    const module = { exports: {} };
    modules.set(name, module);
    vm.runInNewContext(fs.readFileSync(path.join(root, name + '.js'), 'utf8'), {
      module, exports: module.exports, Date, Map, Set, JSON, Number, Promise,
      require(id) {
        if (id === './prisma') return prisma;
        if (id === '../models/eventLogs') return { EventLogs: { logEvent: async () => {} } };
        if (id.startsWith('./')) return load(id.slice(2));
        throw Error('Unexpected dependency');
      },
    });
    return module.exports;
  }
  try {
    const { saveBudget, loadBudget } = load('geminiBudget');
    const { monitor } = load('geminiAvailability');
    const action = process.env.SCHAT_TEST_BUDGET_ACTION;
    if (action === 'seed') {
      await prisma.$executeRawUnsafe('CREATE TABLE system_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT UNIQUE, value TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, lastUpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)');
      await prisma.$executeRawUnsafe('CREATE TABLE workspace_chats (id INTEGER PRIMARY KEY, response TEXT, createdAt DATETIME)');
      await prisma.$executeRawUnsafe('INSERT INTO workspace_chats (id,response,createdAt) VALUES (?,?,?)', 1,
        JSON.stringify({ metrics: { model: 'gemini-test', prompt_tokens: 80000000, completion_tokens: 0 } }),
        new Date('2026-10-10T00:00:00Z'));
      await saveBudget({ monthlyBudgetKrw: 100000, rates: [{ model: 'gemini-test', inputKrw: 1000, outputKrw: 2000 }] });
    }
    if (action === 'seed' || action === 'repeat') {
      await assert.rejects(monitor.wrap(async () => { throw { status: 429, message: 'daily quota exceeded' }; })());
    }
    if (action === 'recover') await monitor.wrap(async () => ({ choices: [{}] }))();
    const state = await monitor.getState();
    const budget = await loadBudget(new Date('2026-10-10T00:00:00Z'));
    process.stdout.write(JSON.stringify({ state, budget }));
  } finally { await prisma.$disconnect(); }
}

if (process.env.SCHAT_TEST_BUDGET_WORKER === '1') {
  worker().catch(() => { process.stderr.write('Isolated budget worker failed\n'); process.exitCode = 1; });
} else {
  test('budget and exhaustion survive process restart; recovery persists independently of 80 percent estimate',
    { skip: !process.env.SCHAT_TEST_PRISMA }, () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'schat-budget-restart-'));
      function run(action) {
        return JSON.parse(execFileSync(process.execPath, [__filename], {
          env: { ...process.env, SCHAT_TEST_BUDGET_WORKER: '1', SCHAT_TEST_BUDGET_ACTION: action,
            SCHAT_TEST_BUDGET_DB: path.join(directory, 'test.db') }, timeout: 30000,
        }).toString());
      }
      const first = run('seed');
      const restarted = run('read');
      assert.equal(restarted.budget.percent, 80);
      assert.equal(restarted.budget.config.monthlyBudgetKrw, 100000);
      assert.equal(restarted.state.status, 'exhausted');
      assert.equal(restarted.state.persistenceError, false);
      assert.equal(restarted.state.firstOccurredAt, first.state.firstOccurredAt);
      assert.equal(run('repeat').state.firstOccurredAt, first.state.firstOccurredAt);
      run('recover');
      const recovered = run('read');
      assert.equal(recovered.state.status, 'normal');
      assert.equal(recovered.state.firstOccurredAt, null);
      assert.ok(recovered.state.lastSuccessAt);
      assert.equal(recovered.budget.percent, 80);
      // Disposable data stays within OS temp; the caller/container owns cleanup.
    });
}
