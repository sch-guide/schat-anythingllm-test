import { useEffect, useState } from "react";
import GuidelineLibraryAdmin from "@/models/guidelineLibraryAdmin";
import { Button, Card, Field, InfoRow, Notice, inputClass } from "../ui";

/** PDF 쪽별 글자를 읽는다(검색용). 글자가 없는 스캔 쪽은 빈 글자로 둔다. */
export async function readPdfPageTexts(arrayBuffer, onProgress) {
  const { openEvidenceDocument } = await import("@/utils/pdfEvidenceDocument");
  const task = openEvidenceDocument(new Uint8Array(arrayBuffer.slice(0)));
  try {
    const pdf = await task.promise;
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => `${item.str || ""}${item.hasEOL ? "\n" : ""}`)
        .join("")
        .replace(/[ \t]+/g, " ")
        .trim();
      pages.push({ page: number, text });
      onProgress?.(number, pdf.numPages);
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

function date(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString("ko-KR");
}

// 관리자: 지침서 원본 보기의 보기 전용 자료실. 챗봇 답변 검색에는 들어가지 않는다.
export default function GuidelineLibrarySection() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    try {
      setItems(await GuidelineLibraryAdmin.list());
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function upload(event) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      setProgress("PDF 글자를 읽는 중입니다.");
      let pages = [];
      try {
        pages = await readPdfPageTexts(await file.arrayBuffer(), (done, total) =>
          setProgress(`PDF 글자를 읽는 중입니다. (${done}/${total}쪽)`)
        );
      } catch {
        pages = []; // 글자를 못 읽어도 보기는 가능하다(검색만 안 됨).
      }
      setProgress("올리는 중입니다.");
      const item = await GuidelineLibraryAdmin.upload({ file, title: title.trim(), pages });
      setMessage(
        item.textPages
          ? `"${item.title}"을(를) 올렸습니다. ${item.pageCount}쪽 중 ${item.textPages}쪽을 검색할 수 있습니다.`
          : `"${item.title}"을(를) 올렸습니다. 글자를 읽을 수 없는 문서라 검색되지 않고 보기만 됩니다.`
      );
      setFile(null);
      setTitle("");
      event.target.reset?.();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function remove(item) {
    if (!window.confirm(`"${item.title}" 자료를 삭제할까요? 직원 화면에서 바로 사라집니다.`)) return;
    try {
      await GuidelineLibraryAdmin.remove(item.id);
      setMessage(`"${item.title}" 자료를 삭제했습니다.`);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="자료 올리기"
        help={[
          "직원 메뉴 '지침서 원본 보기'에 보이는 보기 전용 PDF예요.",
          "챗봇 답변에는 쓰이지 않아요. 챗봇용 문서(문서 등록)는 원본 보기에 나오지 않으니, 직원에게 보여 줄 원본은 여기에 올려 주세요.",
          "올릴 때 쪽별 글자를 읽어 검색에 써요. 스캔 문서는 보기만 돼요.",
        ]}
      >
        <form onSubmit={upload} className="flex flex-col gap-3">
          <Field label="PDF 파일 (100MB까지)" htmlFor="guideline-library-file">
            <input
              id="guideline-library-file"
              type="file"
              accept="application/pdf,.pdf"
              disabled={busy}
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              className="text-sm text-theme-text-primary"
            />
          </Field>
          <Field label="직원에게 보일 이름 (비우면 파일 이름)" htmlFor="guideline-library-title">
            <input
              id="guideline-library-title"
              className={inputClass}
              maxLength={120}
              value={title}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="예: 인터벤션 시술 처방 모음"
            />
          </Field>
          <div>
            <Button type="submit" disabled={!file || busy}>
              {busy ? "올리는 중" : "올리기"}
            </Button>
          </div>
          {progress && <p role="status" className="text-sm text-theme-text-secondary">{progress}</p>}
        </form>
      </Card>
      {message && <Notice>{message}</Notice>}
      {error && <Notice tone="warning">{error}</Notice>}
      <Card title="올린 자료" help={["직원 '지침서 원본 보기'에는 여기 있는 자료만 보여요.", "삭제하면 직원 화면에서 바로 사라져요."]}>
        {!items ? (
          <p role="status" className="text-sm text-theme-text-secondary">자료 목록을 불러오는 중입니다.</p>
        ) : !items.length ? (
          <p className="text-sm text-theme-text-secondary">올린 자료가 없습니다.</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center gap-3 border-t border-theme-sidebar-border pt-3 first:border-t-0 first:pt-0">
              <div className="min-w-0 flex-1">
                <InfoRow label={item.title}>
                  {`${item.pageCount}쪽 · 검색 ${item.textPages}쪽 · ${date(item.uploadedAt)}`}
                </InfoRow>
              </div>
              <Button variant="danger" onClick={() => remove(item)}>
                삭제
              </Button>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
