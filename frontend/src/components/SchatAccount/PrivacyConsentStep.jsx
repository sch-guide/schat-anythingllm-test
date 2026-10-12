import { useState } from "react";
import { CaretDown, CaretUp, Warning } from "@phosphor-icons/react";
import "./privacyConsent.css";

export const CONSENT_STEPS = ["직원 확인", "개인정보 동의", "비밀번호 만들기"];

// ① 직원 확인 → ② 개인정보 동의 → ③ 비밀번호 만들기
export function ConsentSteps({ current = 2 }) {
  return (
    <ol className="schat-consent__steps" aria-label="진행 단계">
      {CONSENT_STEPS.map((label, index) => {
        const step = index + 1;
        return (
          <li
            key={label}
            className={step === current ? "is-current" : undefined}
            aria-current={step === current ? "step" : undefined}
          >
            {"①②③"[index]} {label}
          </li>
        );
      })}
    </ol>
  );
}

const SUMMARY_ROWS = [
  ["items", "수집 항목"],
  ["purpose", "이용 목적"],
  ["retention", "보관 기간"],
  ["refusal", "거부 권리"],
];
const EXTERNAL_ROWS = [
  ["storage", "저장 위치"],
  ["generation", "답변 생성"],
];

// 개인정보 수집·이용 동의 화면. 필수 3개를 모두 체크해야 [동의하고 다음]이 눌린다.
// onAgree({version, items}) / onDecline(). 서버 저장은 부르는 쪽이 한다.
export default function PrivacyConsentStep({
  document,
  showSteps = true,
  submitLabel = "동의하고 다음",
  busy = false,
  error = null,
  onAgree,
  onDecline,
}) {
  const [checked, setChecked] = useState({});
  const [expanded, setExpanded] = useState(false);
  const items = document?.items || [];
  const allChecked =
    items.length > 0 && items.every((item) => checked[item.key]);
  const content = document?.content || {};

  function submit(e) {
    e.preventDefault();
    if (!allChecked || busy) return;
    onAgree?.({
      version: document.version,
      items: Object.fromEntries(items.map((item) => [item.key, true])),
    });
  }

  return (
    <form
      className="schat-consent"
      aria-label="개인정보 수집·이용 동의"
      onSubmit={submit}
    >
      {showSteps && <ConsentSteps current={2} />}
      <h2 className="schat-consent__title">개인정보 수집·이용 동의</h2>
      <p className="schat-consent__lead">
        SCHAT을 이용하려면 아래 내용에 동의해 주세요.
      </p>

      <section className="schat-consent__box" aria-label="수집·이용 내용">
        <div className="schat-consent__box-head">
          <h3>수집·이용 내용</h3>
          <button
            type="button"
            className="schat-consent__more"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "접기" : "전체 보기"}
            {expanded ? (
              <CaretUp size={12} weight="bold" aria-hidden="true" />
            ) : (
              <CaretDown size={12} weight="bold" aria-hidden="true" />
            )}
          </button>
        </div>
        <dl className="schat-consent__rows">
          {SUMMARY_ROWS.map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{content.summary?.[key]}</dd>
            </div>
          ))}
        </dl>
        {expanded && (
          <div className="schat-consent__full" data-testid="consent-full-text">
            {content.fullText}
          </div>
        )}
      </section>

      <section
        className="schat-consent__box"
        aria-label="외부 서비스 이용 안내"
      >
        <div className="schat-consent__box-head">
          <h3>외부 서비스 이용 안내</h3>
        </div>
        <dl className="schat-consent__rows">
          {EXTERNAL_ROWS.map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{content.external?.[key]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="schat-consent__warning" role="note">
        <strong>
          <Warning size={15} weight="bold" aria-hidden="true" />
          환자 이름, 등록번호, 생년월일 등 개인정보를 질문에 입력하지 마세요.
        </strong>
        <span>입력한 질문은 외부 AI 서비스로 전송됩니다.</span>
      </div>

      <div className="schat-consent__checks">
        {items.map((item) => (
          <label key={item.key} className="schat-consent__check">
            <input
              type="checkbox"
              name={item.key}
              checked={!!checked[item.key]}
              onChange={(e) =>
                setChecked((prev) => ({
                  ...prev,
                  [item.key]: e.target.checked,
                }))
              }
            />
            <span>
              {item.label} <em>(필수)</em>
            </span>
          </label>
        ))}
      </div>

      {error && (
        <p role="alert" className="schat-consent__error">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="schat-consent__submit"
        disabled={!allChecked || busy}
      >
        {busy ? "저장하는 중..." : submitLabel}
      </button>
      <p className="schat-consent__hint">
        필수 항목에 모두 체크해야 다음으로 넘어갈 수 있습니다.
      </p>
      <button
        type="button"
        className="schat-consent__decline"
        onClick={onDecline}
        disabled={busy}
      >
        동의하지 않음
      </button>
      <p className="schat-consent__version">동의서 버전 {document?.label}</p>
    </form>
  );
}

// 동의하지 않았을 때 로그인 화면에 한 번 보여 줄 안내.
export const CONSENT_DECLINED_KEY = "schat_privacy_consent_declined";
export const CONSENT_DECLINED_MESSAGE =
  "동의하지 않으면 SCHAT을 이용할 수 없습니다.";
