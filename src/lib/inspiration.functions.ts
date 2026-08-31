import { createServerFn } from "@tanstack/react-start";

export type CaseRow = {
  id: string;
  user_id: string;
  title: string;
  image_url: string;
  prompt: string;
  model_key: string | null;
  model_name: string | null;
  aspect_ratio: string | null;
  size: string | null;
  style_id: string | null;
  tags: string[];
  views: number;
  likes_count: number;
  favorites_count: number;
  created_at: string;
  author_name?: string | null;
  liked?: boolean;
  favorited?: boolean;
};

function placeholderServerFn(value: unknown): any {
  return createServerFn({ method: "POST" })
    .inputValidator((data: unknown) => data)
    .handler(async () => value);
}

function pendingServerFn(name: string): any {
  return createServerFn({ method: "POST" })
    .inputValidator((data: unknown) => data)
    .handler(async () => {
      throw new Error(`Not implemented: D1 migration pending (${name})`);
    });
}

export const listCases = placeholderServerFn({ cases: [], hasMore: false });
export const listCaseFacets = placeholderServerFn({ tags: [], styles: [], models: [] });
export const getCaseDetail = pendingServerFn("getCaseDetail");
export const incrementCaseView = pendingServerFn("incrementCaseView");
export const toggleCaseLike = pendingServerFn("toggleCaseLike");
export const toggleCaseFavorite = pendingServerFn("toggleCaseFavorite");
export const addCaseComment = pendingServerFn("addCaseComment");
export const publishCase = pendingServerFn("publishCase");
