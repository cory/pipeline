import * as path from 'path';
import * as fs from 'fs';
import { PipelineRunner } from './runtime/runner';
import { StepEvaluator } from './runtime/evaluator';
import { ensureDir, pathExists, readJson, writeJson, writeText } from './utils/fs';

const DATA_DIR = path.join(process.cwd(), 'data');
const STEPS_DIR = path.join(process.cwd(), 'steps');
const PIPELINES_DIR = path.join(process.cwd(), 'pipelines');

interface ParsedArgs {
  positional: string[];
  options: Record<string, string>;
}

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const options: Record<string, string> = {};
  let index = 0;
  while (index < args.length) {
    const token = args[index];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = args[index + 1];
      if (next && !next.startsWith('--')) {
        options[key] = next;
        index += 2;
      } else {
        options[key] = 'true';
        index += 1;
      }
    } else {
      positional.push(token);
      index += 1;
    }
  }
  return { positional, options };
}

async function initProject(): Promise<void> {
  await ensureDir(DATA_DIR);
  await ensureDir(STEPS_DIR);
  await ensureDir(PIPELINES_DIR);
  await ensureDir(path.join(DATA_DIR, 'runs'));

  const echoStepDir = path.join(STEPS_DIR, 'echo', 'v1');
  const uppercaseStepDir = path.join(STEPS_DIR, 'uppercase', 'v1');

  if (!(await pathExists(path.join(echoStepDir, 'manifest.json')))) {
    await ensureDir(echoStepDir);
    await writeJson(path.join(echoStepDir, 'manifest.json'), {
      id: 'echo',
      version: 'v1',
      name: 'Echo Input',
      entry: 'index.js',
      inputs: ['text'],
      outputs: ['text'],
      tools: [],
    });
    await writeText(
      path.join(echoStepDir, 'index.js'),
      `module.exports = async ({ inputs, log }) => {\n  const text = inputs.text ?? '';\n  log('Echoing input', { text });\n  return { outputs: { text: String(text) } };\n};\n`,
    );
    await ensureDir(path.join(echoStepDir, 'eval'));
    await writeJson(path.join(echoStepDir, 'eval', 'basic.json'), {
      name: 'basic echo',
      inputs: { text: 'hello world' },
      expected: { text: 'hello world' },
    });
  }

  if (!(await pathExists(path.join(uppercaseStepDir, 'manifest.json')))) {
    await ensureDir(uppercaseStepDir);
    await writeJson(path.join(uppercaseStepDir, 'manifest.json'), {
      id: 'uppercase',
      version: 'v1',
      name: 'Uppercase Transformer',
      entry: 'index.js',
      inputs: ['text'],
      outputs: ['text'],
      tools: [],
    });
    await writeText(
      path.join(uppercaseStepDir, 'index.js'),
      `module.exports = async ({ inputs, log }) => {\n  const text = inputs.text ?? '';\n  const result = String(text).toUpperCase();\n  log('Converted to uppercase', { text: result });\n  return { outputs: { text: result } };\n};\n`,
    );
    await ensureDir(path.join(uppercaseStepDir, 'eval'));
    await writeJson(path.join(uppercaseStepDir, 'eval', 'basic.json'), {
      name: 'uppercase conversion',
      inputs: { text: 'hello' },
      expected: { text: 'HELLO' },
    });
  }

  const samplePipelinePath = path.join(PIPELINES_DIR, 'sample.json');
  if (!(await pathExists(samplePipelinePath))) {
    await writeJson(samplePipelinePath, {
      id: 'sample',
      name: 'Sample Echo Pipeline',
      description: 'Demonstrates chaining two simple steps.',
      steps: [
        {
          stepId: 'echo',
          version: 'v1',
          alias: 'echo',
          inputs: {
            text: { source: 'pipeline', key: 'text' },
          },
        },
        {
          stepId: 'uppercase',
          version: 'v1',
          alias: 'uppercase',
          inputs: {
            text: { source: 'step', stepId: 'echo', output: 'text', key: 'text' },
          },
        },
      ],
    });
  }

  console.log('Project initialized.');
}

