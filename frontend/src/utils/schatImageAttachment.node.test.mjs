import test from "node:test";
import assert from "node:assert/strict";
import {
  SCHAT_MAX_IMAGE_BYTES,
  validateSchatImageFile,
} from "./schatImageAttachment.js";

function file(type, size = 1024, name = "image.png") {
  return { type, size, name };
}

test("JPG, PNG, WebP 이미지를 한 장 허용한다", () => {
  for (const [type, name] of [
    ["image/jpeg", "a.jpg"],
    ["image/png", "a.png"],
    ["image/webp", "a.webp"],
  ]) {
    assert.deepEqual(validateSchatImageFile(file(type, 1024, name), 0), {
      isImage: true,
      error: null,
    });
  }
});

test("지원하지 않는 이미지, 두 번째 이미지, 5MB 초과 이미지를 거부한다", () => {
  assert.match(
    validateSchatImageFile(file("image/gif", 1024, "a.gif"), 0).error,
    /JPG, PNG, WebP/
  );
  assert.match(
    validateSchatImageFile(file("image/png"), 1).error,
    /1장/
  );
  assert.match(
    validateSchatImageFile(file("image/png", SCHAT_MAX_IMAGE_BYTES + 1), 0)
      .error,
    /5MB/
  );
});

test("기존 비이미지 문서 첨부는 이미지 제한 대상으로 오인하지 않는다", () => {
  assert.deepEqual(
    validateSchatImageFile(file("application/pdf", 1024, "guide.pdf"), 0),
    { isImage: false, error: null }
  );
});
