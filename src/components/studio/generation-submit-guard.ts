type SubmissionFingerprintInput = {
  modelKey: string;
  prompt: string;
  aspectRatio: string;
  quality: string;
  referenceImageIds: string[];
};

type SubmissionTask = {
  taskId: string;
  status: string;
};

export function createGenerationSubmissionFingerprint(
  input: SubmissionFingerprintInput,
): string {
  return JSON.stringify([
    input.modelKey,
    input.prompt,
    input.referenceImageIds.length === 0 ? "text_to_image" : "image_to_image",
    input.aspectRatio,
    input.quality,
    input.referenceImageIds,
  ]);
}

function isDefinitiveSubmissionFailure(error: unknown): boolean {
  const candidate = error as { code?: unknown; status?: unknown } | null;
  const status = typeof candidate?.status === "number" ? candidate.status : null;
  if (status !== null) return status >= 400 && status < 500 && status !== 408 && status !== 429;

  const code = typeof candidate?.code === "string" ? candidate.code : "";
  return code.length > 0 && !code.startsWith("NETWORK_") && !code.startsWith("PROVIDER_");
}

export class GenerationSubmitGuard {
  private locked = false;
  private activeTaskId: string | null = null;
  private pendingKey: string | null = null;
  private pendingFingerprint: string | null = null;

  acquire(fingerprint: string, createKey: () => string): string | null {
    if (this.locked) return null;
    this.locked = true;
    this.activeTaskId = null;
    if (this.pendingFingerprint !== fingerprint) {
      this.pendingFingerprint = fingerprint;
      this.pendingKey = createKey();
    }
    return this.pendingKey;
  }

  confirmTask(task: SubmissionTask): void {
    this.pendingKey = null;
    this.pendingFingerprint = null;
    if (task.status === "failed" || task.status === "succeeded" || task.status === "canceled") {
      this.release();
      return;
    }
    this.activeTaskId = task.taskId;
  }

  handleRequestError(error: unknown): void {
    if (isDefinitiveSubmissionFailure(error)) {
      this.pendingKey = null;
      this.pendingFingerprint = null;
    }
    this.release();
  }

  releaseForValidationFailure(): void {
    this.pendingKey = null;
    this.pendingFingerprint = null;
    this.release();
  }

  completeTask(taskId: string): void {
    if (this.activeTaskId === taskId) this.release();
  }

  reset(): void {
    this.pendingKey = null;
    this.pendingFingerprint = null;
    this.release();
  }

  private release(): void {
    this.locked = false;
    this.activeTaskId = null;
  }
}

export async function submitStudioGeneration<T extends SubmissionTask>(options: {
  guard: GenerationSubmitGuard;
  fingerprint: string;
  createKey: () => string;
  createTask: (idempotencyKey: string) => Promise<T>;
  onStarted?: () => void;
}): Promise<T | null> {
  const idempotencyKey = options.guard.acquire(options.fingerprint, options.createKey);
  if (!idempotencyKey) return null;

  try {
    options.onStarted?.();
    const task = await options.createTask(idempotencyKey);
    options.guard.confirmTask(task);
    return task;
  } catch (error) {
    options.guard.handleRequestError(error);
    throw error;
  }
}
