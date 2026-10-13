import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quiz = readFileSync(
  new URL("./sections/Quiz.jsx", import.meta.url),
  "utf8"
);

test("문제 생성 입력값은 상위에서 보관해 탭을 오가도 같은 문서·주제가 남음", () => {
  assert.match(quiz, /useState\(EMPTY_GENERATE_FORM\)/);
  assert.match(quiz, /form=\{generateForm\}\s*setForm=\{setGenerateForm\}/);
  assert.match(
    quiz,
    /function Generate\(\{ form, setForm, onDone, onFailed \}\)/
  );
  // Generate 안에서 입력값을 새로 만들지 않음
  const generate = quiz.slice(
    quiz.indexOf("function Generate("),
    quiz.indexOf("function QuestionList")
  );
  assert.doesNotMatch(generate, /useState\(\{\s*docKey/);
});

test("저장된 문서가 목록에 없을 때만 첫 문서로 바꿈", () => {
  const body = quiz.slice(
    quiz.indexOf("export function keepDocKey"),
    quiz.indexOf("function Generate(")
  );
  const keepDocKey = new Function(
    `${body.replace("export ", "")}; return keepDocKey;`
  )();
  const docs = [{ docKey: "a" }, { docKey: "b" }];
  assert.equal(keepDocKey("b", docs), "b");
  assert.equal(keepDocKey("old", docs), "a");
  assert.equal(keepDocKey("", docs), "a");
  assert.equal(keepDocKey("b", []), "");
});
