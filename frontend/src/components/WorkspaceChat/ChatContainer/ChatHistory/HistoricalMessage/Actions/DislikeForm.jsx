import { useState } from "react";

export default function DislikeForm({ pending, error, onCancel, onSubmit }) {
  const [reason, setReason] = useState("");
  const [memo, setMemo] = useState("");
  return (
    <form
      className="mt-3 w-full max-w-lg rounded-lg border border-theme-sidebar-border bg-theme-bg-secondary p-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending && reason) onSubmit({ reason, memo });
      }}
      aria-label="답변 평가"
    >
      <fieldset disabled={pending}>
        <legend className="mb-2 font-medium text-theme-text-primary">
          어떤 점이 아쉬웠나요?
        </legend>
        <div className="flex flex-wrap gap-3">
          {[
            ["wrong", "틀린 내용이 있어요"],
            ["not_found", "원하는 내용을 못 찾았어요"],
          ].map(([value, label]) => (
            <label
              key={value}
              className="flex items-center gap-1 text-theme-text-primary"
            >
              <input
                type="radio"
                name="reason"
                value={value}
                checked={reason === value}
                onChange={() => setReason(value)}
                required
              />
              {label}
            </label>
          ))}
        </div>
        <label className="mt-3 block text-theme-text-secondary">
          한 줄 메모 (선택, 200자 이내)
          <input
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            maxLength={200}
            className="mt-1 w-full rounded border border-theme-sidebar-border bg-theme-bg-primary p-2 text-theme-text-primary"
          />
        </label>
        <p className="mt-2 text-orange-500">환자 이름·등록번호는 적지 마세요</p>
        {error && (
          <p role="alert" className="mt-2 text-red-500">
            {error}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1 text-theme-text-primary"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={pending || !reason}
            className="rounded bg-primary-button px-3 py-1 text-white disabled:opacity-50"
          >
            {pending ? "보내는 중..." : "보내기"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
