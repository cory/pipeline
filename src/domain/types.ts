export interface ToolManifest {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  module: string;
}

export interface StepManifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  entry: string;
  inputs: string[];
  outputs: string[];
  tools?: ToolManifest[];
}

export interface StepModule {
  manifest: StepManifest;
  run(context: StepRunContext): Promise<StepRunResult> | StepRunResult;
}

export interface StepRunContext {
  inputs: Record<string, unknown>;
  tools: Record<string, ToolHandler>;
  log: (message: string, metadata?: Record<string, unknown>) => Promise<void> | void;
}

export interface StepRunResult {
  outputs: Record<string, unknown>;
  logs?: Array<{
    level: 'info' | 'warn' | 'error';
    message: string;
    metadata?: Record<string, unknown>;
  }>;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

export interface PipelineInputBinding {
  source: 'pipeline' | 'step';
  key: string;
  stepId?: string;
  output?: string;
}

export interface PipelineStepConfig {
  stepId: string;
  version: string;
  alias?: string;
  inputs: Record<string, PipelineInputBinding>;
}

export interface PipelineDefinition {
  id: string;
  name: string;
  description?: string;
  steps: PipelineStepConfig[];
}

export interface RunMetadata {
  runId: string;
  pipelineId: string;
  createdAt: string;
  userId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  notes?: string;
}

export interface QueueItem {
  pipelineId: string;
  runId: string;
  stepId: string;
}
