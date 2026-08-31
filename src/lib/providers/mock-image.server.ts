import "@tanstack/react-start/server-only";

import type {
  ImageGenerationInput,
  ImageProvider,
  ProviderTaskCreated,
  ProviderTaskResult,
} from "./image-provider.server";

const MOCK_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const MOCK_POLL_COUNTS = new Map<string, number>();

export type MockImageProviderOptions = {
  createFailure?: boolean;
  finalStatus?: "succeeded" | "failed";
};

export class MockImageProvider implements ImageProvider {
  readonly key = "mock";
  readonly capabilities = {
    modes: ["text-to-image", "image-to-image"],
    maxReferenceImages: 5,
    qualities: ["1K", "2K", "4K"],
  } as const;
  constructor(private readonly options: MockImageProviderOptions = {}) {}

  async createTask(input: ImageGenerationInput): Promise<ProviderTaskCreated> {
    if (this.options.createFailure) throw new Error("Mock provider create failure");
    return input.referenceImages.length === 0
      ? this.createTextToImageTask(input)
      : this.createImageToImageTask(input);
  }

  async pollTask(task: Pick<ProviderTaskCreated, "taskId" | "mode">): Promise<ProviderTaskResult> {
    return task.mode === "text-to-image"
      ? this.pollTextToImageTask(task.taskId)
      : this.pollImageToImageTask(task.taskId);
  }

  async getTask(task: Pick<ProviderTaskCreated, "taskId" | "mode">): Promise<ProviderTaskResult> {
    return this.pollTask(task);
  }

  async createTextToImageTask(_input: ImageGenerationInput): Promise<ProviderTaskCreated> {
    return {
      taskId: `mock-text-${crypto.randomUUID()}`,
      mode: "text-to-image",
      status: "queued",
    };
  }

  async createImageToImageTask(_input: ImageGenerationInput): Promise<ProviderTaskCreated> {
    return {
      taskId: `mock-image-${crypto.randomUUID()}`,
      mode: "image-to-image",
      status: "queued",
    };
  }

  async pollTextToImageTask(taskId: string): Promise<ProviderTaskResult> {
    return this.nextResult(taskId);
  }

  async pollImageToImageTask(taskId: string): Promise<ProviderTaskResult> {
    return this.nextResult(taskId);
  }

  private nextResult(taskId: string): ProviderTaskResult {
    const polls = (MOCK_POLL_COUNTS.get(taskId) ?? 0) + 1;
    MOCK_POLL_COUNTS.set(taskId, polls);
    if (polls === 1) return { taskId, status: "processing", images: [] };
    MOCK_POLL_COUNTS.delete(taskId);
    if (this.options.finalStatus === "failed") {
      return {
        taskId,
        status: "failed",
        images: [],
        error: {
          code: "PROVIDER_TASK_FAILED",
          message: "Mock provider task failed",
          retryable: false,
        },
      };
    }
    return {
      taskId,
      status: "completed",
      images: [
        {
          kind: "base64",
          bytes: Uint8Array.from(MOCK_PNG_BYTES),
          mimeType: "image/png",
        },
      ],
    };
  }
}
