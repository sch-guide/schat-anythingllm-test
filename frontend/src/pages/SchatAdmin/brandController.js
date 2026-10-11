import { checkLogoFile, readLogoFile } from "@/utils/schatBrand";

export function createBrandEditor(api) {
  let state = {
    loading: true,
    saving: null,
    brand: null,
    draft: null,
    error: "",
    message: "",
  };
  const listeners = new Set();
  let selection = 0;
  const emit = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  const copy = (value) => JSON.parse(JSON.stringify(value));
  return {
    getSnapshot: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async start() {
      try {
        const brand = await api.read();
        emit({ loading: false, brand, draft: copy(brand), error: "" });
      } catch {
        emit({
          loading: false,
          error: "브랜드 설정을 불러오지 못했습니다. 다시 불러와 주세요.",
        });
      }
    },
    change(section, value) {
      emit({
        draft: { ...state.draft, [section]: value },
        error: "",
        message: "",
      });
    },
    async chooseLogo(file, read = readLogoFile) {
      if (!file) return;
      const token = ++selection;
      try {
        checkLogoFile(file);
        const value = await read(file);
        if (token === selection) this.change("logo", value);
      } catch (error) {
        if (token === selection)
          emit({ error: error.message || "로고 파일을 읽지 못했습니다." });
      }
    },
    async save(section, reset = false) {
      if (state.saving || !state.brand) return;
      if (section === "logo") ++selection;
      emit({ saving: section, error: "", message: "" });
      try {
        const value =
          section === "welcome"
            ? {
                ...state.draft.welcome,
                examples: state.draft.welcome.examples
                  .map((v) => v.trim())
                  .filter(Boolean),
              }
            : state.draft[section];
        const brand = await api.save(section, value, reset);
        emit({
          brand,
          draft: { ...state.draft, [section]: copy(brand[section]) },
          message: reset ? "원래 설정으로 되돌렸습니다." : "저장했습니다.",
        });
        window.dispatchEvent(
          new CustomEvent("schat-brand-updated", { detail: brand })
        );
      } catch {
        emit({
          error:
            "저장하지 못했습니다. 기존 설정은 유지되며 입력 내용은 다시 저장할 수 있습니다.",
        });
      } finally {
        emit({ saving: null });
      }
    },
  };
}
