import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

export async function ensureDir(targetPath: string): Promise<void> {
  await fsp.mkdir(targetPath, { recursive: true });
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function appendLine(filePath: string, line: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fsp.appendFile(filePath, line + '\n', 'utf8');
}

export async function listDirectories(root: string): Promise<string[]> {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry: any) => entry.isDirectory())
    .map((entry: any) => entry.name);
}

export function resolvePath(...parts: string[]): string {
  return path.join(...parts);
}

export async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  const exists = await pathExists(filePath);
  if (!exists) {
    return null;
  }
  return readJson<T>(filePath);
}

export async function writeText(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, content, 'utf8');
}

export async function readText(filePath: string): Promise<string> {
  return fsp.readFile(filePath, 'utf8');
}

export function fileExistsSync(filePath: string): boolean {
  return fs.existsSync(filePath);
}
