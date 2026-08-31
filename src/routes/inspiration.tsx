import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { InspirationPage } from "@/components/inspiration/InspirationPage";
import { TopBar } from "@/components/studio/TopBar";
import { AnnouncementCenter } from "@/components/studio/AnnouncementCenter";
import { AuthModal } from "@/components/auth/AuthModal";
import { useAuth } from "@/hooks/use-auth";
import { canAccessAnnouncements } from "@/components/studio/announcement-access";

export const Route = createFileRoute("/inspiration")({
  component: InspirationRoute,
  head: () => ({
    meta: [
      { title: "灵感广场 — 沐莫" },
      { name: "description", content: "浏览社区精选 AI 生成案例，一键复用提示词与生成参数。" },
      { property: "og:title", content: "灵感广场 — 沐莫" },
      { property: "og:description", content: "浏览社区精选 AI 生成案例，一键复用提示词与生成参数。" },
      { name: "twitter:title", content: "灵感广场 — 沐莫" },
      { name: "twitter:description", content: "浏览社区精选 AI 生成案例，一键复用提示词与生成参数。" },
    ],
  }),
});

function InspirationRoute() {
  const { session, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [forceAuth, setForceAuth] = useState(false);
  const [announcementsOpen, setAnnouncementsOpen] = useState(false);
  const showAuth = !loading && (!session || forceAuth);
  const canUseAnnouncements = canAccessAnnouncements(loading, session?.user.id);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className={showAuth ? "pointer-events-none select-none blur-sm" : ""}>
        <TopBar
          credits={profile?.credits ?? 0}
          onOpenHistory={() => navigate({ to: "/" })}
          onOpenAnnouncements={() => setAnnouncementsOpen(true)}
          onSwitchAccount={() => setForceAuth(true)}
        />
        <InspirationPage />
      </div>
      {!showAuth && (
        <AnnouncementCenter
          authenticated={canUseAnnouncements}
          open={announcementsOpen}
          onOpenChange={setAnnouncementsOpen}
        />
      )}
      {showAuth && <AuthModal onSuccess={() => setForceAuth(false)} />}
    </div>
  );
}
