import useUser from "@/hooks/useUser";
import paths from "@/utils/paths";
import { ArrowUUpLeft, Wrench } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { useMatch } from "react-router-dom";

export default function SettingsButton() {
  const isInSettings = !!useMatch("/settings/*");
  const { user } = useUser();

  // Only admins manage SCHAT; staff (default) and managers never see this.
  if (user && user?.role !== "admin") return null;

  if (isInSettings)
    return (
      <div className="flex w-fit">
        <Link
          to={paths.home()}
          className="transition-all duration-300 p-2 rounded-full bg-theme-sidebar-footer-icon hover:bg-theme-sidebar-footer-icon-hover"
          aria-label="대화 화면으로 돌아가기"
          data-tooltip-id="footer-item"
          data-tooltip-content="대화 화면으로 돌아가기"
        >
          <ArrowUUpLeft
            className="h-5 w-5 text-white light:text-slate-800"
            weight="fill"
          />
        </Link>
      </div>
    );

  return (
    <div className="flex w-fit">
      <Link
        to={paths.settings.schatAdmin()}
        className="transition-all duration-300 p-2 rounded-full bg-theme-sidebar-footer-icon hover:bg-theme-sidebar-footer-icon-hover"
        aria-label="SCHAT 관리자 설정"
        data-tooltip-id="footer-item"
        data-tooltip-content="SCHAT 관리자 설정"
      >
        <Wrench
          className="h-5 w-5 text-white light:text-slate-800"
          weight="fill"
        />
      </Link>
    </div>
  );
}
