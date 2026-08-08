import type {
  GraphNode,
  IndustryPackManifest,
  RoleDefinition,
  ToolDefinition,
} from '@graph-native/contracts';
import type { GraphState } from './state.js';

export interface HandlerContext {
  readonly runId: string;
  readonly node: GraphNode;
  readonly state: Readonly<GraphState>;
  readonly signal: AbortSignal;
}

export type NodeHandler = (context: HandlerContext) => GraphState | Promise<GraphState>;
export type HandlerRegistry = Readonly<Record<string, NodeHandler>>;

export interface AgentUsage {
  readonly providerId?: string;
  readonly protocol?: string;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly costUsd?: number;
  readonly requestId?: string;
  readonly latencyMs?: number;
}

export interface AgentResult {
  readonly patch: GraphState;
  readonly usage?: AgentUsage;
}

export interface AgentContext extends HandlerContext {
  readonly role?: RoleDefinition;
  readonly toolIds: readonly string[];
  readonly tools: readonly ToolDefinition[];
  readonly resumeState?: unknown;
  invokeTool(toolId: string, input: unknown): Promise<unknown>;
}

export class ToolApprovalRequiredError extends Error {
  constructor(readonly approvalId: string) {
    super(`Tool approval "${approvalId}" is required.`);
    this.name = 'ToolApprovalRequiredError';
  }
}

export class AgentSuspensionError extends Error {
  constructor(
    readonly suspensionState: unknown,
    readonly reason: Error,
  ) {
    super(reason.message, { cause: reason });
    this.name = 'AgentSuspensionError';
  }
}

export interface AgentAdapter {
  run(context: AgentContext): AgentResult | Promise<AgentResult>;
}

export type AgentAdapterRegistry = Readonly<Record<string, AgentAdapter>>;

export interface ToolExecutionContext {
  readonly runId: string;
  readonly nodeId: string;
  readonly signal: AbortSignal;
  readonly secrets: Readonly<Record<string, string>>;
}

export interface ToolAdapter {
  readonly requiredSecrets?: readonly string[];
  execute(input: unknown, context: ToolExecutionContext): unknown | Promise<unknown>;
}

export type ToolAdapterRegistry = Readonly<Record<string, ToolAdapter>>;

export interface SecretProvider {
  get(name: string): string | undefined | Promise<string | undefined>;
}

export interface ToolAuthorizationRequest {
  readonly runId: string;
  readonly node: GraphNode;
  readonly role: RoleDefinition;
  readonly tool: ToolDefinition;
  readonly input: unknown;
}

export type ToolAuthorizationEffect = 'allow' | 'deny' | 'require-approval';

export interface ToolAuthorizationDecision {
  readonly effect: ToolAuthorizationEffect;
  readonly reason?: string;
  readonly ruleId?: string;
}

export type ToolAuthorizer = (
  request: ToolAuthorizationRequest,
) => boolean | ToolAuthorizationEffect | ToolAuthorizationDecision
  | Promise<boolean | ToolAuthorizationEffect | ToolAuthorizationDecision>;

export interface RuntimeBindings {
  readonly handlers?: HandlerRegistry;
  readonly agents?: AgentAdapterRegistry;
  readonly tools?: ToolAdapterRegistry;
  readonly pack?: IndustryPackManifest;
  readonly secrets?: SecretProvider;
  readonly authorizeTool?: ToolAuthorizer;
}
