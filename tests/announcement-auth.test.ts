import { describe, expect, test } from "bun:test";

import { canAccessAnnouncements, shouldStartAnnouncementAutoOpen } from "../src/components/studio/announcement-access";

const topBarSource = await Bun.file("src/components/studio/TopBar.tsx").text();
const centerSource = await Bun.file("src/components/studio/AnnouncementCenter.tsx").text();

describe("announcement authentication gate", () => {
  test("denies auth-loading and guest states without starting auto-open", () => {
    expect(canAccessAnnouncements(true, undefined)).toBe(false);
    expect(canAccessAnnouncements(true, "user-1")).toBe(false);
    expect(canAccessAnnouncements(false, null)).toBe(false);
    expect(shouldStartAnnouncementAutoOpen(false, false)).toBe(false);
  });

  test("allows one auto-open after login in the same page lifecycle", () => {
    expect(canAccessAnnouncements(false, "user-1")).toBe(true);
    expect(shouldStartAnnouncementAutoOpen(true, false)).toBe(true);
    expect(shouldStartAnnouncementAutoOpen(true, true)).toBe(false);
  });

  test("gates fetch, manual entry, stale async completion, and logout content", () => {
    expect(topBarSource).toContain("if (!canUseAnnouncements)");
    expect(topBarSource).toContain("if (active && Array.isArray(rows) && rows.length > 0)");
    expect(topBarSource).toContain("{canUseAnnouncements && <TopAction");
    expect(topBarSource).toContain("{canUseAnnouncements && <AnnouncementCenter authenticated");
    expect(centerSource).toContain("if (!authenticated || !open) return");
    expect(centerSource).toContain("setItems([])");
    expect(centerSource).toContain("setSelectedId(null)");
    expect(centerSource).toContain("open={authenticated && open}");
  });
});
