import React, { useState, useEffect } from "react";
import System from "../../../models/system";
import SingleUserAuth from "./SingleUserAuth";
import MultiUserAuth from "./MultiUserAuth";
import {
  AUTH_TOKEN,
  AUTH_USER,
  AUTH_TIMESTAMP,
} from "../../../utils/constants";
import SchLogo from "@/components/SchLogo";

export default function PasswordModal({ mode = "single" }) {
  return (
    <div className="schat-login fixed inset-0 flex items-center justify-center overflow-auto">
      <main className="schat-login__shell">
        <section className="schat-login__brand" aria-label="서비스 소개">
          <div className="schat-login__hospital">
            <SchLogo className="schat-login__mark" />
            <span>순천향대학교 부속 천안병원</span>
          </div>
          <div>
            <p className="schat-login__eyebrow">HOSPITAL KNOWLEDGE ASSISTANT</p>
            <h1>병원 실무지침 AI</h1>
            <p className="schat-login__description">
              등록된 실무지침을 근거로 질문하고 출처와 함께 확인합니다.
            </p>
          </div>
          <div className="schat-login__trust">
            <span>직원 전용</span>
            <span>근거 기반 답변</span>
            <span>개인정보 입력 금지</span>
          </div>
        </section>
        <section className="schat-login__form">
          <div className="schat-login__product">
            <SchLogo className="schat-login__product-mark" />
            <span>병원 실무지침 AI</span>
          </div>
          {mode === "single" ? <SingleUserAuth /> : <MultiUserAuth />}
        </section>
      </main>
    </div>
  );
}

export function usePasswordModal(notry = false) {
  const [auth, setAuth] = useState({
    loading: true,
    requiresAuth: false,
    mode: "single",
  });

  useEffect(() => {
    async function checkAuthReq() {
      if (!window) return;

      // If the last validity check is still valid
      // we can skip the loading.
      if (!System.needsAuthCheck() && notry === false) {
        setAuth({
          loading: false,
          requiresAuth: false,
          mode: "multi",
        });
        return;
      }

      const settings = await System.keys();
      if (settings?.MultiUserMode) {
        const currentToken = window.localStorage.getItem(AUTH_TOKEN);
        if (!!currentToken) {
          const valid = notry ? false : await System.checkAuth(currentToken);
          if (!valid) {
            setAuth({
              loading: false,
              requiresAuth: true,
              mode: "multi",
            });
            window.localStorage.removeItem(AUTH_USER);
            window.localStorage.removeItem(AUTH_TOKEN);
            window.localStorage.removeItem(AUTH_TIMESTAMP);
            return;
          } else {
            setAuth({
              loading: false,
              requiresAuth: false,
              mode: "multi",
            });
            return;
          }
        } else {
          setAuth({
            loading: false,
            requiresAuth: true,
            mode: "multi",
          });
          return;
        }
      } else {
        // Running token check in single user Auth mode.
        // If Single user Auth is disabled - skip check
        const requiresAuth = settings?.RequiresAuth || false;
        if (!requiresAuth) {
          setAuth({
            loading: false,
            requiresAuth: false,
            mode: "single",
          });
          return;
        }

        const currentToken = window.localStorage.getItem(AUTH_TOKEN);
        if (!!currentToken) {
          const valid = notry ? false : await System.checkAuth(currentToken);
          if (!valid) {
            setAuth({
              loading: false,
              requiresAuth: true,
              mode: "single",
            });
            window.localStorage.removeItem(AUTH_TOKEN);
            window.localStorage.removeItem(AUTH_USER);
            window.localStorage.removeItem(AUTH_TIMESTAMP);
            return;
          } else {
            setAuth({
              loading: false,
              requiresAuth: false,
              mode: "single",
            });
            return;
          }
        } else {
          setAuth({
            loading: false,
            requiresAuth: true,
            mode: "single",
          });
          return;
        }
      }
    }
    checkAuthReq();
  }, []);

  return auth;
}
