const fs = require("fs");
const path = require("path");

const PROMPT_ROOT = path.resolve(__dirname, "../../config/prompts");

/**
 * Reads the limited YAML shape used by SCHAT prompt baselines without adding a
 * runtime dependency. These files are deployment defaults, never DB writers.
 * @param {string} name prompt filename without .yaml
 * @returns {{version:string|null,name:string|null,updatedAt:string|null,reason:string|null,prompt:string}|null}
 */
function loadPromptBaseline(name) {
  if (!/^[a-z0-9-]+$/i.test(String(name || ""))) return null;
  const filePath = path.join(PROMPT_ROOT, `${name}.yaml`);
  try {
    const source = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
    const value = (key) => {
      const match = source.match(new RegExp(`^${key}:\\s*"([^"]*)"\\s*$`, "m"));
      return match?.[1] ?? null;
    };
    const marker = source.match(/^prompt:\s*\|\s*\n/m);
    if (!marker) return null;
    const block = source.slice(marker.index + marker[0].length);
    const lines = block.split("\n");
    if (lines.some((line) => line && !line.startsWith("  "))) return null;
    const prompt = lines.map((line) => line.slice(2)).join("\n").trimEnd();
    if (!prompt) return null;
    return {
      version: value("version"),
      name: value("name"),
      updatedAt: value("updated_at"),
      reason: value("reason"),
      prompt,
    };
  } catch {
    return null;
  }
}

module.exports = { loadPromptBaseline, PROMPT_ROOT };
