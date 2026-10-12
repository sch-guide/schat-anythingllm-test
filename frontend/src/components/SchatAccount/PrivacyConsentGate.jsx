import { useState } from "react";
import { LoginShell } from "@/components/Modals/Password";
import SchatAccount from "@/models/schatAccount";
import paths from "@/utils/paths";
import { AUTH_TIMESTAMP, AUTH_TOKEN, AUTH_USER } from "@/utils/constants";
import PrivacyConsentStep, { CONSENT_DECLINED_KEY } from "./PrivacyConsentStep";

// 이미 로그인한 직원·관리자가 현재 동의서에 아직 동의하지 않았을 때 보여 준다.
// 서버도 동의 전에는 다른 기능 요청을 거절한다.
export default function PrivacyConsentGate({ document }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function agree(agreement) {
    setBusy(true);
    setError(null);
    const result = await SchatAccount.agreeConsent(agreement);
    if (result?.success) return window.location.reload();
    setBusy(false);
    setError(
      result?.error || "동의를 저장하지 못했습니다. 다시 시도해 주세요."
    );
  }

  function decline() {
    try {
      window.sessionStorage.setItem(CONSENT_DECLINED_KEY, "1");
    } catch {}
    window.localStorage.removeItem(AUTH_USER);
    window.localStorage.removeItem(AUTH_TOKEN);
    window.localStorage.removeItem(AUTH_TIMESTAMP);
    window.location = paths.login();
  }

  return (
    <LoginShell>
      <PrivacyConsentStep
        document={document}
        showSteps={false}
        submitLabel="동의하고 시작하기"
        busy={busy}
        error={error}
        onAgree={agree}
        onDecline={decline}
      />
    </LoginShell>
  );
}
