import { createFileRoute } from "@tanstack/react-router";
import { getSessionFromRequest } from "@/lib/auth";
import {
  AdminProviderDiagnosticError,
  adminDiagnoseGenerationProviderTask,
} from "@/lib/admin.server";
import type { ProviderTaskDiagnostic } from "@/lib/providers/vibelearning-image.server";
import { apiError, jsonResponse } from "@/lib/placeholder-response";

const GENERATION_TASK_ID_PARAM = "generationTaskId";
const GENERATION_TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function diagnosticError(error: unknown): Response {
  if (error instanceof AdminProviderDiagnosticError) {
    const status = error.code === "GENERATION_TASK_NOT_FOUND" ? 404 : 400;
    return apiError(error.code, "供应商任务诊断不可用。", status);
  }
  return apiError("ADMIN_DIAGNOSTIC_FORBIDDEN", "无权执行此操作。", 403);
}

type DiagnosticDependencies = {
  getSession: typeof getSessionFromRequest;
  diagnose: (input: { generationTaskId: string }) => Promise<ProviderTaskDiagnostic>;
};

export async function handleProviderTaskDiagnosticRequest(
  request: Request,
  dependencies: DiagnosticDependencies = {
    getSession: getSessionFromRequest,
    diagnose: adminDiagnoseGenerationProviderTask,
  },
): Promise<Response> {
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => key !== GENERATION_TASK_ID_PARAM)) {
    return apiError("INVALID_DIAGNOSTIC_QUERY", "诊断参数无效。", 400);
  }
  const generationTaskId = url.searchParams.get(GENERATION_TASK_ID_PARAM) ?? "";
  if (!GENERATION_TASK_ID_PATTERN.test(generationTaskId)) {
    return apiError("INVALID_DIAGNOSTIC_QUERY", "诊断参数无效。", 400);
  }

  const session = await dependencies.getSession(request);
  if (!session) return apiError("ADMIN_DIAGNOSTIC_FORBIDDEN", "无权执行此操作。", 401);

  try {
    const diagnostic = await dependencies.diagnose({ generationTaskId });
    return jsonResponse({ ok: true, diagnostic }, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    return diagnosticError(error);
  }
}

export const Route = createFileRoute("/api/admin/provider-task-diagnostic")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return handleProviderTaskDiagnosticRequest(request);
      },
    },
  },
});
