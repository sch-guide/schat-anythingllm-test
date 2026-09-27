import React, { useState, useEffect, memo } from "react";
import { X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import Workspace from "../../../models/workspace";
import { isMobileOnly } from "react-device-detect";
import useUser from "../../../hooks/useUser";
import DocumentSettings from "./Documents";
import Modal, {
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalPrimaryButton,
} from "@/components/lib/Modal";
import { EmbeddingProgressProvider } from "@/EmbeddingProgressContext";
import { useModalEscape } from "@/hooks/useModalEscape";

const noop = () => {};
const ManageWorkspace = ({ hideModal = noop, providedSlug = null }) => {
  const { t } = useTranslation();
  const { slug } = useParams();
  const [workspace, setWorkspace] = useState(null);

  useEffect(() => {
    async function fetchWorkspace() {
      const workspace = await Workspace.bySlug(providedSlug ?? slug);
      setWorkspace(workspace);
    }
    fetchWorkspace();
  }, [providedSlug, slug]);

  if (!workspace) return null;

  if (isMobileOnly) {
    return (
      <Modal isOpen={true} onClose={hideModal} size="md">
        <ModalHeader
          title={`${t("connectors.manage.editing")} "${workspace.name}"`}
          onClose={hideModal}
        />
        <ModalBody>
          <p className="text-zinc-300 light:text-slate-700">
            {t("connectors.manage.desktop-only")}
          </p>
        </ModalBody>
        <ModalFooter className="justify-end">
          <ModalPrimaryButton type="button" onClick={hideModal}>
            {t("connectors.manage.dismiss")}
          </ModalPrimaryButton>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <div className="w-screen h-screen fixed top-0 left-0 flex justify-center items-center z-99">
      <div className="backdrop h-full w-full absolute top-0 z-10" />
      <div className="absolute max-h-full w-fit transition duration-300 z-20 md:overflow-y-auto py-10">
        <div className="relative bg-zinc-900 light:bg-white rounded-[12px] shadow border-2 border-zinc-800 light:border-slate-300">
          <div className="flex items-start justify-between p-2 rounded-t relative">
            <button
              onClick={hideModal}
              type="button"
              className="z-29 border-none bg-transparent rounded-lg text-sm p-1.5 ml-auto inline-flex items-center text-zinc-50 light:text-slate-900 hover:bg-zinc-800 light:hover:bg-slate-100 transition-colors duration-200"
            >
              <X size={20} weight="bold" />
            </button>
          </div>

          <EmbeddingProgressProvider>
            <DocumentSettings workspace={workspace} />
          </EmbeddingProgressProvider>
        </div>
      </div>
    </div>
  );
};

export default memo(ManageWorkspace);

export function useManageWorkspaceModal() {
  const { user } = useUser();
  const [showing, setShowing] = useState(false);

  function showModal() {
    if (user?.role !== "default") {
      setShowing(true);
    }
  }

  function hideModal() {
    setShowing(false);
  }

  useModalEscape(showing, hideModal);

  return { showing, showModal, hideModal };
}
