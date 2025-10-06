import * as path from 'path';
import { PipelineDefinition } from '../domain/types';
import { readJson } from '../utils/fs';

export class PipelineLoader {
  constructor(private readonly rootDir: string) {}

  async load(pipelineId: string): Promise<PipelineDefinition> {
    const pipelinePath = path.join(this.rootDir, `${pipelineId}.json`);
    return readJson<PipelineDefinition>(pipelinePath);
  }
}
