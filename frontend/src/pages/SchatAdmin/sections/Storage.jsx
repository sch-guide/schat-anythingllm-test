import { useEffect, useState } from "react";
import Modal, { ModalBody, ModalHeader } from "@/components/lib/Modal";
import SchatAdmin from "@/models/schatAdmin";
import showToast from "@/utils/toast";
import { Badge, Button, Card, InfoRow, Notice } from "../ui";

// "저장공간 정리": 선택 → 삭제 전 미리보기(서버 재검사) → 최종 확인 → 실제 삭제.
// The server re-scans and re-validates before deleting and checks that the
// current documents, pages, vectors, checklists and originals are unchanged
// afterwards. Only items the server marks 삭제 가능 can be selected.

export const STATUS_LABELS = {
  in_use: { text: "사용 중", tone: "ok" },
  old_upload: { text: "삭제 가능", tone: "warning" },
  unlinked: { text: "삭제 가능", tone: "warning" },
  review: { text: "검토 필요", tone: "neutral" },
};

const KIND_LABELS = {
  upload: "예전 업로드",
  image_folder: "연결되지 않은 파일",
  original: "검토 필요",
  unreadable: "검토 필요",
};

export function isSelectable(group) {
  return group.status === "old_upload" || group.status === "unlinked";
}

