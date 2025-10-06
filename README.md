# Pipeline Proof of Concept

This repository provides a local-first proof of concept for building and executing agentic LLM pipelines. Pipelines are defined as a series of serializable steps that consume inputs, optionally call tools, and emit outputs that can feed downstream steps. All run artifacts persist to the filesystem so executions can be resumed or inspected after restarts.

## Features

- **File-backed run store** – inputs, outputs, logs, and metadata are written beneath `data/` for every pipeline run.
- **Step manifests** – each step ships with a serializable `manifest.json` describing its inputs, outputs, entry point, and tool contracts.
- **Queue-based execution** – runnable steps are enqueued and executed one at a time; failures are logged and requeued automatically.
- **Evaluation harness** – steps can define scenarios under `eval/` that are executed via `pipeline eval` with reports stored to `data/steps/.../eval/`.
- **CLI tooling** – initialize sample content, start runs, process queue ticks, inspect run state, stream logs, and run step evaluations.

## Project layout

```
.
├── data/                # Run artifacts and queue state (created at runtime)
├── pipelines/           # Pipeline DAG definitions (JSON)
├── steps/               # Step manifests, implementations, tools, and evals
├── src/                 # TypeScript sources for the CLI and runtime
└── tsconfig.json        # TypeScript configuration
```

## Getting started

1. **Install dependencies** – no external npm packages are required for the proof of concept.
2. **Build the CLI:**

   ```bash
   npm run build
   ```

3. **Initialize the workspace:**

   ```bash
   node dist/cli.js init
   ```

   This scaffolds a sample pipeline (`pipelines/sample.json`) and two steps (`echo` and `uppercase`) with corresponding evaluation fixtures.

4. **Create a run:**

   ```bash
   node dist/cli.js run sample --inputs examples/sample-input.json
   ```

   Provide any JSON file with at least a `text` field. The CLI stores metadata under `data/runs/sample/<run-id>/` and queues runnable steps.

5. **Process the queue:**

   ```bash
   node dist/cli.js tick
   ```

   Invoke `tick` repeatedly (or in a separate loop) to execute queued steps sequentially. Each tick processes at most one step.

6. **Inspect results:**

   ```bash
   node dist/cli.js inspect sample <run-id>
   node dist/cli.js logs sample <run-id>
   ```

7. **Evaluate steps:**

   ```bash
   node dist/cli.js eval echo
   ```

   Evaluation outputs are written to `data/steps/<step>/<version>/eval/<timestamp>.json`.

## Step implementations

Each step folder contains:

- `manifest.json` – serializable metadata consumed by the runtime.
- `index.js` (or other entry) – module exporting an async function `(context) => StepRunResult`.
- `tools/` (optional) – modules for tool handlers referenced in the manifest.
- `eval/` (optional) – JSON scenarios with `name`, `inputs`, and optional `expected` outputs.

The runtime executes step modules inside a lightweight `vm` context and provides:

```js
module.exports = async ({ inputs, tools, log }) => {
  // inputs: resolved dependency data
  // tools: named tool handlers
  // log: helper that writes structured logs to the run directory
  return { outputs: { ... } };
};
```

## Future enhancements

- Richer queue semantics (priorities, exponential backoff, parallel workers).
- Configurable persistence backends beyond the filesystem.
- Built-in experimentation utilities for prompt/model sweeps.
- Structured tool schemas and validation helpers.

## License

MIT
