export type HistoryItemIdentity = {
  id: string;
  generationTaskId?: string | null;
};

export function mergeHistoryItems<T>(previous: T[], incoming: T[], append: boolean): T[] {
  return append ? [...previous, ...incoming] : incoming;
}

export function historyItemKey(item: HistoryItemIdentity): string {
  return item.generationTaskId ?? item.id;
}
