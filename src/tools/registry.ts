import type { ToolDefinition, ToolExecutionResult } from "@/lib/toolCalling";
import {
  GET_PROJECT_STATUS_TOOL,
  GET_PROJECT_STATUS_METADATA,
  executeGetProjectStatus,
} from "@/tools/projectStatusTool";

export interface ToolMetadata {
  /**
   * Whether the tool is read-only and makes no mutations to external or internal state.
   */
  readonly readOnly: boolean;
  /**
   * Whether the tool performs destructive operations (e.g. deletion, overwriting).
   */
  readonly destructive: boolean;
  /**
   * Whether executing the tool requires authentication or elevated permissions.
   */
  readonly requiresAuth: boolean;
  /**
   * Whether repeated identical invocations produce the same result and state.
   */
  readonly idempotent: boolean;
}

export type ToolHandler = (rawArguments: string) => ToolExecutionResult;

export interface RegisteredTool {
  readonly definition: ToolDefinition;
  readonly handler: ToolHandler;
  readonly metadata: ToolMetadata;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  /**
   * Registers a tool. Throws if a tool with the same name is already registered.
   */
  register(tool: RegisteredTool): this {
    const name = tool.definition.function.name;
    if (!name || typeof name !== "string") {
      throw new Error("Tool definition must include a valid function name.");
    }
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered.`);
    }
    this.tools.set(name, tool);
    return this;
  }

  /**
   * Retrieves a registered tool by its function name.
   */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Checks whether a tool name is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Returns provider-facing tool definitions for all registered tools.
   */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values(), (tool) => tool.definition);
  }

  /**
   * Returns all registered tools.
   */
  getAll(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Resolves and executes a tool through the registry.
   * If the tool is unknown, returns a safe failure without executing anything.
   */
  execute(name: string, rawArguments: string): ToolExecutionResult {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, error: "Unknown tool. No tool was executed." };
    }

    try {
      return tool.handler(rawArguments);
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "The tool could not be executed.",
      };
    }
  }
}

/** Central tool registry instance for the application. */
export const toolRegistry = new ToolRegistry();

// Register the existing get_project_status tool.
toolRegistry.register({
  definition: GET_PROJECT_STATUS_TOOL,
  handler: executeGetProjectStatus,
  metadata: GET_PROJECT_STATUS_METADATA,
});

/**
 * Model-facing list of tools derived from the central tool registry.
 * Derived directly from the registry to avoid list drift.
 */
export const REGISTERED_TOOLS: readonly ToolDefinition[] = Object.freeze(
  toolRegistry.getDefinitions()
);

/**
 * Resolves and executes a tool through the central registry.
 */
export function executeRegisteredTool(
  toolName: string,
  rawArguments: string
): ToolExecutionResult {
  return toolRegistry.execute(toolName, rawArguments);
}
