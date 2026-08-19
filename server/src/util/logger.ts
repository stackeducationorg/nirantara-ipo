type Level = 'debug' | 'info' | 'warn' | 'error';

const COLORS: Record<Level, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

function emit(level: Level, scope: string, msg: string, extra?: unknown) {
  const time = new Date().toISOString().slice(11, 19);
  const line = `${COLORS[level]}${time} ${level.toUpperCase().padEnd(5)}\x1b[0m [${scope}] ${msg}`;
  if (extra === undefined) console.log(line);
  else console.log(line, extra);
}

export function logger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => emit('debug', scope, msg, extra),
    info: (msg: string, extra?: unknown) => emit('info', scope, msg, extra),
    warn: (msg: string, extra?: unknown) => emit('warn', scope, msg, extra),
    error: (msg: string, extra?: unknown) => emit('error', scope, msg, extra),
  };
}

export type Logger = ReturnType<typeof logger>;
