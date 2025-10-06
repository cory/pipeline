import * as path from 'path';
import { appendLine, ensureDir, pathExists, readJson, readJsonIfExists, resolvePath, writeJson } from '../utils/fs';
import { QueueItem, RunMetadata } from '../domain/types';
import * as fsp from 'fs/promises';

export class FileRunStore {
  constructor(private readonly rootDir: string) {}

  getRunDir(pipelineId: string, runId: string): string {
    return resolvePath(this.rootDir, 'runs', pipelineId, runId);
  }

  async initRun(metadata: RunMetadata, initialInputs: Record<string, unknown>): Promise<void> {
    const runDir = this.getRunDir(metadata.pipelineId, metadata.runId);
    await ensureDir(runDir);
    await writeJson(path.join(runDir, 'metadata.json'), metadata);
    await writeJson(path.join(runDir, 'inputs', 'pipeline.json'), initialInputs);
  }

  async updateRunStatus(pipelineId: string, runId: string, status: RunMetadata['status']): Promise<void> {
    const runDir = this.getRunDir(pipelineId, runId);
    const metadataPath = path.join(runDir, 'metadata.json');
    const metadata = await readJson<RunMetadata>(metadataPath);
    metadata.status = status;
    await writeJson(metadataPath, metadata);
  }

  async readRunMetadata(pipelineId: string, runId: string): Promise<RunMetadata> {
    const runDir = this.getRunDir(pipelineId, runId);
    return readJson<RunMetadata>(path.join(runDir, 'metadata.json'));
  }

  async writeStepInput(pipelineId: string, runId: string, stepId: string, inputs: Record<string, unknown>): Promise<void> {
    const runDir = this.getRunDir(pipelineId, runId);
    await writeJson(path.join(runDir, 'inputs', `${stepId}.json`), inputs);
  }

  async writeStepOutput(pipelineId: string, runId: string, stepId: string, outputs: Record<string, unknown>): Promise<void> {
    const runDir = this.getRunDir(pipelineId, runId);
    await writeJson(path.join(runDir, 'outputs', `${stepId}.json`), outputs);
  }

  async appendLog(pipelineId: string, runId: string, stepId: string, entry: Record<string, unknown>): Promise<void> {
    const runDir = this.getRunDir(pipelineId, runId);
    const logPath = path.join(runDir, 'logs', `${stepId}.ndjson`);
    await appendLine(logPath, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }));
  }

  async readStepOutput(pipelineId: string, runId: string, stepId: string): Promise<Record<string, unknown> | null> {
    const runDir = this.getRunDir(pipelineId, runId);
    return readJsonIfExists<Record<string, unknown>>(path.join(runDir, 'outputs', `${stepId}.json`));
  }

  async readPipelineInputs(pipelineId: string, runId: string): Promise<Record<string, unknown>> {
    const runDir = this.getRunDir(pipelineId, runId);
    return readJson<Record<string, unknown>>(path.join(runDir, 'inputs', 'pipeline.json'));
  }

  async readStepInput(pipelineId: string, runId: string, stepId: string): Promise<Record<string, unknown> | null> {
    const runDir = this.getRunDir(pipelineId, runId);
    return readJsonIfExists<Record<string, unknown>>(path.join(runDir, 'inputs', `${stepId}.json`));
  }

  async listCompletedSteps(pipelineId: string, runId: string): Promise<string[]> {
    const runDir = this.getRunDir(pipelineId, runId);
    const outputsDir = path.join(runDir, 'outputs');
    const exists = await pathExists(outputsDir);
    if (!exists) {
      return [];
    }
    const entries = await fsp.readdir(outputsDir, { withFileTypes: true });
    return entries
      .filter((entry: any) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry: any) => entry.name.replace(/\.json$/, ''));
  }

  async loadAllOutputs(pipelineId: string, runId: string): Promise<Map<string, Record<string, unknown>>> {
    const map = new Map<string, Record<string, unknown>>();
    const completed = await this.listCompletedSteps(pipelineId, runId);
    for (const stepName of completed) {
      const data = await readJson<Record<string, unknown>>(path.join(this.getRunDir(pipelineId, runId), 'outputs', `${stepName}.json`));
      map.set(stepName, data);
    }
    return map;
  }

  getQueuePath(): string {
    return resolvePath(this.rootDir, 'queue.json');
  }

  async readQueue(): Promise<QueueItem[]> {
    const queue = await readJsonIfExists<QueueItem[]>(this.getQueuePath());
    return queue ?? [];
  }

  async writeQueue(queue: QueueItem[]): Promise<void> {
    await writeJson(this.getQueuePath(), queue);
  }

  async appendQueueItem(item: QueueItem): Promise<void> {
    const queue = await this.readQueue();
    queue.push(item);
    await this.writeQueue(queue);
  }

  async popQueueItem(): Promise<QueueItem | undefined> {
    const queue = await this.readQueue();
    const item = queue.shift();
    await this.writeQueue(queue);
    return item;
  }

  async logSystem(message: string, metadata?: Record<string, unknown>): Promise<void> {
    const logPath = resolvePath(this.rootDir, 'system.log');
    await appendLine(logPath, JSON.stringify({ timestamp: new Date().toISOString(), message, metadata }));
  }
}
