import * as path from 'path';
import * as fsp from 'fs/promises';
import { StepRunner } from './step-runner';
import { StepManifest } from '../domain/types';
import { ensureDir, pathExists, readJson, writeJson } from '../utils/fs';

interface EvaluationScenario {
  name: string;
  description?: string;
  inputs: Record<string, unknown>;
  expected?: Record<string, unknown>;
}

interface EvaluationResult {
  scenario: string;
  success: boolean;
  durationMs: number;
  error?: string;
  expected?: Record<string, unknown>;
  actual?: Record<string, unknown>;
}

export class StepEvaluator {
  private readonly stepRunner: StepRunner;

  constructor(private readonly stepsDir: string, private readonly dataDir: string) {
    this.stepRunner = new StepRunner(stepsDir);
  }

  private getStepDir(stepId: string, version: string): string {
    return path.join(this.stepsDir, stepId, version);
  }

  private async loadScenarios(stepDir: string): Promise<EvaluationScenario[]> {
    const evalDir = path.join(stepDir, 'eval');
    const exists = await pathExists(evalDir);
    if (!exists) {
      return [];
    }
    const files = await fsp.readdir(evalDir);
    const scenarios: EvaluationScenario[] = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        const scenario = await readJson<EvaluationScenario>(path.join(evalDir, file));
        scenarios.push(scenario);
      }
    }
    return scenarios;
  }

  async evaluate(stepId: string, version: string): Promise<EvaluationResult[]> {
    const manifest = await this.stepRunner.loadManifest(stepId, version);
    const scenarios = await this.loadScenarios(this.getStepDir(stepId, version));
    const results: EvaluationResult[] = [];
    for (const scenario of scenarios) {
      const start = Date.now();
      try {
        const result = await this.stepRunner.executeStep(manifest, scenario.inputs, () => undefined);
        const duration = Date.now() - start;
        const actualOutputs = result.outputs;
        let success = true;
        let error: string | undefined;
        if (scenario.expected) {
          const expectedJson = JSON.stringify(scenario.expected);
          const actualJson = JSON.stringify(actualOutputs);
          success = expectedJson === actualJson;
          if (!success) {
            error = `Expected ${expectedJson} but received ${actualJson}`;
          }
        }
        results.push({
          scenario: scenario.name,
          success,
          durationMs: duration,
          expected: scenario.expected,
          actual: actualOutputs,
          error,
        });
      } catch (err: any) {
        results.push({
          scenario: scenario.name,
          success: false,
          durationMs: Date.now() - start,
          error: err?.message ?? String(err),
        });
      }
    }
    await this.persistReport(stepId, version, manifest, results);
    return results;
  }

  private async persistReport(stepId: string, version: string, manifest: StepManifest, results: EvaluationResult[]): Promise<void> {
    const reportDir = path.join(this.dataDir, 'steps', stepId, version, 'eval');
    await ensureDir(reportDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(reportDir, `${timestamp}.json`);
    await writeJson(reportPath, {
      stepId,
      version,
      manifest: {
        id: manifest.id,
        version: manifest.version,
        name: manifest.name,
        description: manifest.description,
      },
      generatedAt: new Date().toISOString(),
      results,
    });
  }
}
