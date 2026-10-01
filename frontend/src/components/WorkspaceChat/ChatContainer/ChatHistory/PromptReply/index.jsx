import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Warning } from "@phosphor-icons/react";
import renderMarkdown from "@/utils/chat/markdown";
import DOMPurify from "@/utils/chat/purify";
import Citations from "../Citation";
import {
  THOUGHT_REGEX_CLOSE,
  THOUGHT_REGEX_COMPLETE,
  THOUGHT_REGEX_OPEN,
} from "../ThoughtContainer";
import ProcedurePresentation from "../ProcedurePresentation";
import { buildProcedurePresentationModel } from "@/utils/schatPresentation";
import RelatedImages from "../RelatedImages";
import ChecklistLauncher from "../Checklist/ChecklistLauncher";
import { hideEmployeeSourcePages } from "@/utils/schatSourceDisplay";

const PromptReply = ({
  uuid,
  reply,
  pending,
  error,
  sources = [],
  presentation = null,
  relatedImages = [],
  checklists = [],
  onOpenChecklist,
  citationQuestion = "",
  citationAliases = [],
  workspaceSlug,
}) => {
  const { t } = useTranslation();
  if (!reply && sources.length === 0 && !pending && !error) return null;

  if (pending) return null;

  if (error) {
    return (
      <div className="flex justify-start w-full">
        <div className="py-4 pl-0 pr-4 flex flex-col md:max-w-[80%]">
          {/*
            role="alert" rather than "status": a failed reply is the one case
            where the user needs interrupting, because nothing else on the page
            changes to tell them the turn ended.
          */}
          <span
            className="inline-block p-2 rounded-lg bg-red-50 text-red-500"
            role="alert"
          >
            <Warning className="h-4 w-4 mb-1 inline-block" />{" "}
            {t("chat_window.response_failed")}
            <span className="text-xs">
              {t("chat_window.response_failed_reason", {
                reason: error || "unknown",
              })}
            </span>
          </span>
        </div>
      </div>
    );
  }

  const procedureModel = buildProcedurePresentationModel(presentation, sources);

  return (
    <div key={uuid} className="flex justify-start w-full">
      <div className="py-4 pl-0 pr-4 flex flex-col w-full">
        {procedureModel ? (
          <ProcedurePresentation
            presentation={presentation}
            sources={sources}
          />
        ) : (
          <div className="w-full max-w-[780px] leading-[1.7]">
            <RenderAssistantChatContent
              key={`${uuid}-prompt-reply-content`}
              message={reply}
            />
          </div>
        )}
        <ChecklistLauncher
          checklists={checklists}
          onOpenChecklist={onOpenChecklist}
        />
        <Citations
          sources={sources}
          workspaceSlug={workspaceSlug}
          question={citationQuestion}
          answer={reply}
          aliases={citationAliases}
        />
        <RelatedImages images={relatedImages} workspaceSlug={workspaceSlug} />
      </div>
    </div>
  );
};

function RenderAssistantChatContent({ message }) {
  // Thought segments are rendered by the activity chain (buildMessages splits
  // them out) - this only renders the visible remainder of the reply.
  if (message.match(THOUGHT_REGEX_OPEN) && !message.match(THOUGHT_REGEX_CLOSE))
    return null;
  const msgToRender = hideEmployeeSourcePages(
    message.replace(THOUGHT_REGEX_COMPLETE, "")
  );
  if (!msgToRender.trim().length) return null;

  return (
    <span
      className="break-words flex flex-col gap-y-1"
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(renderMarkdown(msgToRender)),
      }}
    />
  );
}

export default memo(PromptReply);
