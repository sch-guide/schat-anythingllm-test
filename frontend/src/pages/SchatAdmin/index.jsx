import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isMobile } from "react-device-detect";
import SettingsSidebar from "@/components/SettingsSidebar";
import Workspace from "@/models/workspace";
import { LAST_VISITED_WORKSPACE } from "@/utils/constants";
import { safeJsonParse } from "@/utils/request";
import paths from "@/utils/paths";
import {
  SCHAT_ADMIN_SECTIONS,
  SCHAT_ADMIN_TITLE,
  findSchatAdminSection,
} from "./menu";
import { inputClass } from "./ui";
import BrandSection from "./sections/Brand";
import AnswerSection from "./sections/Answer";
import UsersSection from "./sections/Users";
import ReportsSection from "./sections/Reports";
import QuizSection from "./sections/Quiz";
import ConnectionsSection from "./sections/Connections";
import StatusSection from "./sections/Status";
import StorageSection from "./sections/Storage";
import DangerSection from "./sections/Danger";

const SECTIONS = {
  brand: BrandSection,
  answer: AnswerSection,
  users: UsersSection,
  reports: ReportsSection,
  quiz: QuizSection,
  connections: ConnectionsSection,
  status: StatusSection,
  storage: StorageSection,
  danger: DangerSection,
};

// Sections that change one workspace show a picker when there is more than one.
const WORKSPACE_SECTIONS = ["brand", "answer", "danger"];
// Table-heavy sections get more width so rows stay on one line.
const WIDE_SECTIONS = ["users", "reports", "quiz", "storage"];

function preferredSlug(workspaces = []) {
  const lastVisited = safeJsonParse(
    window.localStorage.getItem(LAST_VISITED_WORKSPACE)
  );
  if (workspaces.some((ws) => ws.slug === lastVisited?.slug))
    return lastVisited.slug;
  return workspaces[0]?.slug ?? null;
}

function useAdminWorkspace() {
  const [workspaces, setWorkspaces] = useState(null);
  const [slug, setSlug] = useState(null);
  const [workspace, setWorkspace] = useState(null);

  const loadWorkspaces = useCallback(async () => {
    const list = await Workspace.all();
    setWorkspaces(list);
    setSlug((current) =>
      list.some((ws) => ws.slug === current) ? current : preferredSlug(list)
    );
    return list;
  }, []);

  const reload = useCallback(async () => {
    if (!slug) return setWorkspace(null);
    setWorkspace(await Workspace.bySlug(slug));
  }, [slug]);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);
  useEffect(() => {
    reload();
  }, [reload]);

  return {
    workspaces,
    workspace,
    slug,
    setSlug,
    reload,
    reloadAll: async () => {
      await loadWorkspaces();
      await reload();
    },
  };
}

export default function SchatAdmin() {
  const { section: sectionKey } = useParams();
  const navigate = useNavigate();
  const section = findSchatAdminSection(sectionKey);
  const Body = SECTIONS[section.key];
  const admin = useAdminWorkspace();
  const showPicker =
    WORKSPACE_SECTIONS.includes(section.key) &&
    (admin.workspaces?.length || 0) > 1;

  return (
    <div className="w-screen h-screen overflow-hidden bg-theme-bg-container flex">
      {/* Narrow screens use the section picker below instead of the sidebar. */}
      <div className="hidden md:flex">
        <SettingsSidebar />
      </div>
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-theme-bg-secondary w-full h-full overflow-y-scroll p-4 md:p-0"
      >
        <div
          className={`schat-admin flex flex-col w-full ${WIDE_SECTIONS.includes(section.key) ? "max-w-[1180px]" : "max-w-[860px]"} px-1 md:pl-6 md:pr-[50px] md:py-6 py-5 gap-y-5`}
        >
          <nav className="md:hidden flex flex-col gap-y-2 pr-12">
            <Link
              to={paths.home()}
              className="text-sm text-theme-text-secondary underline"
            >
              대화 화면으로 돌아가기
            </Link>
            <label className="flex flex-col gap-y-1">
              <span className="text-xs text-theme-text-secondary">
                {SCHAT_ADMIN_TITLE} 메뉴
              </span>
              <select
                className={inputClass}
                value={section.key}
                onChange={(e) =>
                  navigate(paths.settings.schatAdmin(e.target.value))
                }
              >
                {SCHAT_ADMIN_SECTIONS.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </nav>
          <header className="flex flex-col gap-y-1 pb-5 border-b-2 border-theme-sidebar-border">
            <p className="text-xs font-medium text-theme-text-secondary">
              {SCHAT_ADMIN_TITLE}
            </p>
            <h1 className="text-lg leading-6 font-bold text-theme-text-primary">
              {section.label}
            </h1>
            <p className="text-xs leading-5 text-theme-text-secondary">
              {section.description}
            </p>
          </header>
          {showPicker && (
            <label className="flex flex-col gap-y-1.5 max-w-[360px]">
              <span className="text-sm font-medium text-theme-text-primary">
                관리할 작업 공간
              </span>
              <select
                className={inputClass}
                value={admin.slug || ""}
                onChange={(e) => admin.setSlug(e.target.value)}
              >
                {admin.workspaces.map((ws) => (
                  <option key={ws.slug} value={ws.slug}>
                    {ws.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Body key={`${section.key}:${admin.slug}`} {...admin} />
        </div>
      </div>
    </div>
  );
}