async function runPipeline(args: ParsedArgs): Promise<void> {
  const [pipelineId] = args.positional;
  if (!pipelineId) {
    throw new Error('Usage: pipeline run <pipeline-id> [--inputs <path>] [--user <user-id>]');
  }
  const inputsPath = args.options['inputs'];
  const userId = args.options['user'];
  let inputs: Record<string, unknown> = {};
  if (inputsPath) {
    const absolute = path.resolve(inputsPath);
    inputs = await readJson<Record<string, unknown>>(absolute);
  }
  const runner = new PipelineRunner({ dataDir: DATA_DIR, pipelinesDir: PIPELINES_DIR, stepsDir: STEPS_DIR });
  const metadata = await runner.createRun(pipelineId, inputs, userId);
  console.log(`Created run ${metadata.runId} for pipeline ${pipelineId}`);
}

async function tickPipeline(): Promise<void> {
  const runner = new PipelineRunner({ dataDir: DATA_DIR, pipelinesDir: PIPELINES_DIR, stepsDir: STEPS_DIR });
  const item = await runner.tick();
  if (!item) {
    console.log('Queue empty.');
  } else {
    console.log(`Executed step ${item.stepId} for run ${item.runId}`);
  }
}

async function inspectRun(args: ParsedArgs): Promise<void> {
  const [pipelineId, runId] = args.positional;
  if (!pipelineId || !runId) {
    throw new Error('Usage: pipeline inspect <pipeline-id> <run-id>');
  }
  const runner = new PipelineRunner({ dataDir: DATA_DIR, pipelinesDir: PIPELINES_DIR, stepsDir: STEPS_DIR });
  const metadata = await runner.getRunStore().readRunMetadata(pipelineId, runId);
  const completed = await runner.getRunStore().listCompletedSteps(pipelineId, runId);
  console.log(JSON.stringify({ metadata, completed }, null, 2));
}

async function showLogs(args: ParsedArgs): Promise<void> {
  const [pipelineId, runId] = args.positional;
  const step = args.options['step'];
  if (!pipelineId || !runId) {
    throw new Error('Usage: pipeline logs <pipeline-id> <run-id> [--step <step-id>]');
  }
  const logsDir = path.join(DATA_DIR, 'runs', pipelineId, runId, 'logs');
  const exists = await pathExists(logsDir);
  if (!exists) {
    console.log('No logs found.');
    return;
  }
  const files: string[] = await fs.promises.readdir(logsDir);
  const targetFiles = step ? [`${step}.ndjson`] : files.filter((file: string) => file.endsWith('.ndjson'));
  for (const file of targetFiles) {
    const content = await fs.promises.readFile(path.join(logsDir, file), 'utf8');
    console.log(`# ${file}`);
    console.log(content.trim());
  }
}

async function evaluateStep(args: ParsedArgs): Promise<void> {
  const [stepId] = args.positional;
  const version = args.options['version'] ?? 'v1';
  if (!stepId) {
    throw new Error('Usage: pipeline eval <step-id> [--version <version>]');
  }
  const evaluator = new StepEvaluator(STEPS_DIR, DATA_DIR);
  const results = await evaluator.evaluate(stepId, version);
  console.log(JSON.stringify(results, null, 2));
}

async function main(): Promise<void> {
  const [, , ...rest] = process.argv;
  const command = rest.shift();
  if (!command) {
    console.log(`Available commands:\n  init\n  run <pipeline-id> [--inputs <path>] [--user <user-id>]\n  tick\n  inspect <pipeline-id> <run-id>\n  logs <pipeline-id> <run-id> [--step <step-id>]\n  eval <step-id> [--version <version>]`);
    return;
  }
  const parsed = parseArgs(rest);
  switch (command) {
    case 'init':
      await initProject();
      break;
    case 'run':
      await runPipeline(parsed);
      break;
    case 'tick':
      await tickPipeline();
      break;
    case 'inspect':
      await inspectRun(parsed);
      break;
    case 'logs':
      await showLogs(parsed);
      break;
    case 'eval':
      await evaluateStep(parsed);
      break;
    default:
      console.log(`Unknown command: ${command}`);
      break;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
