import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import useUser from "@/hooks/useUser";
import { canEditMessage, canManageAnswers } from "@/utils/answerActions.mjs";

const EDIT_EVENT = "toggle-message-edit";
const DELETE_EVENT = "delete-message";

const MessageActionsContext = createContext(null);

/**
 * Provider that centralizes edit/delete event listeners for all messages.
 * Instead of each message registering its own window listener (O(n) listeners),
 * this provider registers just 2 listeners total and dispatches to messages via context.
 */
export function MessageActionsProvider({ children }) {
  const { user } = useUser();
  const [editingMessage, setEditingMessage] = useState(null);
  const [deletedMessages, setDeletedMessages] = useState(new Set());

  useEffect(() => {
    function handleEditEvent(e) {
      const { chatId, role } = e.detail || {};
      if (!chatId || !canEditMessage(user, role)) return;

      setEditingMessage((prev) => {
        if (prev?.chatId === chatId && prev?.role === role) {
          return null;
        }
        return { chatId, role };
      });
    }

    function handleDeleteEvent(e) {
      const { chatId } = e.detail || {};
      if (!chatId || !canManageAnswers(user)) return;

      setDeletedMessages((prev) => {
        const next = new Set(prev);
        next.add(chatId);
        return next;
      });
    }

    window.addEventListener(EDIT_EVENT, handleEditEvent);
    window.addEventListener(DELETE_EVENT, handleDeleteEvent);

    return () => {
      window.removeEventListener(EDIT_EVENT, handleEditEvent);
      window.removeEventListener(DELETE_EVENT, handleDeleteEvent);
    };
  }, [user]);

  const isEditing = useCallback(
    (chatId, role) => {
      return (
        canEditMessage(user, role) &&
        editingMessage?.chatId === chatId &&
        editingMessage?.role === role
      );
    },
    [editingMessage, user]
  );

  const isDeleted = useCallback(
    (chatId) => {
      return deletedMessages.has(chatId);
    },
    [deletedMessages]
  );

  const clearEditing = useCallback(() => {
    setEditingMessage(null);
  }, []);

  return (
    <MessageActionsContext.Provider
      value={{ editingMessage, isEditing, isDeleted, clearEditing }}
    >
      {children}
    </MessageActionsContext.Provider>
  );
}

export function useMessageActionsContext() {
  return useContext(MessageActionsContext);
}

export { EDIT_EVENT, DELETE_EVENT };
