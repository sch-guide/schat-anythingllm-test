import useLoginMode from "@/hooks/useLoginMode";
import paths from "@/utils/paths";
import { UserCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import {
  AUTH_TIMESTAMP,
  AUTH_TOKEN,
  AUTH_USER,
  LAST_VISITED_WORKSPACE,
  USER_PROMPT_INPUT_MAP,
} from "@/utils/constants";
import { userFromStorage } from "@/utils/request";
import Modal, { ModalBody, ModalHeader } from "@/components/lib/Modal";
import ChangePasswordForm from "@/components/SchatAccount/ChangePasswordForm";
import ReportModal from "@/components/SchatAccount/ReportModal";
import MyReportsModal from "@/components/SchatAccount/MyReportsModal";
import NotificationBell from "@/components/SchatAccount/NotificationBell";
import { mergeStoredUser } from "@/components/SchatAccount/storedUser";
import showToast from "@/utils/toast";

const ROLE_LABELS = { admin: "관리자", default: "일반사용자" };

export default function UserButton() {
  const mode = useLoginMode();
  const menuRef = useRef();
  const buttonRef = useRef();
  const [showMenu, setShowMenu] = useState(false);
  const [dialog, setDialog] = useState(null); // "report" | "mine" | "password"
  const user = userFromStorage();

  const handleClose = (event) => {
    if (
      menuRef.current &&
      !menuRef.current.contains(event.target) &&
      !buttonRef.current.contains(event.target)
    ) {
      setShowMenu(false);
    }
  };

  useEffect(() => {
    if (showMenu) {
      document.addEventListener("mousedown", handleClose);
    }
    return () => document.removeEventListener("mousedown", handleClose);
  }, [showMenu]);

  if (mode === null) return null;
  const isMulti = mode === "multi";
  const openDialog = (name) => {
    setShowMenu(false);
    setDialog(name);
  };
  const menuItemClass =
    "whitespace-nowrap text-white hover:bg-theme-action-menu-item-hover w-full text-left px-4 py-1.5 rounded-md";

  // SCHAT user menu: profile, report, my reports, password, sign-out. The
  // existing sign-out steps below are unchanged.
  return (
    <div className="schat-user-menu absolute top-3 right-4 md:top-9 md:right-10 w-fit h-fit z-40 flex items-center gap-x-2">
      {isMulti && <NotificationBell />}
      <button
        ref={buttonRef}
        onClick={() => setShowMenu(!showMenu)}
        type="button"
        aria-label="사용자 메뉴"
        aria-haspopup="menu"
        aria-expanded={showMenu}
        className="transition-all duration-300 w-[35px] h-[35px] rounded-full flex items-center bg-theme-action-menu-bg hover:bg-theme-action-menu-item-hover justify-center text-white p-2 hover:border-slate-100 hover:border-opacity-50 border-transparent border"
      >
        <UserCircle size={22} weight="regular" aria-hidden="true" />
      </button>

      {showMenu && (
        <div
          ref={menuRef}
          role="menu"
          className="schat-popover w-fit min-w-[200px] rounded-lg absolute top-12 right-0 bg-theme-action-menu-bg p-2 flex flex-col gap-y-1"
        >
          {isMulti && user && (
            <div className="px-4 pt-1.5 pb-2 border-b border-white/10 light:border-slate-200 mb-1">
              <p className="text-sm font-semibold text-white light:text-slate-900">
                {user.name || user.username}
              </p>
              {(user.department || user.employeeNumberMasked) && (
                <p className="text-xs text-zinc-400 light:text-slate-500">
                  {[user.department, user.employeeNumberMasked]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              <p className="text-xs text-zinc-400 light:text-slate-500">
                {user.roleLabel || ROLE_LABELS[user.role] || ""}
              </p>
            </div>
          )}
          {isMulti && (
            <>
              <button
                role="menuitem"
                type="button"
                className={menuItemClass}
                onClick={() => openDialog("report")}
              >
                문제 신고
              </button>
              <button
                role="menuitem"
                type="button"
                className={menuItemClass}
                onClick={() => openDialog("mine")}
              >
                내 신고
              </button>
              <button
                role="menuitem"
                type="button"
                className={menuItemClass}
                onClick={() => openDialog("password")}
              >
                비밀번호 변경
              </button>
            </>
          )}
          <button
            role="menuitem"
            onClick={() => {
              window.localStorage.removeItem(AUTH_USER);
              window.localStorage.removeItem(AUTH_TOKEN);
              window.localStorage.removeItem(AUTH_TIMESTAMP);
              window.localStorage.removeItem(LAST_VISITED_WORKSPACE);
              window.localStorage.removeItem(USER_PROMPT_INPUT_MAP);
              window.location.replace(paths.home());
            }}
            type="button"
            className="whitespace-nowrap text-white hover:bg-theme-action-menu-item-hover w-full text-left px-4 py-1.5 rounded-md"
          >
            로그아웃
          </button>
        </div>
      )}
      {isMulti && (
        <>
          <ReportModal
            isOpen={dialog === "report"}
            onClose={() => setDialog(null)}
          />
          <MyReportsModal
            isOpen={dialog === "mine"}
            onClose={() => setDialog(null)}
          />
          <Modal
            isOpen={dialog === "password"}
            onClose={() => setDialog(null)}
            size="sm"
          >
            <ModalHeader
              title="비밀번호 변경"
              onClose={() => setDialog(null)}
            />
            <ModalBody>
              <ChangePasswordForm
                onDone={(profile) => {
                  mergeStoredUser(profile);
                  setDialog(null);
                  showToast("비밀번호를 변경했습니다.", "success");
                }}
              />
            </ModalBody>
          </Modal>
        </>
      )}
    </div>
  );
}
