export class WorkspaceAccessError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "WorkspaceAccessError";
    this.status = status;
  }
}
