import { createLogger, format, transports } from "winston";
import { INFO } from "./log-levels";

var logger = undefined;

export function initializeLogging(isService: boolean, identifier: string, level: string = INFO) {
    if (isService) {
        const journald3 = require("winston-journald3").default;
        const journald = new journald3({ identifier: identifier });
        logger = createLogger({
            level: level,
            format: format.combine(
                format.errors({ stack: true }),
                format.splat(),
                format.printf((info) => {
                    let logMessage = `${info.message}`;
                    if (info.stack) {
                        // Append stack trace if available
                        logMessage += `\n${info.stack}`;
                    }
                    return logMessage;
                }),
            ),
            defaultMeta: { service: identifier },
            transports: [journald],
        });
    } else {
        logger = createLogger({
            level: level,
            format: format.combine(
                format.errors({ stack: true }),
                format.timestamp({
                    format: "YYYY-MM-DD HH:mm:ss.ms",
                }),
                format.splat(),
                format.printf((info) => {
                    let logMessage = `${info.level.toUpperCase()} [${info.timestamp}] ${info.message}`;
                    if (info.stack) {
                        // Append stack trace if available
                        logMessage += `\n${info.stack}`;
                    }
                    return logMessage;
                }),
            ),
            defaultMeta: { service: identifier },
            transports: [new transports.Console()],
        });
    }
}

export function getLogger() {
    return logger;
}
