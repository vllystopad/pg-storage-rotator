import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export const readEnvFile = (path: string): Record<string, string> => {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`cannot read the env file ${path}`);
  }
  return parseEnv(text) as Record<string, string>;
};
