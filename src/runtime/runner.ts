import { randomUUID } from 'crypto';
import { PipelineLoader } from './pipeline-loader';
import { FileRunStore } from './run-store';
import { StepRunner } from './step-runner';
import { computeRunnableSteps, findStepByExecutionName, getStepExecutionName, RunStateSnapshot } from './pipeline-engine';
import { PipelineDefinition, PipelineInputBinding, QueueItem, RunMetadata } from '../domain/types';

export interface RunnerOptions {
  dataDir: string;
  pipelinesDir: string;
  stepsDir: string;
}

export class PipelineRunner {
  private readonly runStore: FileRunStore;
  private readonly pipelineLoader: PipelineLoader;
  private readonly stepRunner: StepRunner;

  constructor(private readonly options: RunnerOptions) {
    this.runStore = new FileRunStore(options.dataDir);
    this.pipelineLoader = new PipelineLoader(options.pipelinesDir);
    this.stepRunner = new StepRunner(options.stepsDir);
  }

  getRunStore(): FileRunStore {
    return this.runStore;
  }

  async createRun(pipelineId: string, initialInputs: Record<string, unknown>, userId?: string): Promise<RunMetadata> {
    const pipeline = await this.pipelineLoader.load(pipelineId);
    const runId = randomUUID();
    const metadata: RunMetadata = {
      runId,
      pipelineId,
      createdAt: new Date().toISOString(),
      userId,
      status: 'pending',
    };
    await this.runStore.initRun(metadata, initialInputs);
    await this.enqueueRunnableSteps(pipeline, metadata, new Map(), new Set());
    return metadata;
  }

  async enqueueRunnableSteps(
    pipeline: PipelineDefinition,
    metadata: RunMetadata,
    availableOutputs: Map<string, Record<string, unknown>>,
    enqueuedSteps: Set<string>,
  ): Promise<void> {
    const pipelineInputs = await this.runStore.readPipelineInputs(metadata.pipelineId, metadata.runId);
    const completedSteps = await this.runStore.listCompletedSteps(metadata.pipelineId, metadata.runId);
    const snapshot: RunStateSnapshot = {
      completedSteps: new Set(completedSteps),
      enqueuedSteps,
      availableOutputs,
      pipelineInputs,
    };
    const runnable = computeRunnableSteps(pipeline, snapshot);
    for (const stepName of runnable) {
      if (enqueuedSteps.has(stepName)) {
        continue;
      }
      await this.runStore.appendQueueItem({
        pipelineId: metadata.pipelineId,
        runId: metadata.runId,
        stepId: stepName,
      });
      enqueuedSteps.add(stepName);
    }
  }

  async tick(): Promise<QueueItem | null> {
    const queueItem = await this.runStore.popQueueItem();
    if (!queueItem) {
      return null;
    }
    await this.executeQueueItem(queueItem);
    return queueItem;
  }

  private async executeQueueItem(queueItem: QueueItem): Promise<void> {
    const pipeline = await this.pipelineLoader.load(queueItem.pipelineId);
    const pipelineInputs = await this.runStore.readPipelineInputs(queueItem.pipelineId, queueItem.runId);
    const enqueuedSteps = await this.collectEnqueuedSteps(queueItem.pipelineId, queueItem.runId);
    const completedOutputs = await this.runStore.loadAllOutputs(queueItem.pipelineId, queueItem.runId);
    const stepConfig = findStepByExecutionName(pipeline, queueItem.stepId);
    if (!stepConfig) {
      throw new Error(`Step ${queueItem.stepId} not found in pipeline ${pipeline.id}`);
    }
    const manifest = await this.stepRunner.loadManifest(stepConfig.stepId, stepConfig.version);
    await this.runStore.updateRunStatus(queueItem.pipelineId, queueItem.runId, 'running');
    const inputs = await this.materializeInputs(stepConfig.inputs, pipelineInputs, completedOutputs);
    await this.runStore.writeStepInput(queueItem.pipelineId, queueItem.runId, queueItem.stepId, inputs);
    await this.runStore.appendLog(queueItem.pipelineId, queueItem.runId, queueItem.stepId, {
      level: 'info',
      message: 'Step started',
    });
    try {
      const result = await this.stepRunner.executeStep(manifest, inputs, (message, metadata) =>
        this.runStore.appendLog(queueItem.pipelineId, queueItem.runId, queueItem.stepId, {
          level: 'info',
          message,
          metadata,
        }),
      );
      await this.runStore.writeStepOutput(queueItem.pipelineId, queueItem.runId, queueItem.stepId, result.outputs);
      await this.runStore.appendLog(queueItem.pipelineId, queueItem.runId, queueItem.stepId, {
        level: 'info',
        message: 'Step completed',
      });
      const refreshedOutputs = await this.runStore.loadAllOutputs(queueItem.pipelineId, queueItem.runId);
      await this.enqueueRunnableSteps(pipeline, await this.runStore.readRunMetadata(queueItem.pipelineId, queueItem.runId), refreshedOutputs, enqueuedSteps);
      await this.evaluateRunCompletion(queueItem.pipelineId, queueItem.runId, pipeline);
    } catch (error: any) {
      await this.runStore.appendLog(queueItem.pipelineId, queueItem.runId, queueItem.stepId, {
        level: 'error',
        message: 'Step failed',
        metadata: { error: error?.message ?? String(error) },
      });
      await this.runStore.appendQueueItem(queueItem);
    }
  }

  private async collectEnqueuedSteps(pipelineId: string, runId: string): Promise<Set<string>> {
    const queue = await this.runStore.readQueue();
    const set = new Set<string>();
    for (const item of queue) {
      if (item.pipelineId === pipelineId && item.runId === runId) {
        set.add(item.stepId);
      }
    }
    return set;
  }

  private async materializeInputs(
    bindings: Record<string, PipelineInputBinding>,
    pipelineInputs: Record<string, unknown>,
    outputs: Map<string, Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const inputs: Record<string, unknown> = {};
    for (const [key, binding] of Object.entries(bindings)) {
      if (binding.source === 'pipeline') {
        inputs[key] = pipelineInputs[binding.key];
      } else if (binding.source === 'step') {
        const stepOutputs = outputs.get(binding.stepId ?? '');
        if (!stepOutputs) {
          throw new Error(`Missing outputs for dependency ${binding.stepId ?? ''}`);
        }
        const outputKey = binding.output ?? key;
        inputs[key] = stepOutputs[outputKey];
      }
    }
    return inputs;
  }

  private async evaluateRunCompletion(pipelineId: string, runId: string, pipeline: PipelineDefinition): Promise<void> {
    const completed = await this.runStore.listCompletedSteps(pipelineId, runId);
    const queue = await this.runStore.readQueue();
    const remaining = pipeline.steps
      .map(getStepExecutionName)
      .filter((name) => !completed.includes(name));
    const inQueue = queue.some((item) => item.pipelineId === pipelineId && item.runId === runId);
    if (remaining.length === 0 && !inQueue) {
      await this.runStore.updateRunStatus(pipelineId, runId, 'completed');
    }
  }
}
