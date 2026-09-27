import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");
const bytes = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url));

test("login screen uses the shared blue SCH logo on both sides and no welcome heading", () => {
  const modal = src("../Modals/Password/index.jsx");
  assert.equal((modal.match(/<SchLogo /g) || []).length, 2);
  assert.match(modal, /순천향대학교 부속 천안병원/);
  assert.match(modal, /<span>병원 실무지침 AI<\/span>/);
  assert.doesNotMatch(modal, /useLogo|loginLogo|>SCH</);
  for (const form of [
    "../Modals/Password/MultiUserAuth.jsx",
    "../Modals/Password/SingleUserAuth.jsx",
  ]) {
    const body = src(form);
    assert.doesNotMatch(body, /login\.multi-user\.welcome/);
    assert.match(body, /login\.sign-in/);
  }
});

test("shared logo component points at the single SCH asset", () => {
  const component = src("./index.jsx");
  assert.match(component, /@\/media\/logo\/sch-logo\.png/);
  const png = bytes("../../media/logo/sch-logo.png");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 188);
  assert.equal(png.readUInt32BE(20), 68);
});

test("browser tab icons are square SCH icons, not the AnythingLLM default", () => {
  const favicon = bytes("../../../public/favicon.png");
  assert.equal(favicon.subarray(1, 4).toString(), "PNG");
  assert.equal(favicon.readUInt32BE(16), favicon.readUInt32BE(20));
  assert.notEqual(favicon.length, 0);
  const ico = bytes("../../../public/favicon.ico");
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) >= 1);
  // every ICO entry embeds a PNG image
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const offset = ico.readUInt32LE(6 + i * 16 + 12);
    assert.equal(ico.subarray(offset + 1, offset + 4).toString(), "PNG");
  }
});

test("login logos are only ever shrunk (<=34px tall keeps 2x screens at native pixels)", () => {
  const css = src("../../schat-brand.css");
  for (const cls of ["schat-login__mark", "schat-login__product-mark"]) {
    const blocks = [
      ...css.matchAll(new RegExp(String.raw`\.${cls}\s*\{([^}]*)\}`, "g")),
    ];
    assert.ok(blocks.length >= 1, cls);
    for (const [, body] of blocks) {
      const height = Number((body.match(/height:\s*(\d+)px/) || [])[1]);
      assert.ok(height > 0 && height <= 34, `${cls} height ${height}`);
      assert.doesNotMatch(body, /transform|scale\(/);
    }
  }
  const favicon = bytes("../../../public/favicon.png");
  assert.equal(favicon.readUInt32BE(16), 128);
});

test("edge columns of the provided image are hidden by CSS only, without scaling up", () => {
  const css = src("../../schat-brand.css");
  const component = src("./index.jsx");
  const block = css.match(/\.sch-logo\s*\{([^}]*)\}/)[1];
  assert.match(block, /aspect-ratio:\s*185\s*\/\s*68/);
  assert.match(block, /object-fit:\s*cover/);
  assert.match(block, /object-position:\s*33\.333% 50%/);
  assert.match(component, /sch-logo \$\{className\}/);
  const png = bytes("../../media/logo/sch-logo.png");
  assert.equal(png.readUInt32BE(16), 188, "source file is not modified");
});
