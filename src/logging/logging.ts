import { createLogger, format, transports } from "winston";
import { INFO } from "./log-levels";
import { default as WinstonJournald } from "winston-journald3";

var logger = undefined;

class CustomJournaldTransport extends WinstonJournald {
    log(info, callback) {
        // Check if the info contains an error object
        if (info instanceof Error) {
            let message = info.message || "";
            if (info.stack) {
                message += `\n${info.stack}`;
            }

            // Replace newlines with escaped newlines
            message = message.replace(/\n/g, "\\n");

            // Handle the error object
            const errorInfo = {
                ...info,
                message: message,
                stack: info.stack,
                level: (info as any).level,
            };

            // Remove properties that start with an underscore
            Object.keys(errorInfo).forEach((key) => {
                if (key.startsWith("_")) {
                    delete errorInfo[key];
                }
            });

            super.log(errorInfo, callback);
        } else {
            // For non-error logs, use the default behavior
            super.log(info, callback);
        }
    }
}

export function initializeLogging(isService: boolean, identifier: string, level: string = INFO) {
    if (isService) {
        const journald = new CustomJournaldTransport({ identifier: identifier });
        logger = createLogger({
            level: level,
            format: format.combine(format.splat(), format.simple()),
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
