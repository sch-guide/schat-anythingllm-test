import React, { memo, useEffect, useMemo, useState } from "react";
import useCopyText from "@/hooks/useCopyText";
import {
  Check,
  ThumbsUp,
  ThumbsDown,
  ArrowsClockwise,
  Copy,
} from "@phosphor-icons/react";
import Workspace from "@/models/workspace";
import { EditMessageAction } from "./EditMessage";
import ActionMenu from "./ActionMenu";
import { useTranslation } from "react-i18next";
import useUser from "@/hooks/useUser";
import { canEditMessage, canManageAnswers } from "@/utils/answerActions.mjs";
import { createFeedbackController } from "@/utils/answerFeedback.mjs";
import DislikeForm from "./DislikeForm";

const Actions = ({
  message,
  feedbackScore,
  chatId,
  slug,
  isLastMessage,
  regenerateMessage,
  forkThread,
  isEditing,
  role,
  readAloud,
}) => {
  const { t } = useTranslation();
  const { user } = useUser();
  const [{ selected: selectedFeedback, pending }, setFeedback] = useState({
    selected: feedbackScore ?? null,
    pending: false,
  });
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [thanks, setThanks] = useState(false);
  const controller = useMemo(
    () =>
      createFeedbackController({
        initial: feedbackScore ?? null,
        save: (value, details) =>
          Workspace.updateChatFeedback(chatId, slug, value, details),
        onChange: setFeedback,
      }),
    [chatId, slug]
  );
  useEffect(() => {
    controller.selected = feedbackScore ?? null;
    setFeedback({ selected: controller.selected, pending: controller.pending });
  }, [controller, feedbackScore]);
  useEffect(() => {
    if (!thanks) return;
    const timer = setTimeout(() => setThanks(false), 2500);
    return () => clearTimeout(timer);
  }, [thanks]);
  const saveFeedback = async (value, details) => {
    if (controller.pending) return;
    setError("");
    const success = await controller.submit(value, details);
    if (!success) return setError("저장하지 못했습니다. 다시 시도해 주세요.");
    setFormOpen(false);
    if (value === false) setThanks(true);
  };

  return (
    <div
      className={`flex w-full flex-wrap items-center gap-y-1 ${role === "user" ? "justify-end" : "justify-between"}`}
    >
      <div className="flex justify-start items-center gap-x-[8px]">
        <div className="flex flex-wrap justify-start items-center gap-x-[8px] gap-y-1">
          {role !== "user" && readAloud}
          <div
            className={`flex justify-start items-center gap-x-[8px] ${role === "user" ? "flex-row-reverse" : ""}`}
          >
            <CopyMessage message={message} />
            {canEditMessage(user, role) && (
              <EditMessageAction
                chatId={chatId}
                role={role}
                isEditing={isEditing}
              />
            )}
          </div>
          {isLastMessage && !isEditing && (
            <RegenerateMessage
              regenerateMessage={regenerateMessage}
              slug={slug}
              chatId={chatId}
            />
          )}
          {chatId && role !== "user" && !isEditing && (
            <FeedbackButton
              isSelected={selectedFeedback === true}
              disabled={pending}
              handleFeedback={() =>
                saveFeedback(controller.selected === true ? null : true)
              }
              tooltipId="feedback-button"
              tooltipContent={t("chat_window.good_response")}
              IconComponent={ThumbsUp}
            />
          )}
          {chatId && role !== "user" && !isEditing && (
            <FeedbackButton
              isSelected={selectedFeedback === false}
              disabled={pending}
              handleFeedback={() => {
                if (controller.pending) return;
                if (controller.selected === false) return saveFeedback(null);
                setError("");
                setFormOpen(true);
              }}
              tooltipId="dislike-button"
              tooltipContent="싫어요"
              IconComponent={ThumbsDown}
            />
          )}
          {canManageAnswers(user) && (
            <ActionMenu
              chatId={chatId}
              forkThread={forkThread}
              isEditing={isEditing}
              role={role}
            />
          )}
        </div>
      </div>
      {formOpen && (
        <DislikeForm
          pending={pending}
          error={error}
          onCancel={() => {
            setFormOpen(false);
            setError("");
          }}
          onSubmit={(details) => saveFeedback(false, details)}
        />
      )}
      {error && !formOpen && (
        <p role="alert" className="mt-2 w-full text-sm text-red-500">
          {error}
        </p>
      )}
      {thanks && (
        <p
          role="status"
          className="mt-2 w-full text-sm text-theme-text-secondary"
        >
          알려 주셔서 고마워요
        </p>
      )}
    </div>
  );
};

function FeedbackButton({
  isSelected,
  handleFeedback,
  tooltipContent,
  IconComponent,
  disabled,
  tooltipId = "feedback-button",
}) {
  return (
    <div className="mt-3 relative">
      <button
        onClick={handleFeedback}
        disabled={disabled}
        aria-pressed={isSelected}
        data-tooltip-id={tooltipId}
        data-tooltip-content={tooltipContent}
        className="text-zinc-300 light:text-slate-500"
        aria-label={tooltipContent}
      >
        <IconComponent
          size={20}
          className="mb-1"
          weight={isSelected ? "fill" : "regular"}
        />
      </button>
    </div>
  );
}

function CopyMessage({ message }) {
  const { copied, copyText } = useCopyText();
  const { t } = useTranslation();

  return (
    <>
      <div className="mt-3 relative">
        <button
          onClick={() => copyText(message)}
          data-tooltip-id="copy-assistant-text"
          data-tooltip-content={t("chat_window.copy")}
          className="text-zinc-300 light:text-slate-500"
          aria-label={t("chat_window.copy")}
        >
          {copied ? (
            <Check size={20} className="mb-1" />
          ) : (
            <Copy size={20} className="mb-1" />
          )}
        </button>
      </div>
    </>
  );
}

function RegenerateMessage({ regenerateMessage, chatId }) {
  const { t } = useTranslation();
  if (!chatId) return null;
  return (
    <div className="mt-3 relative">
      <button
        onClick={() => regenerateMessage(chatId)}
        data-tooltip-id="regenerate-assistant-text"
        data-tooltip-content={t("chat_window.regenerate_response")}
        className="border-none text-zinc-300 light:text-slate-500"
        aria-label={t("chat_window.regenerate")}
      >
        <ArrowsClockwise size={20} className="mb-1" weight="fill" />
      </button>
    </div>
  );
}

export default memo(Actions);
