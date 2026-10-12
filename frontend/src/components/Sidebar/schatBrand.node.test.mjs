import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { transformSync } = require("esbuild");

function load(brand) {
  const module = { exports: {} };
  const { code } = transformSync(readFileSync(new URL("./SchatBrand.jsx", import.meta.url), "utf8"), {
    loader: "jsx", format: "cjs", jsx: "automatic",
  });
  vm.runInNewContext(code, {
    module, exports: module.exports, Array, Math, String,
    require: (name) => (name === "@/hooks/useSchatBrand" ? { __esModule: true, default: () => ({ brand }) } : require(name)),
  });
  return module.exports;
}

test("메뉴 맨 위: SCHAT | 간호교육파트, 소속만 파란색", () => {
  const { default: SchatBrand } = load({ affiliation: "간호교육파트" });
  const html = renderToStaticMarkup(React.createElement(SchatBrand));
  assert.match(html, />SCHAT</);
  assert.match(html, /data-testid="schat-brand-divider"/);
  assert.match(html, /text-\[#24549c\][^>]*>간호교육파트</);
  assert.match(html, /max-w-\[220px\]/);
});

test("소속 표시를 비우면 구분선과 함께 숨긴다", () => {
  const { default: SchatBrand } = load({ affiliation: "  " });
  const html = renderToStaticMarkup(React.createElement(SchatBrand));
  assert.match(html, />SCHAT</);
  assert.doesNotMatch(html, /schat-brand-divider|schat-brand-affiliation/);
});

test("긴 소속 표시는 그 글자만 작아지고 SCHAT 크기는 그대로", () => {
  const { affiliationFontSize } = load({});
  assert.equal(affiliationFontSize("간호교육파트"), 13);
  const long = affiliationFontSize("가나다라마바사아자차카타");
  assert.ok(long < 13 && long >= 9);
  assert.ok(long * 12 <= 140);
});