export function formatBytes(bytes = 0) {
  if (bytes >= 1024 ** 3) return `약 ${(bytes / 1024 ** 3).toFixed(1)}GB`;
  if (bytes >= 1024 ** 2) return `약 ${Math.round(bytes / 1024 ** 2)}MB`;
  if (bytes >= 1024) return `약 ${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

const n = (value) => Number(value || 0).toLocaleString("ko-KR");
const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "확인 불가";

export default function StorageSection() {
  const [report, setReport] = useState(null);
  const [showList, setShowList] = useState(false);
  const [selected, setSelected] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState(null);

  async function load(refresh = false) {
    setReport(null);
    setSelected([]);
    setPreview(null);
    setReport((await SchatAdmin.storageReport({ refresh })) || { error: true });
  }

  async function runDelete() {
    setDeleting(true);
    const outcome = await SchatAdmin.storageDelete(
      selected,
      preview?.previewToken
    );
    setDeleting(false);
    setConfirming(false);
    setResult(outcome);
    if (outcome?.ok) showToast("예전 데이터가 삭제되었습니다.", "success");
    else showToast(outcome?.message || "삭제하지 못했습니다.", "error");
    await load(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function runPreview() {
    setPreviewing(true);
    setPreview((await SchatAdmin.storagePreview(selected)) || { error: true });
    setPreviewing(false);
  }

  if (!report)
    return (
      <p className="text-sm text-theme-text-secondary animate-pulse">
        저장된 파일을 모두 확인하는 중입니다. 처음에는 30초 정도 걸릴 수
        있습니다.
      </p>
    );
  if (report.error)
    return <Notice tone="warning">저장공간 정보를 불러오지 못했습니다.</Notice>;

  const { current, cleanup, descriptionCache } = report.summary;
  const oldUploadIndex = {};
  const titleOf = (group) => {
    if (group.kind !== "upload") return group.title;
    if (group.status === "in_use") return group.title;
    oldUploadIndex[group.title] = (oldUploadIndex[group.title] || 0) + 1;
    return `${group.title} 예전 업로드 ${oldUploadIndex[group.title]}`;
  };
  const rows = report.groups.map((group) => ({
    ...group,
    label: titleOf(group),
  }));

  return (
    <div className="flex flex-col gap-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="현재 사용 중">
          <div>
            <InfoRow label="등록 문서">{n(current.documents)}개</InfoRow>
            <InfoRow label="총 페이지">{n(current.pages)}쪽</InfoRow>
            <InfoRow label="검색 데이터">
              본문 {n(current.bodyVectors)} · 이미지 설명{" "}
              {n(current.imageVectors)}
            </InfoRow>
            <InfoRow label="체크리스트">{n(current.checklists)}개</InfoRow>
          </div>
        </Card>
        <Card title="정리 가능">
          <div>
            <InfoRow label="예전 업로드">{n(cleanup.oldUploads)}건</InfoRow>
            <InfoRow label="연결되지 않은 파일">
              {n(cleanup.unlinked)}건
            </InfoRow>
            <InfoRow label="예전 페이지 기록">
              {n(cleanup.pageRecords)}개
            </InfoRow>
            <InfoRow label="오래된 이미지">
              {formatBytes(cleanup.imageBytes)}
            </InfoRow>
            <InfoRow label="예상 확보 용량">
              {formatBytes(cleanup.totalBytes)}
            </InfoRow>
          </div>
        </Card>
      </div>
      {result && <DeleteResult result={result} />}
      <Notice>
        이 화면은 자동으로 지우지 않습니다. 현재 사용 중인 문서·검색
        데이터·체크리스트·원본 PDF는 선택할 수 없고, 이미지 설명 저장본(
        {n(descriptionCache?.files)}개)은 같은 이미지를 다시 올릴 때 AI 설명을
        다시 만들지 않도록 항상 유지합니다.
      </Notice>
      {!showList ? (
        <div>
          <Button onClick={() => setShowList(true)}>정리 대상 보기</Button>
        </div>
      ) : (
        <Card
          title="정리 대상"
          description="예전 업로드는 한 번 올린 문서 한 벌 단위로 보여 줍니다. 삭제 가능한 항목만 선택할 수 있습니다."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm text-left">
              <thead className="text-xs text-theme-text-secondary border-b border-theme-sidebar-border">
                <tr>
                  <th className="py-2 pr-2 font-medium">
                    <span className="sr-only">선택</span>
                  </th>
                  <th className="py-2 pr-3 font-medium">문서</th>
                  <th className="py-2 pr-3 font-medium">올린 시각</th>
                  <th className="py-2 pr-3 font-medium">페이지</th>
                  <th className="py-2 pr-3 font-medium">이미지</th>
                  <th className="py-2 pr-3 font-medium">기타 용량</th>
                  <th className="py-2 pr-3 font-medium">연결 확인</th>
                  <th className="py-2 font-medium">상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((group) => (
                  <StorageRow
                    key={group.key}
                    group={group}
                    checked={selected.includes(group.key)}
                    onToggle={(checked) => {
                      setPreview(null);
                      setResult(null);
                      setSelected((prev) =>
                        checked
                          ? [...prev, group.key]
                          : prev.filter((k) => k !== group.key)
                      );
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={selected.length === 0 || previewing}
              onClick={runPreview}
            >
              {previewing
                ? "현재 자료와 다시 대조하는 중... (최대 30초)"
                : "선택 항목 확인"}
            </Button>
            <Button variant="secondary" onClick={() => load(true)}>
              새로 고침
            </Button>
          </div>
        </Card>
      )}
      {preview && (
        <Preview
          preview={preview}
          rows={rows}
          onDelete={() => setConfirming(true)}
        />
      )}
      {confirming && preview?.ok && (
        <ConfirmDelete
          preview={preview}
          rows={rows}
          deleting={deleting}
          onCancel={() => !deleting && setConfirming(false)}
          onConfirm={runDelete}
        />
      )}
    </div>
  );
}

function ConfirmDelete({ preview, rows, deleting, onCancel, onConfirm }) {
  const { remove } = preview;
  const labelOf = (key) => rows.find((r) => r.key === key)?.label || "항목";
  return (
    <Modal isOpen onClose={onCancel} size="md">
      <ModalHeader title="예전 데이터를 삭제하시겠습니까?" onClose={onCancel} />
      <ModalBody>
        <div
          className="flex flex-col gap-y-3 text-sm"
          data-testid="storage-delete-confirm"
        >
          <ul className="text-theme-text-primary font-medium">
            {remove.items.map((item) => (
              <li key={item.key}>{labelOf(item.key)}</li>
            ))}
          </ul>
          <div className="text-theme-text-primary">
            <p className="font-semibold">삭제 예정</p>
            <p>- 페이지 기록 {n(remove.pageRecords)}개</p>
            <p>- 이미지 파일 {n(remove.imageFiles)}개</p>
            {remove.originals > 0 && (
              <p>- 예전 원본 PDF {n(remove.originals)}개</p>
            )}
            {remove.auxiliaryFiles > 0 && (
              <p>- 예전 검색 준비 파일 {n(remove.auxiliaryFiles)}개</p>
            )}
            <p>- 예상 확보 용량 {formatBytes(remove.bytes)}</p>
          </div>
          <p className="text-theme-text-secondary">
            현재 사용 중인 SCHAT 문서와 검색 데이터에는 영향이 없는 것으로
            확인되었습니다. 삭제 직전과 직후에 서버가 한 번 더 확인합니다.
          </p>
          <Notice tone="warning">이 작업은 되돌릴 수 없습니다.</Notice>
          {deleting && (
            <p className="text-theme-text-secondary animate-pulse">
              삭제하고 현재 자료를 다시 확인하는 중입니다. 1~2분 정도 걸릴 수
              있습니다.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancel} disabled={deleting}>
              취소
            </Button>
            <Button variant="danger" onClick={onConfirm} disabled={deleting}>
              {deleting ? "삭제 중..." : "삭제"}
            </Button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

function DeleteResult({ result }) {
  if (!result.ok)
    return (
      <Notice tone="warning">
        <p className="font-medium">
          {result.message || "삭제하지 못했습니다."}
        </p>
        {result.changed?.length > 0 && (
          <p>달라진 항목: {result.changed.map((c) => c.field).join(", ")}</p>
        )}
      </Notice>
    );
  return (
    <Notice>
      <p className="font-medium" data-testid="storage-delete-done">
        예전 데이터가 삭제되었습니다.
      </p>
      <p>
        삭제한 파일 {n(result.removedFiles)}개 · 확보 용량{" "}
        {formatBytes(result.freedBytes)}
      </p>
      <p>
        현재 문서 {n(result.after?.documents)}개 · {n(result.after?.pages)}쪽 ·
        본문 검색 데이터 {n(result.after?.bodyVectors)}개 · 이미지 설명 검색
        데이터 {n(result.after?.imageVectors)}개가 그대로인 것을 확인했습니다.
      </p>
    </Notice>
  );
}

function StorageRow({ group, checked, onToggle }) {
  const selectable = isSelectable(group);
  const status = STATUS_LABELS[group.status] || STATUS_LABELS.review;
  const links = [
    group.usage.workspacePages > 0
      ? `작업 공간 ${n(group.usage.workspacePages)}쪽 사용`
      : "작업 공간 미사용",
    group.usage.vectorPages > 0 ||
    group.usage.chromaReferenced ||
    group.usage.imageDescriptionVectors > 0
      ? "검색 데이터 연결됨"
      : "검색 데이터 없음",
    group.usage.checklists > 0
      ? `체크리스트 ${n(group.usage.checklists)}개`
      : "체크리스트 없음",
    group.original.exists
      ? group.original.inUse
        ? "원본 PDF 사용 중"
        : "예전 원본 PDF 있음"
      : "원본 PDF 없음",
  ];
  return (
    <tr className="border-b border-theme-sidebar-border last:border-b-0 align-top">
      <td className="py-2.5 pr-2">
        <input
          type="checkbox"
          aria-label={`${group.label} 선택`}
          className="h-4 w-4 accent-sky-600 disabled:opacity-40"
          disabled={!selectable}
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
        />
      </td>
      <td className="py-2.5 pr-3">
        <p className="font-medium text-theme-text-primary">{group.label}</p>
        <p className="text-xs text-theme-text-secondary">
          {group.status === "in_use"
            ? "현재 사용 중"
            : KIND_LABELS[group.kind] || ""}
        </p>
        {group.reasons?.map((reason) => (
          <p key={reason} className="text-xs text-theme-text-secondary">
            {reason}
          </p>
        ))}
      </td>
      <td className="py-2.5 pr-3 text-theme-text-secondary whitespace-nowrap">
        {when(group.uploadedAt)}
      </td>
      <td className="py-2.5 pr-3 whitespace-nowrap text-theme-text-primary">
        {group.pages ? `${n(group.pages)}쪽` : "-"}
        <p className="text-xs text-theme-text-secondary">
          페이지 기록 {n(group.pageRecords)}개
        </p>
      </td>
      <td className="py-2.5 pr-3 whitespace-nowrap text-theme-text-primary">
        {group.imageFiles ? `${n(group.imageFiles)}개` : "없음"}
        {group.imageFiles > 0 && (
          <p className="text-xs text-theme-text-secondary">
            {formatBytes(group.imageBytes)}
          </p>
        )}
      </td>
      <td className="py-2.5 pr-3 whitespace-nowrap text-theme-text-secondary">
        {formatBytes(group.pageRecordBytes + (group.original?.bytes || 0))}
      </td>
      <td className="py-2.5 pr-3 text-xs text-theme-text-secondary">
        {links.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </td>
      <td className="py-2.5 whitespace-nowrap">
        <Badge tone={status.tone}>
          {group.status === "in_use" ? "사용 중 · 삭제 불가" : status.text}
        </Badge>
      </td>
    </tr>
  );
}

function Preview({ preview, rows, onDelete }) {
  if (preview.error)
    return <Notice tone="warning">미리보기를 만들지 못했습니다.</Notice>;
  const labelOf = (key) => rows.find((r) => r.key === key)?.label || "항목";
  const { remove, keep } = preview;
  return (
    <Card
      title="삭제 전 미리보기"
      description="선택한 항목을 방금 현재 자료와 다시 대조한 결과입니다. 아직 지우지 않았습니다."
      tone={preview.ok ? "default" : "danger"}
    >
      {preview.blocked?.length > 0 && (
        <Notice tone="warning">
          <p className="font-medium mb-1">
            아래 항목 때문에 진행할 수 없습니다.
          </p>
          {preview.blocked.map((item) => (
            <p key={item.key}>
              · {labelOf(item.key)}: {item.reason}
            </p>
          ))}
        </Notice>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-sm font-semibold text-theme-text-primary mb-1">
            삭제 예정
          </p>
          <InfoRow label="선택 항목">{n(remove?.items?.length)}건</InfoRow>
          <InfoRow label="예전 페이지 기록">{n(remove?.pageRecords)}개</InfoRow>
          <InfoRow label="이미지 폴더">{n(remove?.imageFolders)}개</InfoRow>
          <InfoRow label="이미지 파일">{n(remove?.imageFiles)}개</InfoRow>
          <InfoRow label="예전 원본 PDF">{n(remove?.originals)}개</InfoRow>
          <InfoRow label="예전 검색 준비 파일">
            {n(remove?.auxiliaryFiles)}개
          </InfoRow>
          <InfoRow label="예상 확보 용량">{formatBytes(remove?.bytes)}</InfoRow>
        </div>
        <div>
          <p className="text-sm font-semibold text-theme-text-primary mb-1">
            유지
          </p>
          <InfoRow label="현재 문서">{n(keep?.documents)}개</InfoRow>
          <InfoRow label="현재 페이지">{n(keep?.pages)}쪽</InfoRow>
          <InfoRow label="본문 검색 데이터">{n(keep?.bodyVectors)}개</InfoRow>
          <InfoRow label="이미지 설명 검색 데이터">
            {n(keep?.imageVectors)}개
          </InfoRow>
          <InfoRow label="체크리스트">{n(keep?.checklists)}개</InfoRow>
          <InfoRow label="현재 원본 PDF">{n(keep?.originals)}개</InfoRow>
          <InfoRow label="이미지 설명 저장본">
            {n(keep?.descriptionCache?.files)}개
          </InfoRow>
        </div>
      </div>
      {preview.ok && (
        <Notice tone="warning">
          <p className="font-medium mb-1">
            선택한 예전 데이터를 삭제하시겠습니까?
          </p>
          <p>
            삭제 예정: 페이지 기록 {n(remove.pageRecords)}개, 이미지 파일{" "}
            {n(remove.imageFiles)}개, 예상 확보 용량 {formatBytes(remove.bytes)}
          </p>
          <p>
            현재 사용 중인 문서와 검색 데이터에는 영향이 없는 것으로
            확인되었습니다. 이 작업은 되돌릴 수 없습니다.
          </p>
          <div className="flex gap-2 mt-2">
            <Button variant="danger" onClick={onDelete}>
              삭제 진행
            </Button>
          </div>
        </Notice>
      )}
    </Card>
  );
}
