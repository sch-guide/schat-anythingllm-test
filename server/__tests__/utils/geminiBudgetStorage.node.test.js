const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
test("monthly budget reads only responses in Korean month and saves only budget settings", async () => {
  const settings = new Map();
  const queries = [];
  let reads = 0;
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../../utils/geminiBudget.js"),
      "utf8"
    ),
    {
      module,
      Date,
      Map,
      Set,
      JSON,
      Number,
      require: (name) => {
        if (name === "./geminiSettings")
          return {
            readSetting: async (key) => settings.get(key),
            writeSetting: async (key, value) => settings.set(key, value),
          };
        if (name === "./prisma")
          return {
            workspace_chats: {
              findMany: async (query) => {
                reads++;
                queries.push(query);
                return [
                  {
                    response: JSON.stringify({
                      metrics: {
                        model: "gemini-test",
                        prompt_tokens: 80000000,
                        completion_tokens: 0,
                      },
                    }),
                  },
                ];
              },
            },
          };
        throw Error(name);
      },
    }
  );
  const { loadBudget, saveBudget } = module.exports;
  const when = new Date("2026-10-10T00:00:00Z");
  assert.equal((await loadBudget(when)).percent, null);
  await saveBudget({
    monthlyBudgetKrw: 100000,
    rates: [{ model: "gemini-test", inputKrw: 1000, outputKrw: 2000 }],
  });
  assert.equal((await loadBudget(when)).percent, 80);
  assert.equal((await loadBudget(when)).percent, 80);
  assert.equal(reads, 2);
  assert.deepEqual([...settings.keys()], ["schat_gemini_budget"]);
  assert.equal(
    queries[0].where.createdAt.gte.toISOString(),
    "2026-09-30T15:00:00.000Z"
  );
  assert.equal(
    queries[0].where.createdAt.lt.toISOString(),
    "2026-10-31T15:00:00.000Z"
  );
  assert.deepEqual(Object.keys(queries[0].select), ["response"]);
});
