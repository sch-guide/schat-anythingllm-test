// 2026-11-09: 휴대폰에서 원본 PDF를 새 창에서 열기(누르는 순간 빈 창을 먼저 연다).
import test from "node:test";
import assert from "node:assert/strict";
import { openPdfInNewWindow, pdfPageUrl } from "./openPdfWindow.js";

function fakeWindow({ blocked = false } = {}) {
  const opened = { location: { href: "" }, document: { body: {} }, closed: false, close() { this.closed = true; } };
  return {
    opened,
    open: () => (blocked ? null : opened),
    URL: { createObjectURL: () => "blob:fake" },
  };
}

test("빈 창을 먼저 열고 받아 온 PDF를 고른 쪽부터 띄운다", async () => {
  const win = fakeWindow();
  const ok = await openPdfInNewWindow(async () => new Blob(["%PDF"], { type: "application/pdf" }), 307, win);
  assert.equal(ok, true);
  assert.equal(win.opened.location.href, "blob:fake#page=307");
  assert.equal(pdfPageUrl("blob:x", "x"), "blob:x#page=1");
});

test("팝업이 막히거나 PDF를 못 받으면 false, 열어 둔 빈 창은 닫는다", async () => {
  assert.equal(await openPdfInNewWindow(async () => new Blob(["x"]), 1, fakeWindow({ blocked: true })), false);
  const win = fakeWindow();
  assert.equal(await openPdfInNewWindow(async () => { throw new Error("x"); }, 1, win), false);
  assert.equal(win.opened.closed, true);
  const html = fakeWindow();
  assert.equal(await openPdfInNewWindow(async () => new Blob(["<html>"], { type: "text/html" }), 1, html), false);
});
