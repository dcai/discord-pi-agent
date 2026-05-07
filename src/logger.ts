import pino, { type Logger, type LoggerOptions } from "pino";

const loggerLevel =
  process.env.DISCORD_PI_AGENT_LOG_LEVEL || process.env.LOG_LEVEL || "info";

const usePrettyTransport = process.stdout.isTTY;

const baseOptions: LoggerOptions = {
  level: loggerLevel,
};

export const logger = usePrettyTransport
  ? pino({
      ...baseOptions,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          colorizeObjects: true,
          levelFirst: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
          singleLine: false,
          messageFormat: "[{module}] {if direction}{direction} {end}{msg}",
        },
      },
    })
  : pino(baseOptions);

export function createModuleLogger(moduleName: string): Logger {
  return logger.child({ module: moduleName });
}
