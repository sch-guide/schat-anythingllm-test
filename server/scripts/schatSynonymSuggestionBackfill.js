// 이미 등록된 문서에서 동의어 후보를 한 번 만든다("한 번 실행").
// Reads stored page JSON only: no re-embedding, no vector or BM25 changes.
// Candidates go to 동의어 관리 > 검토 필요 only; nothing becomes 사용.
// Documents are processed one at a time; rate limits are retried (max 3).
//
// Usage (inside the schat-web container, from /app/server):
//   node scripts/schatSynonymSuggestionBackfill.js            실제 실행
//   node scripts/schatSynonymSuggestionBackfill.js --test     검증용 실행(나중에 통째로 지울 수 있음)
//   node scripts/schatSynonymSuggestionBackfill.js --dry-run  저장 없이 결과만 보기
//   node scripts/schatSynonymSuggestionBackfill.js --remove-test-run <번호>
// Prints document names, counts and status only - never page text.
const Suggestions = require("../utils/synonyms/suggestions");

function option(name) {
  return process.argv.includes(name);
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function printRow(row) {
  const status = Suggestions.DOCUMENT_STATUS[row.status] || row.status;
  console.log(
    [
      row.documentName,
      `${row.pages}쪽`,
      `후보 ${row.candidates}`,
      `신규 ${row.newGroups}`,
      `추가 ${row.additions}`,
      `중복 ${row.duplicates}`,
      `제외 ${row.excluded}`,
      `호출 ${row.geminiCalls}`,
      `재시도 ${row.retries}`,
      status + (row.error ? `(${row.error})` : ""),
    ].join(" | ")
  );
}

async function main() {
  const removeId = optionValue("--remove-test-run");
  if (removeId) {
    const removed = await Suggestions.removeTestRun(removeId);
    console.log(
      `검증용 실행 ${removeId} 삭제: 묶음 ${removed.groups}개, 후보 기록 ${removed.suggestions}개`
    );
    return;
  }
  const test = option("--test");
  const dryRun = option("--dry-run");
  const loaded = await Suggestions.loadDocuments(
    await Suggestions.registeredDocuments()
  );
  console.log(
    `대상 문서 ${loaded.length}개${test ? " (검증용)" : ""}${dryRun ? " (저장 안 함)" : ""}`
  );
  const result = await Suggestions.suggestForDocuments(loaded, {
    trigger: "backfill",
    test,
    dryRun,
    onDocument: printRow,
  });
  const { rows, failedDocuments, ...summary } = result;
  console.log(JSON.stringify(summary));
  if (failedDocuments.length)
    console.log("실패 문서:", JSON.stringify(failedDocuments));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[SchatSynonymSuggestionBackfill]", error.message);
    process.exit(1);
  });
