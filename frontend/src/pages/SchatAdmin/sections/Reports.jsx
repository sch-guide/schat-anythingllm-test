import { useCallback, useEffect, useState } from "react";
import SchatAccount from "@/models/schatAccount";
import showToast from "@/utils/toast";
import {
  Badge,
  Button,
  Card,
  Field,
  InfoRow,
  Loading,
  inputClass,
} from "../ui";

const STATUS = { open: "미처리", in_progress: "처리중", resolved: "완료" };
const TONES = { open: "neutral", in_progress: "warning", resolved: "ok" };
const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "-";

export default function ReportsSection() {
  const [tab, setTab] = useState("list");
  const [faqDraft, setFaqDraft] = useState(null);
  return (
    <div className="flex flex-col gap-y-5">
      <div className="flex flex-wrap gap-2" role="tablist">
        {[
          ["list", "신고 목록"],
          ["stats", "통계"],
          ["faq", "FAQ 관리"],
        ].map(([key, label]) => (
          <Button
            key={key}
            role="tab"
            aria-selected={tab === key}
            variant={tab === key ? "primary" : "secondary"}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>
      {tab === "list" && (
        <ReportList
          onMakeFaq={(report) => {
            setFaqDraft({
              title: report.title,
              category: report.category,
              keywords: "",
              problem: report.content,
              solution: report.resolution || "",
              active: false,
              sourceReportId: report.id,
            });
            setTab("faq");
          }}
        />
      )}
      {tab === "stats" && <Stats />}
      {tab === "faq" && (
        <FaqManager draft={faqDraft} onDraftUsed={() => setFaqDraft(null)} />
      )}
    </div>
  );
}

function ReportList({ onMakeFaq }) {
  const [filters, setFilters] = useState({
    q: "",
    department: "",
    category: "",
    status: "",
    from: "",
    to: "",
  });
  const [reports, setReports] = useState(null);
  const [categories, setCategories] = useState([]);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    const result = await SchatAccount.reports(filters);
    setReports(result?.reports || []);
  }, [filters]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    SchatAccount.reportCategories().then((r) =>
      setCategories(r?.categories || [])
    );
  }, []);

  const departments = [
    ...new Set((reports || []).map((r) => r.department).filter(Boolean)),
  ];
  const set = (key) => (e) =>
    setFilters((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <Card
      title="신고 목록"
      description="직원이 보낸 문제 신고입니다. 상태를 바꾸면 신고한 직원에게만 알림이 갑니다."
    >
      <div className="grid gap-3 md:grid-cols-3">
        <input
          aria-label="검색"
          placeholder="제목·내용·이름·사번 검색"
          className={inputClass}
          value={filters.q}
          onChange={set("q")}
        />
        <select
          aria-label="부서 필터"
          className={inputClass}
          value={filters.department}
          onChange={set("department")}
        >
          <option value="">전체 부서</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          aria-label="종류 필터"
          className={inputClass}
          value={filters.category}
          onChange={set("category")}
        >
          <option value="">전체 종류</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          aria-label="상태 필터"
          className={inputClass}
          value={filters.status}
          onChange={set("status")}
        >
          <option value="">전체 상태</option>
          {Object.entries(STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input
          aria-label="시작일"
          type="date"
          className={inputClass}
          value={filters.from}
          onChange={set("from")}
        />
        <input
          aria-label="종료일"
          type="date"
          className={inputClass}
          value={filters.to}
          onChange={set("to")}
        />
      </div>
      {!reports ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm text-left">
            <thead className="text-xs text-theme-text-secondary border-b border-theme-sidebar-border">
              <tr>
                <th className="py-2 pr-3 font-medium">번호</th>
                <th className="py-2 pr-3 font-medium">제목</th>
                <th className="py-2 pr-3 font-medium">종류</th>
                <th className="py-2 pr-3 font-medium">신고자</th>
                <th className="py-2 pr-3 font-medium">사번</th>
                <th className="py-2 pr-3 font-medium">부서</th>
                <th className="py-2 pr-3 font-medium">등록일</th>
                <th className="py-2 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-theme-text-secondary">
                    신고가 없습니다.
                  </td>
                </tr>
              )}
              {reports.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className={`cursor-pointer border-b border-theme-sidebar-border last:border-b-0 hover:bg-theme-sidebar-item-hover ${selected?.id === r.id ? "bg-theme-sidebar-item-hover" : ""}`}
                >
                  <td className="py-2 pr-3">{r.id}</td>
                  <td className="py-2 pr-3 text-theme-text-primary font-medium">
                    {r.title}
                  </td>
                  <td className="py-2 pr-3">{r.category}</td>
                  <td className="py-2 pr-3">
                    {r.reporterName}
                    {r.reporterDeleted && (
                      <span className="block text-xs text-theme-text-secondary">
                        (삭제된 사용자)
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">{r.employeeNumber || "-"}</td>
                  <td className="py-2 pr-3">{r.department || "-"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {when(r.createdAt)}
                  </td>
                  <td className="py-2">
                    <Badge tone={TONES[r.status]}>{r.statusLabel}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <ReportDetail
          key={selected.id}
          report={selected}
          onSaved={(report) => {
            setSelected(report);
            load();
          }}
          onMakeFaq={onMakeFaq}
        />
      )}
    </Card>
  );
}

function ReportDetail({ report, onSaved, onMakeFaq }) {
  const [status, setStatus] = useState(report.status);
  const [resolution, setResolution] = useState(report.resolution || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const result = await SchatAccount.updateReport(report.id, {
      status,
      resolution,
    });
    setSaving(false);
    if (!result.success)
      return showToast(result.error || "저장하지 못했습니다.", "error");
    showToast("신고 상태를 저장했습니다.", "success");
    onSaved(result.report);
  }

  return (
    <div
      className="rounded-lg border border-theme-sidebar-border p-4 flex flex-col gap-y-3"
      data-testid="report-detail"
    >
      <div>
        <p className="text-base font-semibold text-theme-text-primary">
          #{report.id} {report.title}
        </p>
        <p className="text-xs text-theme-text-secondary">
          {report.reporterName}
          {report.reporterDeleted ? " (삭제된 사용자)" : ""} ·{" "}
          {report.employeeNumber || "사번 없음"} ·{" "}
          {report.department || "부서 없음"} · {when(report.createdAt)}
        </p>
      </div>
      <InfoRow label="문제 종류">{report.category}</InfoRow>
      {report.relatedFeature && (
        <InfoRow label="관련 기능">{report.relatedFeature}</InfoRow>
      )}
      {report.relatedFaqTitle && (
        <InfoRow label="관련 이용 가이드">{report.relatedFaqTitle}</InfoRow>
      )}
      <p className="text-sm whitespace-pre-wrap text-theme-text-primary">
        {report.content}
      </p>
      <Field label="상태" htmlFor="schat-report-status">
        <select
          id="schat-report-status"
          className={`${inputClass} max-w-[200px]`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {Object.entries(STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="처리 결과"
        htmlFor="schat-report-resolution"
        help="완료로 바꾸려면 처리 결과가 필요합니다. 직원의 내 신고와 알림에 표시됩니다."
      >
        <textarea
          id="schat-report-resolution"
          rows={4}
          maxLength={3000}
          className={`${inputClass} resize-y`}
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? "저장 중..." : "저장"}
        </Button>
        {report.status === "resolved" && (
          <Button variant="secondary" onClick={() => onMakeFaq(report)}>
            FAQ로 등록
          </Button>
        )}
      </div>
    </div>
  );
}

function Stats() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    SchatAccount.reportStats().then((s) =>
      setStats(s?.ok ? s : { error: true })
    );
  }, []);
  if (!stats) return <Loading />;
  if (stats.error)
    return (
      <p className="text-sm text-theme-text-secondary">
        통계를 불러오지 못했습니다.
      </p>
    );
  const list = (obj) =>
    Object.entries(obj || {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => (
        <InfoRow key={k} label={k}>
          {v}건
        </InfoRow>
      ));
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="전체 현황">
        <div>
          <InfoRow label="전체 신고">{stats.total}건</InfoRow>
          <InfoRow label="미처리">{stats.byStatus.open || 0}건</InfoRow>
          <InfoRow label="처리중">{stats.byStatus.in_progress || 0}건</InfoRow>
          <InfoRow label="완료">{stats.byStatus.resolved || 0}건</InfoRow>
          <InfoRow label="최근 7일">{stats.recent7}건</InfoRow>
          <InfoRow label="최근 30일">{stats.recent30}건</InfoRow>
          <InfoRow label="평균 처리시간">
            {stats.averageResolutionHours === null
              ? "-"
              : `${stats.averageResolutionHours}시간`}
          </InfoRow>
        </div>
      </Card>
      <Card title="문제 종류별">
        <div>{list(stats.byCategory)}</div>
      </Card>
      <Card
        title="부서별 신고"
        description="신고 당시 부서 기준입니다. 직원 개인별 순위는 만들지 않습니다."
      >
        <div>{list(stats.byDepartment)}</div>
      </Card>
    </div>
  );
}

function FaqManager({ draft, onDraftUsed }) {
  const [faqs, setFaqs] = useState(null);
  const [form, setForm] = useState(null);
  const [categories, setCategories] = useState([]);
  useEffect(() => {
    SchatAccount.reportCategories().then((r) =>
      setCategories(r?.categories || [])
    );
  }, []);

  const load = useCallback(async () => {
    const result = await SchatAccount.faqs();
    setFaqs(result?.faqs || []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (draft) {
      setForm(draft);
      onDraftUsed();
    }
  }, [draft, onDraftUsed]);

  async function save(e) {
    e.preventDefault();
    const result = form.id
      ? await SchatAccount.updateFaq(form.id, form)
      : await SchatAccount.createFaq(form);
    if (!result.success)
      return showToast(result.error || "저장하지 못했습니다.", "error");
    showToast("FAQ를 저장했습니다.", "success");
    setForm(null);
    load();
  }

  const set = (key) => (e) =>
    setForm((prev) => ({
      ...prev,
      [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  return (
    <Card
      title="FAQ 관리"
      description="직원에게 보이기(승인)한 FAQ는 저장 즉시 직원 화면의 이용 가이드와 문제 신고의 관련 도움말에 나옵니다. 키워드는 쉼표로 구분합니다. 조회·도움 수는 가이드 개선용이며 누가 눌렀는지는 기록하지 않습니다."
    >
      {form ? (
        <form onSubmit={save} className="flex flex-col gap-y-3">
          <Field label="제목" htmlFor="schat-faq-title">
            <input
              id="schat-faq-title"
              required
              className={inputClass}
              value={form.title}
              onChange={set("title")}
            />
          </Field>
          <Field
            label="분류"
            htmlFor="schat-faq-category"
            help="직원 이용 가이드의 분류 버튼으로 쓰입니다. 문제 신고 종류와 같습니다."
          >
            <select
              id="schat-faq-category"
              className={inputClass}
              value={form.category || ""}
              onChange={set("category")}
            >
              <option value="">기타</option>
              {categories
                .filter((c) => c !== "기타")
                .map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              {form.category && !categories.includes(form.category) && (
                <option value={form.category}>{form.category}</option>
              )}
            </select>
          </Field>
          <Field label="키워드" htmlFor="schat-faq-keywords">
            <input
              id="schat-faq-keywords"
              placeholder="예: 체크리스트, 팝업"
              className={inputClass}
              value={form.keywords || ""}
              onChange={set("keywords")}
            />
          </Field>
          <Field label="문제 상황" htmlFor="schat-faq-problem">
            <textarea
              id="schat-faq-problem"
              rows={3}
              className={`${inputClass} resize-y`}
              value={form.problem || ""}
              onChange={set("problem")}
            />
          </Field>
          <Field label="해결 방법" htmlFor="schat-faq-solution">
            <textarea
              id="schat-faq-solution"
              required
              rows={4}
              className={`${inputClass} resize-y`}
              value={form.solution || ""}
              onChange={set("solution")}
            />
          </Field>
          <label className="inline-flex items-center gap-x-2 text-sm text-theme-text-primary">
            <input
              type="checkbox"
              className="h-4 w-4 accent-sky-600"
              checked={!!form.active}
              onChange={set("active")}
            />
            직원에게 보이기(승인)
          </label>
          <div className="flex gap-2">
            <Button type="submit">저장</Button>
            <Button variant="secondary" onClick={() => setForm(null)}>
              취소
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button
            onClick={() =>
              setForm({
                title: "",
                category: "",
                keywords: "",
                problem: "",
                solution: "",
                active: false,
              })
            }
          >
            FAQ 추가
          </Button>
        </div>
      )}
      {!faqs ? (
        <Loading />
      ) : (
        <ul className="flex flex-col">
          {faqs.length === 0 && (
            <li className="text-sm text-theme-text-secondary py-2">
              등록된 FAQ가 없습니다.
            </li>
          )}
          {faqs.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-theme-sidebar-border last:border-b-0"
            >
              <span className="text-sm text-theme-text-primary">
                {f.title}
                {f.keywords && (
                  <span className="text-xs text-theme-text-secondary ml-2">
                    {f.keywords}
                  </span>
                )}
                <span
                  className="block text-xs text-theme-text-secondary"
                  data-testid="faq-stats"
                >
                  {f.category || "기타"} · 조회 {f.viewCount}회 · 도움이 됐어요{" "}
                  {f.helpfulCount} · 해결되지 않았어요 {f.notHelpfulCount}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={f.active ? "ok" : "neutral"}>
                  {f.active ? "사용" : "숨김"}
                </Badge>
                <Button variant="secondary" onClick={() => setForm(f)}>
                  수정
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
