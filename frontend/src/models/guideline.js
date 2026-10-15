import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

// 직원 메뉴 "지침서 원본 보기"
// 관리자가 '지침서 원본 자료'에 올린 PDF만 보인다(ref=자료 번호). 챗봇용 문서는 보이지 않는다.
const Guideline = {
  /** [{ kind, ref, title, pageCount }] */
  documents: async function (workspaceSlug) {
    const response = await fetch(
      `${API_BASE}/workspace/${encodeURIComponent(workspaceSlug)}/guideline-originals`,
      { headers: baseHeaders(), cache: "no-store" }
    );
    if (!response.ok) throw new Error("지침서 목록을 불러오지 못했습니다.");
    const data = await response.json();
    if (!Array.isArray(data?.documents))
      throw new Error("지침서 목록을 불러오지 못했습니다.");
    return data.documents;
  },
  /** 원본 PDF 주소(부분 전송용)와 인증 헤더 */
  source: function (_workspaceSlug, doc) {
    return {
      url: `${API_BASE}/guideline-library/${encodeURIComponent(doc.ref)}/pdf`,
      httpHeaders: baseHeaders(),
    };
  },
};

export default Guideline;
