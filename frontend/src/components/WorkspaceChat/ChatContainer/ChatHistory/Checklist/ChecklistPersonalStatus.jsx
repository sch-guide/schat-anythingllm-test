export default function ChecklistPersonalStatus({ error, reload, remaining }) {
  if (error)
    return (
      <div role="status" className="px-3 py-1 text-xs text-amber-500">
        {error === "CONFLICT"
          ? "다른 창에서 수정되었습니다. 최신 내용을 다시 불러와 주세요."
          : error === "EXPIRED"
            ? "보관 시간이 지나 삭제되었습니다."
            : "체크·메모를 저장하거나 불러오지 못했습니다."}
        <button
          type="button"
          className="ml-2 underline"
          onClick={() => {
            if (
              window.confirm(
                "저장되지 않은 입력을 버리고 서버 내용을 다시 불러올까요?"
              )
            )
              reload();
          }}
        >
          다시 불러오기
        </button>
      </div>
    );
  return remaining ? (
    <p className="m-0 px-3 py-1 text-xs text-zinc-400">{remaining}</p>
  ) : null;
}
