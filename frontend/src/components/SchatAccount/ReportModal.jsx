import { useEffect, useRef, useState } from "react";
import Modal, { ModalBody, ModalHeader } from "@/components/lib/Modal";
import SchatAccount from "@/models/schatAccount";
import showToast from "@/utils/toast";

const fieldClass =
  "schat-admin-input w-full rounded-lg px-3 py-2 text-sm outline-none bg-theme-settings-input-bg text-theme-text-primary border border-theme-sidebar-border focus:border-sky-500";

// 문제 신고. The reporter is the signed-in account (server side); nobody types
// their own name or number. Matching FAQs are suggested but never block.
export default function ReportModal({
  isOpen,
  onClose,
  onSubmitted,
  relatedFaq = null, // {id, title, category} when opened from 이용 가이드
}) {
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({
    category: "",
    title: "",
    content: "",
    relatedFeature: "",
  });
  const [faqs, setFaqs] = useState([]);
  const [helpedIds, setHelpedIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    SchatAccount.reportCategories().then((r) => {
      const list = r?.categories || [];
      setCategories(list);
      if (relatedFaq)
        setForm((prev) => ({
          ...prev,
          category: list.includes(relatedFaq.category)
            ? relatedFaq.category
            : prev.category,
          title:
            prev.title ||
            `이용 가이드로 해결되지 않음: ${relatedFaq.title}`.slice(0, 100),
        }));
    });
  }, [isOpen, relatedFaq]);

  useEffect(() => {
    clearTimeout(timer.current);
    const q = `${form.title} ${form.content}`.trim();
    if (q.length < 2) return setFaqs([]);
    timer.current = setTimeout(async () => {
      const result = await SchatAccount.suggestFaqs(q.slice(0, 500));
      setFaqs(result?.faqs || []);
    }, 400);
    return () => clearTimeout(timer.current);
  }, [form.title, form.content]);

  function reset() {
    setForm({ category: "", title: "", content: "", relatedFeature: "" });
    setFaqs([]);
    setHelpedIds([]);
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    // Only the guide item's id is attached; the server looks up its title.
    const result = await SchatAccount.createReport({
      ...form,
      ...(relatedFaq ? { relatedFaqId: relatedFaq.id } : {}),
    });
    setSaving(false);
    if (!result.success)
      return showToast(result.error || "신고를 등록하지 못했습니다.", "error");
    showToast("문제 신고가 등록되었습니다.", "success");
    reset();
    onSubmitted?.();
    onClose();
  }

  const set = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalHeader
        title="문제 신고"
        subtitle="신고자 정보는 로그인한 계정에서 자동으로 연결됩니다."
        onClose={onClose}
      />
      <ModalBody>
        <form onSubmit={submit} className="flex flex-col gap-y-3">
          {relatedFaq && (
            <p className="text-xs text-theme-text-secondary">
              관련 이용 가이드: {relatedFaq.title}
            </p>
          )}
          <p className="text-xs rounded-lg px-3 py-2 schat-admin-notice schat-admin-notice--warning">
            환자 이름, 등록번호, 생년월일 등 개인정보는 입력하지 마세요.
          </p>
          <label className="flex flex-col gap-y-1.5 text-sm text-theme-text-primary">
            문제 종류
            <select
              required
              value={form.category}
              onChange={set("category")}
              className={fieldClass}
            >
              <option value="" disabled>
                선택하세요
              </option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-y-1.5 text-sm text-theme-text-primary">
            제목
            <input
              required
              maxLength={100}
              value={form.title}
              onChange={set("title")}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-y-1.5 text-sm text-theme-text-primary">
            상세 내용
            <textarea
              required
              maxLength={3000}
              rows={5}
              value={form.content}
              onChange={set("content")}
              className={`${fieldClass} resize-y`}
            />
          </label>
          <label className="flex flex-col gap-y-1.5 text-sm text-theme-text-primary">
            관련 화면·기능 (선택)
            <input
              maxLength={100}
              value={form.relatedFeature}
              onChange={set("relatedFeature")}
              placeholder="예: 체크리스트, PDF 원문 보기"
              className={fieldClass}
            />
          </label>
          {faqs.length > 0 && (
            <div className="rounded-lg border border-theme-sidebar-border p-3 flex flex-col gap-y-2">
              <p className="text-sm font-semibold text-theme-text-primary">
                관련 도움말
              </p>
              {faqs.map((faq) => (
                <details key={faq.id} className="text-sm">
                  <summary className="cursor-pointer text-theme-text-primary">
                    {faq.title}
                  </summary>
                  <p className="mt-1 whitespace-pre-wrap text-theme-text-secondary">
                    {faq.solution}
                  </p>
                  {helpedIds.includes(faq.id) ? (
                    <p className="mt-1 text-xs text-theme-text-secondary">
                      도움이 되었다니 다행입니다. 필요하면 그대로 신고할 수도
                      있습니다.
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="mt-1 text-xs underline text-theme-text-secondary"
                      onClick={() => setHelpedIds((ids) => [...ids, faq.id])}
                    >
                      도움이 됐어요
                    </button>
                  )}
                </details>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-x-2">
            <button
              type="button"
              onClick={onClose}
              className="schat-admin-button schat-admin-button--secondary rounded-lg px-3.5 py-2 text-sm"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="schat-admin-button schat-admin-button--primary rounded-lg px-3.5 py-2 text-sm disabled:opacity-50"
            >
              {saving
                ? "등록 중..."
                : faqs.length > 0
                  ? "그래도 문제 신고"
                  : "문제 신고"}
            </button>
          </div>
        </form>
      </ModalBody>
    </Modal>
  );
}
