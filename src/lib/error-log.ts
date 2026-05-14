/**
 * Unified error logging utility
 * 
 * Provides consistent error logging across the application with support for:
 * - Error levels (debug, warn, error)
 * - Context tagging for better filtering
 * - Optional error reporting to external services (future)
 * 
 * Usage:
 *   import { logError } from '@/lib/error-log';
 *   logError('API', 'Failed to fetch user data', error);
 */

export type ErrorContext = 
  | 'Auth'
  | 'API'
  | 'Database'
  | 'Realtime'
  | 'Voice'
  | 'Storage'
  | 'Network'
  | 'Unknown';

export type LogLevel = 'debug' | 'warn' | 'error';

/**
 * Format error for logging
 */
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === 'string') {
    return error;
  }
  return JSON.stringify(error);
}

/**
 * Get current timestamp for logs
 */
function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Core logging function
 */
function log(
  level: LogLevel,
  context: ErrorContext,
  message: string,
  error?: unknown,
  additional?: Record<string, unknown>
): void {
  const prefix = `[${timestamp()}] [${level.toUpperCase()}] [${context}]`;
  const msg = error ? `${message}: ${formatError(error)}` : message;
  
  const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.debug;
  
  if (additional) {
    logFn(`${prefix} ${msg}`, additional);
  } else {
    logFn(`${prefix} ${msg}`);
  }
}

/**
 * Log an error that should be investigated
 */
export function logError(
  context: ErrorContext,
  message: string,
  error?: unknown,
  additional?: Record<string, unknown>
): void {
  log('error', context, message, error, additional);
}

/**
 * Log a warning about a potentially problematic condition
 */
export function logWarn(
  context: ErrorContext,
  message: string,
  additional?: Record<string, unknown>
): void {
  log('warn', context, message, undefined, additional);
}

/**
 * Log debug information (only shows in development)
 */
export function logDebug(
  context: ErrorContext,
  message: string,
  additional?: Record<string, unknown>
): void {
  log('debug', context, message, undefined, additional);
}

/**
 * Wrap an async function with error logging
 * Returns the result or undefined if an error occurred
 */
export async function withErrorLog<T>(
  context: ErrorContext,
  message: string,
  fn: () => Promise<T>,
  fallback?: T
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    logError(context, message, error);
    return fallback;
  }
}

/**
 * Wrap a sync function with error logging
 * Returns the result or undefined if an error occurred
 */
export function withErrorLogSync<T>(
  context: ErrorContext,
  message: string,
  fn: () => T,
  fallback?: T
): T | undefined {
  try {
    return fn();
  } catch (error) {
    logError(context, message, error);
    return fallback;
  }
}
