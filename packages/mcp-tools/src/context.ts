export interface ToolAuthContext {
  userId?: string;
}

export class UnauthorizedToolError extends Error {
  constructor(toolName: string) {
    super(`${toolName} requires an authenticated user`);
    this.name = "UnauthorizedToolError";
  }
}

export function requireUserId(ctx: ToolAuthContext | undefined, toolName: string): string {
  if (!ctx?.userId) {
    throw new UnauthorizedToolError(toolName);
  }
  return ctx.userId;
}
