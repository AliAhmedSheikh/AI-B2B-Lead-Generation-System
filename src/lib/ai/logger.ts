/**
 * AI Pipeline Logger — Phase 1
 *
 * Structured logging for the classification pipeline.
 * Outputs JSON lines to stdout (captured by the host process / cloud logs).
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  phase: string;
  message: string;
  data?: Record<string, unknown>;
}

function emit(level: LogLevel, phase: string, message: string, data?: Record<string, unknown>) {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    phase,
    message,
    ...(data ? { data } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const aiLogger = {
  info:  (phase: string, msg: string, data?: Record<string, unknown>) => emit("info",  phase, msg, data),
  warn:  (phase: string, msg: string, data?: Record<string, unknown>) => emit("warn",  phase, msg, data),
  error: (phase: string, msg: string, data?: Record<string, unknown>) => emit("error", phase, msg, data),
};
