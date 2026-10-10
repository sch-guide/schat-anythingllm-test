import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

async function loadAgentHandler() {
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "schat-agent-status-")
  );
  const outputFile = path.join(outputDirectory, "fixture.cjs");
  await build({
    stdin: {
      contents: `export { default as handleSocketResponse } from "./src/utils/chat/agent.js"; export { default as handleChat } from "./src/utils/chat/index.js";`,
      resolveDir: frontendRoot,
      loader: "js",
    },
    outfile: outputFile,
    bundle: true,
    platform: "node",
    format: "cjs",
    define: { "import.meta.env.VITE_API_BASE": '"/api"' },
    banner: {
      js: `
        globalThis.window = {
          location: { protocol: "http:", host: "localhost" },
          dispatchEvent: () => {},
        };
        globalThis.localStorage = {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
      `,
    },
    nodePaths: [path.join(frontendRoot, "node_modules")],
    plugins: [
      {
        name: "schat-alias",
        setup(buildApi) {
          buildApi.onResolve({ filter: /^@\// }, (args) => {
            const base = path.join(frontendRoot, "src", args.path.slice(2));
            const resolved = [
              `${base}.js`,
              `${base}.jsx`,
              path.join(base, "index.js"),
              path.join(base, "index.jsx"),
              base,
            ].find((candidate) => existsSync(candidate));
            return { path: resolved || base };
          });
        },
      },
    ],
  });
  return import(pathToFileURL(outputFile));
}

test("the first answer chunk replaces an internal status with the answer", async () => {
  const { handleSocketResponse } = await loadAgentHandler();
  const socket = { supportsAgentStreaming: true };
  let history = [];
  const setHistory = (update) => {
    history = typeof update === "function" ? update(history) : update;
  };
  const event = (content) => ({
    data: JSON.stringify({ type: "reportStreamEvent", content }),
  });

  handleSocketResponse(
    socket,
    event({
      type: "statusResponse",
      uuid: "answer-1",
      content: "undefined: Found 2 additional piece of context",
    }),
    setHistory
  );
  handleSocketResponse(
    socket,
    event({
      type: "textResponseChunk",
      uuid: "answer-1",
      content: "직원에게 보여줄 답변",
    }),
    setHistory
  );

  assert.equal(history.length, 1);
  assert.equal(history[0].type, "textResponse");
  assert.equal(history[0].content, "직원에게 보여줄 답변");
  assert.doesNotMatch(history[0].content, /undefined|Found|context/);
});

test("HTTP queue keeps working state and final chat id belongs to the question", async () => {
  const { handleChat } = await loadAgentHandler();
  const history = [{role:'user',content:'synthetic'}];
  let visible = history;
  let loading = false;
  const receive = data => handleChat(data, value=>loading=value, value=>visible=value, [history[0]], history, ()=>{});
  receive({type:'admissionStatus',position:2});
  receive({type:'admissionStatus',position:0});
  assert.equal(loading,true);
  assert.equal(visible.at(-1).animate,true);
  receive({type:'textResponseChunk',uuid:'answer',textResponse:'reply',close:false});
  receive({type:'finalizeResponseStream',uuid:'answer',chatId:42,close:true});
  assert.equal(visible[0].chatId,42);
  assert.equal(loading,false);
});
