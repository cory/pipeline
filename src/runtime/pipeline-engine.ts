import { PipelineDefinition, PipelineStepConfig } from '../domain/types';

export interface RunStateSnapshot {
  completedSteps: Set<string>;
  enqueuedSteps: Set<string>;
  availableOutputs: Map<string, Record<string, unknown>>;
  pipelineInputs: Record<string, unknown>;
}

export function getStepExecutionName(step: PipelineStepConfig): string {
  return step.alias ?? step.stepId;
}

export function findStepByExecutionName(pipeline: PipelineDefinition, executionName: string): PipelineStepConfig | undefined {
  return pipeline.steps.find((step) => getStepExecutionName(step) === executionName);
}

export function dependenciesSatisfied(step: PipelineStepConfig, snapshot: RunStateSnapshot): boolean {
  const execName = getStepExecutionName(step);
  if (snapshot.completedSteps.has(execName)) {
    return false;
  }
  if (snapshot.enqueuedSteps.has(execName)) {
    return false;
  }
  for (const [inputKey, binding] of Object.entries(step.inputs)) {
    if (binding.source === 'pipeline') {
      if (!(binding.key in snapshot.pipelineInputs)) {
        return false;
      }
    } else if (binding.source === 'step') {
      const dependencyName = binding.stepId ?? '';
      const dependencyOutputKey = binding.output ?? inputKey;
      const outputs = snapshot.availableOutputs.get(dependencyName);
      if (!outputs) {
        return false;
      }
      if (!(dependencyOutputKey in outputs)) {
        return false;
      }
    }
  }
  return true;
}

export function computeRunnableSteps(pipeline: PipelineDefinition, snapshot: RunStateSnapshot): string[] {
  const runnable: string[] = [];
  for (const step of pipeline.steps) {
    if (dependenciesSatisfied(step, snapshot)) {
      runnable.push(getStepExecutionName(step));
    }
  }
  return runnable;
}
