import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import { StepManifest, StepRunContext, StepRunResult, ToolHandler } from '../domain/types';
import { readJson, readText } from '../utils/fs';

export class StepRunner {
  constructor(private readonly stepsRoot: string) {}

  private getStepDir(stepId: string, version: string): string {
    return path.join(this.stepsRoot, stepId, version);
  }

  async loadManifest(stepId: string, version: string): Promise<StepManifest> {
    const manifestPath = path.join(this.getStepDir(stepId, version), 'manifest.json');
    return readJson<StepManifest>(manifestPath);
  }

  private async loadScript(filePath: string): Promise<any> {
    const code = await readText(filePath);
    const script = new vm.Script(code, { filename: filePath });
    const moduleExports: { exports: any } = { exports: {} };
    const context = vm.createContext({
      module: moduleExports,
      exports: moduleExports.exports,
      require: createRequire(filePath),
      console,
      process: { env: process.env },
    });
    script.runInContext(context);
    return moduleExports.exports;
  }

  private async buildTools(stepDir: string, manifest: StepManifest): Promise<Record<string, ToolHandler>> {
    const tools: Record<string, ToolHandler> = {};
    if (!manifest.tools) {
      return tools;
    }
    for (const tool of manifest.tools) {
      const toolPath = path.join(stepDir, tool.module);
      const exports = await this.loadScript(toolPath);
      if (typeof exports !== 'function') {
        throw new Error(`Tool ${tool.name} did not export a function.`);
      }
      tools[tool.name] = exports as ToolHandler;
    }
    return tools;
  }

  async executeStep(manifest: StepManifest, inputs: Record<string, unknown>, log: (message: string, metadata?: Record<string, unknown>) => void): Promise<StepRunResult> {
    const stepDir = this.getStepDir(manifest.id, manifest.version);
    const stepPath = path.join(stepDir, manifest.entry);
    const exports = await this.loadScript(stepPath);
    if (typeof exports !== 'function') {
      throw new Error(`Step ${manifest.id} entry did not export a function.`);
    }
    const tools = await this.buildTools(stepDir, manifest);
    const context: StepRunContext = { inputs, tools, log };
    const result = await exports(context);
    if (!result || typeof result !== 'object') {
      throw new Error(`Step ${manifest.id} returned an invalid result.`);
    }
    return result as StepRunResult;
  }
}
