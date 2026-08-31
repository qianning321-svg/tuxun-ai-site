import { describe, expect, test } from "bun:test";

import { canSubmitAuthWithAgreement } from "../src/components/auth/AuthModal";
import { LEGAL_DOCUMENTS } from "../src/components/auth/LegalDialog";

const authSource = await Bun.file("src/components/auth/AuthModal.tsx").text();
const legalSource = await Bun.file("src/components/auth/LegalDialog.tsx").text();
const studioSource = await Bun.file("src/components/studio/Studio.tsx").text();
const topBarSource = await Bun.file("src/components/studio/TopBar.tsx").text();
const stylesSource = await Bun.file("src/styles.css").text();

describe("login legal agreement", () => {
  test("blocks login and registration until the user actively agrees", () => {
    expect(canSubmitAuthWithAgreement("login", false)).toBe(false);
    expect(canSubmitAuthWithAgreement("register", false)).toBe(false);
    expect(canSubmitAuthWithAgreement("login", true)).toBe(true);
    expect(canSubmitAuthWithAgreement("register", true)).toBe(true);
    expect(canSubmitAuthWithAgreement("reset", false)).toBe(true);
  });

  test("keeps the existing authentication request body unchanged", () => {
    expect(authSource).toContain('body: JSON.stringify(mode === "reset" ? { email: normalizedEmail } : { email: normalizedEmail, password })');
    expect(authSource).toContain('const [agreementAccepted, setAgreementAccepted] = useState(false)');
    expect(authSource).toContain('type="button" onClick={() => setLegalDocument("disclaimer")}');
    expect(authSource).toContain('type="button" onClick={() => setLegalDocument("rules")}');
  });

  test("keeps session probe failures outside the form submit error boundary", async () => {
    const authSource = await Bun.file("src/hooks/use-auth.tsx").text();
    expect(authSource).toContain('authProbeError: AuthProbeError | null');
    expect(authSource).toContain('setAuthStatus("unavailable")');
    expect(authSource).toContain('return false;');
    expect(authSource).toContain("Preserve the");
    expect(authSource).not.toContain('setMessage("网络连接失败，请重试。")');
    expect(authSource).not.toContain('setMessage("网络连接超时，请重试。")');
  });

  test("does not label a post-login profile refresh failure as a submit failure", () => {
    expect(authSource).toContain("const profileRefreshed = await refreshProfile()");
    expect(authSource).toContain("post-login profile refresh failed");
  });

  test("provides both complete in-app documents without legacy branding", () => {
    const serialized = JSON.stringify(LEGAL_DOCUMENTS);
    expect(LEGAL_DOCUMENTS.disclaimer.sections.length).toBeGreaterThanOrEqual(14);
    expect(LEGAL_DOCUMENTS.rules.sections).toHaveLength(10);
    expect(serialized).toContain("TuXun AI");
    expect(serialized).not.toMatch(/shuntu/i);
    expect(legalSource).toContain("overflow-y-auto");
    expect(legalSource).toContain("我已阅读");
  });

  test("removes the unauthenticated preview workspace path", () => {
    expect(authSource).not.toContain("onPreview");
    expect(authSource).not.toContain("PREVIEW");
    expect(authSource).not.toContain("暂不登录");
    expect(authSource).not.toContain("预览模式仅展示");
    expect(studioSource).not.toContain("previewMode");
    expect(studioSource).not.toContain("setPreviewMode");
    expect(studioSource).not.toContain("onPreview");
    expect(studioSource).toContain("const showAuth = !loading && (!session || forceAuth);");
  });

  test("workspace badges share the readable blue-violet treatment", () => {
    expect(authSource).toContain('className="mumo-workspace-badge inline-flex"');
    expect(topBarSource).toContain('className="mumo-workspace-badge hidden lg:inline-flex"');
    expect(stylesSource).toContain(".mumo-workspace-badge");
    expect(stylesSource).toContain("rgba(91, 78, 220, 0.18)");
    expect(stylesSource).toContain("#d9deff");
    expect(authSource).toContain("bg-indigo-950/45");
    expect(authSource).toContain("text-[#c4ccec]");
    expect(authSource).not.toContain("#eee4cf");
    expect(authSource).not.toContain("#6f5c38");
  });
});
