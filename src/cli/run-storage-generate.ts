import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readEnvFile } from '../config/env-file.js';
import { ConfigError } from '../config/errors.js';
import { loadConfig } from '../config/load-config.js';
import { PROFILES, type Profile } from '../config/types.js';
import { generateFiles, type GeneratedFile } from '../generator/generate.js';
import { renderEnvExample } from '../generator/render-env-example.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Readonly<Record<string, string | undefined>>;
  platform: NodeJS.Platform;
}

const USAGE = [
  'Usage:',
  '  storage:generate --env <file> [--out <dir>]   generate the files for the profile in the env file',
  `  storage:generate --template <${PROFILES.join('|')}> [--out <dir>]   write only that profile's .env.example`,
  '',
].join('\n');

const isProfile = (value: string | undefined): value is Profile => (PROFILES as readonly (string | undefined)[]).includes(value);

interface Args {
  env: string | undefined;
  out: string;
  template: string | undefined;
}

const parseArgs = (argv: string[]): Args | undefined => {
  const args: Args = { env: undefined, out: '.', template: undefined };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      return undefined;
    }
    if (flag === '--env') {
      args.env = value;
    } else if (flag === '--out') {
      args.out = value;
    } else if (flag === '--template') {
      args.template = value;
    } else {
      return undefined;
    }
  }
  return args;
};

const write = (out: string, files: GeneratedFile[], io: CliIo): void => {
  for (const file of files) {
    const target = join(out, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
    io.stdout(`wrote ${file.path}\n`);
  }
};

// Returns the process exit code: 0 done, 1 the configuration or env file is unusable, 2 the command line is wrong.
export const runStorageGenerate = (argv: string[], io: CliIo): number => {
  const args = parseArgs(argv);
  if (args === undefined) {
    io.stderr(USAGE);
    return 2;
  }

  if (args.template !== undefined) {
    if (!isProfile(args.template)) {
      io.stderr(USAGE);
      return 2;
    }
    write(args.out, [{ path: `.env.example.${args.template}`, content: renderEnvExample(args.template) }], io);
    return 0;
  }

  try {
    // With --env the file is the whole truth: a stray DATABASE_URL exported in the shell must not override it.
    const env = args.env === undefined ? io.env : readEnvFile(args.env);
    const { files, notes } = generateFiles(loadConfig(env, { platform: io.platform }));
    write(args.out, files, io);
    for (const note of notes) {
      io.stdout(`${note}\n`);
    }
    return 0;
  } catch (error) {
    if (error instanceof ConfigError || (error instanceof Error && error.message.startsWith('cannot read the env file'))) {
      io.stderr(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
};
