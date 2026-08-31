export function canAccessAnnouncements(authLoading: boolean, userId: string | null | undefined) {
  return !authLoading && Boolean(userId);
}

export function shouldStartAnnouncementAutoOpen(canAccess: boolean, hasAutoOpened: boolean) {
  return canAccess && !hasAutoOpened;
}
