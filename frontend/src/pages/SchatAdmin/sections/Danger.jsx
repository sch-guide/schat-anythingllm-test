import DeleteWorkspace from "@/pages/WorkspaceSettings/GeneralAppearance/DeleteWorkspace";
import { Card, Loading } from "../ui";

// The existing delete flow (browser confirmation dialog included) is reused
// unchanged; it is only moved here from the old workspace settings screen.
export default function DangerSection({ workspace }) {
  return (
    <Card
      tone="danger"
      title="작업 공간 삭제"
      description="작업 공간과 그 안의 대화·검색 데이터가 모두 삭제되며 되돌릴 수 없습니다. 원본 문서 파일은 남지만 다시 등록해야 검색할 수 있습니다."
    >
      {workspace ? <DeleteWorkspace workspace={workspace} /> : <Loading />}
    </Card>
  );
}
