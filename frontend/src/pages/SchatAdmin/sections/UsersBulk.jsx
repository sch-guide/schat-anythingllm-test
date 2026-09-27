import { useRef, useState } from "react";
import SchatAccount from "@/models/schatAccount";
import showToast from "@/utils/toast";
import { Badge, Button, Card, Notice } from "../ui";

function saveFile(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

// Built in the browser from the response: who was registered. There are no
// passwords to hand out; employees set their own at first login.
export function resultCsv(accounts = []) {
  const lines = [
    ["부서", "사번", "이름", "권한"],
    ...accounts.map((a) => [a.department, a.employeeNumber, a.name, a.role]),
  ].map((row) => row.map(csvCell).join(","));
  const BOM = String.fromCharCode(0xfeff); // lets Excel read UTF-8 Korean
  const CRLF = String.fromCharCode(13, 10);
  return BOM + lines.join(CRLF) + CRLF;
}

// 직원 일괄등록: upload -> 등록 전 확인 -> 정상 행만 등록. New accounts only;
// existing employee numbers are reported and never overwritten.
export default function BulkImport({ onDone }) {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState(null);
  const [checking, setChecking] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState(null);

  async function downloadTemplate() {
    const blob = await SchatAccount.downloadTemplate();
    if (!blob) return showToast("양식을 내려받지 못했습니다.", "error");
    saveFile(blob, "SCHAT_직원_일괄등록_양식.xlsx");
  }

  async function check(file) {
    if (!file) return;
    setResult(null);
    setPreview(null);
    setFileName(file.name);
    setChecking(true);
    const response = await SchatAccount.bulkPreview(file);
    setChecking(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!response.success)
      return showToast(
        response.error || "파일을 확인하지 못했습니다.",
        "error"
      );
    setPreview(response);
  }

  async function cancel() {
    if (preview?.token) await SchatAccount.bulkCancel(preview.token);
    setPreview(null);
    setFileName("");
  }

  async function commit() {
    if (!preview?.token || committing) return;
    setCommitting(true);
    const response = await SchatAccount.bulkCommit(preview.token);
    setCommitting(false);
    setPreview(null);
    if (!response.success)
      return showToast(response.error || "등록하지 못했습니다.", "error");
    setResult(response);
    onDone?.();
  }

  return (
    <Card
      title="직원 일괄등록"
      description="양식에 부서·사번·이름·권한을 적어 올리면 먼저 확인 결과를 보여 줍니다. 등록 버튼을 눌러야 계정이 만들어집니다. 비밀번호는 양식에 넣지 않고, 직원이 처음 로그인할 때 직접 정합니다."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={downloadTemplate}>
          일괄등록 양식 다운로드
        </Button>
        <label className="schat-admin-button schat-admin-button--primary inline-flex items-center rounded-lg px-3.5 py-2 text-sm font-medium cursor-pointer">
          {checking ? "확인 중..." : "파일 올리기 (xlsx, csv)"}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv"
            className="sr-only"
            disabled={checking || committing}
            onChange={(e) => check(e.target.files?.[0])}
          />
        </label>
        {fileName && (
          <span className="text-xs text-theme-text-secondary">{fileName}</span>
        )}
      </div>

      {preview && (
        <div className="flex flex-col gap-y-3" data-testid="bulk-preview">
          <p className="text-sm font-semibold text-theme-text-primary">
            등록 전 확인
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge>총 {preview.total}명</Badge>
            <Badge tone="ok">정상 {preview.validCount}명</Badge>
            <Badge tone="warning">오류 {preview.errorCount}명</Badge>
          </div>
          {preview.errors.length > 0 && (
            <div className="overflow-x-auto max-h-[260px]">
              <table className="w-full min-w-[560px] text-sm text-left">
                <thead className="text-xs text-theme-text-secondary border-b border-theme-sidebar-border">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">행</th>
                    <th className="py-1.5 pr-3 font-medium">사번</th>
                    <th className="py-1.5 pr-3 font-medium">이름</th>
                    <th className="py-1.5 pr-3 font-medium">상태</th>
                    <th className="py-1.5 font-medium">사유</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.errors.map((e) => (
                    <tr
                      key={e.line}
                      className="border-b border-theme-sidebar-border last:border-b-0"
                    >
                      <td className="py-1.5 pr-3">{e.line}행</td>
                      <td className="py-1.5 pr-3">{e.employeeNumber || "-"}</td>
                      <td className="py-1.5 pr-3">{e.name || "-"}</td>
                      <td className="py-1.5 pr-3">{e.status}</td>
                      <td className="py-1.5 text-theme-text-secondary">
                        {e.reasons.join(" ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.valid.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm text-theme-text-primary">
                정상 {preview.validCount}명 보기
              </summary>
              <ul className="mt-2 max-h-[200px] overflow-y-auto text-xs text-theme-text-secondary">
                {preview.valid.map((v) => (
                  <li key={v.line}>
                    {v.line}행 · {v.department} · {v.employeeNumber} · {v.name}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {committing && (
            <p className="text-sm text-theme-text-secondary animate-pulse">
              직원 계정을 등록하고 있습니다…
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" disabled={committing} onClick={cancel}>
              취소
            </Button>
            <Button disabled={!preview.token || committing} onClick={commit}>
              정상 {preview.validCount}명 등록
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-y-3" data-testid="bulk-result">
          <p className="text-sm font-semibold text-theme-text-primary">
            {result.createdCount}명의 계정이 생성되었습니다.
          </p>
          {result.skipped?.length > 0 && (
            <Notice tone="warning">
              {result.skipped.length}명은 등록 직전 확인에서 제외되었습니다(그
              사이 같은 사번이 등록되었거나 부서가 사용중지됨).
            </Notice>
          )}
          <Notice>
            직원은 로그인 화면에서 부서·사번·이름을 입력하고 비밀번호를 비워 둔
            채 로그인을 누르면, 처음 로그인 화면에서 비밀번호를 직접 정합니다.
          </Notice>
          <div className="flex gap-2">
            <Button
              onClick={() =>
                saveFile(
                  new Blob([resultCsv(result.accounts)], {
                    type: "text/csv;charset=utf-8",
                  }),
                  `SCHAT_직원등록결과_${new Date().toISOString().slice(0, 10)}.csv`
                )
              }
            >
              등록 결과 다운로드
            </Button>
            <Button variant="secondary" onClick={() => setResult(null)}>
              닫기
            </Button>
          </div>
          <div className="overflow-x-auto max-h-[260px]">
            <table className="w-full min-w-[520px] text-sm text-left">
              <thead className="text-xs text-theme-text-secondary border-b border-theme-sidebar-border">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">부서</th>
                  <th className="py-1.5 pr-3 font-medium">사번</th>
                  <th className="py-1.5 pr-3 font-medium">이름</th>
                  <th className="py-1.5 font-medium">권한</th>
                </tr>
              </thead>
              <tbody>
                {result.accounts.map((a) => (
                  <tr
                    key={a.employeeNumber}
                    className="border-b border-theme-sidebar-border last:border-b-0"
                  >
                    <td className="py-1.5 pr-3">{a.department}</td>
                    <td className="py-1.5 pr-3">{a.employeeNumber}</td>
                    <td className="py-1.5 pr-3">{a.name}</td>
                    <td className="py-1.5">{a.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
