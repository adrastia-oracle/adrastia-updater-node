import { config as winstonConfig, createLogger, format, transports } from "winston";
import { INFO } from "./log-levels";
import { default as WinstonJournald } from "winston-journald3";
import { LEVEL, MESSAGE } from "triple-beam";

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
                // Expansion disabled because of an unresolved issue: `TypeError: Converting circular structure to JSON`
                // ...info,
                message: message,
                stack: info.stack,
                level: (info as any).level,
                [LEVEL]: (info as any)[LEVEL],
                [MESSAGE]: (info as any)[MESSAGE],
            };

            // Remove properties that start with an underscore
            Object.keys(errorInfo).forEach((key) => {
                if (key.startsWith("_")) {
                    delete errorInfo[key];
                }
            });

            try {
                super.log(errorInfo, callback);
            } catch (e) {
                console.error("Error while logging error: ", e);

                try {
                    // If the log function fails, it might not call the callback function. This can cause the logger
                    // to hang. So, we call the callback function ourselves to prevent this.
                    callback();
                } catch (e) {
                    if (e.message === "Callback called multiple times") {
                        // Ignore this error
                    } else {
                        console.error("Error while calling callback function: ", e);
                    }
                }
            }
        } else {
            // For non-error logs, use the default behavior
            try {
                super.log(info, callback);
            } catch (e) {
                console.error("Error while logging: ", e);

                try {
                    // If the log function fails, it might not call the callback function. This can cause the logger
                    // to hang. So, we call the callback function ourselves to prevent this.
                    callback();
                } catch (e) {
                    if (e.message === "Callback called multiple times") {
                        // Ignore this error
                    } else {
                        console.error("Error while calling callback function: ", e);
                    }
                }
            }
        }
    }
}

export function initializeLogging(isService: boolean, identifier: string, level: string = INFO) {
    if (isService) {
        const journald = new CustomJournaldTransport({ identifier: identifier });
        logger = createLogger({
            levels: winstonConfig.syslog.levels,
            level: level,
            format: format.combine(format.splat(), format.simple()),
            defaultMeta: { service: identifier },
            transports: [journald],
        });
    } else {
        logger = createLogger({
            levels: winstonConfig.syslog.levels,
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
