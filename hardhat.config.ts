import * as dotenv from "dotenv";

import { task, types } from "hardhat/config";
import { HardhatNetworkAccountUserConfig, HardhatUserConfig } from "hardhat/types";
import "@nomicfoundation/hardhat-toolbox";

import { AciUpdateTransactionHandler, UpdateTransactionHandler } from "./src/util/update-tx-handler";
import { run } from "./src/tasks/oracle-updater";

import { AxiosProxyConfig } from "axios";
import { RedisKeyValueStore } from "./src/util/redis-key-value-store";
import { IKeyValueStore } from "./src/util/key-value-store";
import { formatUnits, parseUnits } from "ethers";
import { AdrastiaConfig, TxConfig } from "./src/config/adrastia-config";
import { getLogger, initializeLogging, setupDatadog, setupLogtail } from "./src/logging/logging";

dotenv.config();

const DEFAULT_PATH = "m/44'/60'/0'/0/0";
const DEFAULT_PASSPHRASE = "";
const DEFAULT_ACCOUNT_COUNT = 50;

function bigIntOrUndefined(value: string | bigint | number | undefined): bigint | undefined {
    if (value === undefined || value === "" || value === null) {
        return undefined;
    }

    return BigInt(value);
}

function parseIntOrUndefined(value: string | undefined): number | undefined {
    if (value === undefined || value === "" || value === null) {
        return undefined;
    }

    return parseInt(value);
}

function clearSecretsFromEnv() {
    var keysToDelete = [];

    for (const key in process.env) {
        const keyLc = key.toLowerCase();

        if (
            keyLc.includes("passphrase") ||
            keyLc.includes("private_key") ||
            keyLc.includes("password") ||
            keyLc.includes("mnemonic")
        ) {
            process.env[key] = undefined;
            keysToDelete.push(key);
        }
    }

    for (const key of keysToDelete) {
        delete process.env[key];
    }
}

task("print-network", "Prints the current network config", async (_, hre) => {
    // Clone the network config and remove sensitive and junk information
    var networkConfig = Object.assign({}, hre.network.config);
    delete networkConfig.accounts;
    delete networkConfig.gas;
    delete networkConfig.gasPrice;
    delete networkConfig.gasMultiplier;

    console.log(networkConfig);
});

task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
    const accounts = await hre.ethers.getSigners();

    for (var i = 0; i < accounts.length; ++i) {
        console.log(i + ": " + accounts[i].address);
    }
});

task("run-oracle-updater", "Runs the updater using the signer from Hardhat.")
    .addParam(
        "workerConfig",
        "The path to the Adrastia worker config file.",
        "./adrastia.config.ts",
        types.inputFile,
        true,
    )
    .addParam("batch", "The index of the account to use as the updater.", 0, types.int, true)
    .addParam(
        "every",
        "The interval in seconds to run the updater. The updater is only run once by default.",
        undefined,
        types.int,
        true,
    )
    .addParam(
        "delay",
        "The amount of time in seconds that has to pass (with an update being needed) before an update transaction is sent.",
        0,
        types.int,
        true,
    )
    .addParam("type", "The type of the updater. Either 'dex', 'aci-address', or 'gas'.", "dex", types.string, true)
    .addFlag("dryRun", "Whether to run the updater in dry-run mode.")
    .addFlag("service", "Enables service mode to communicate with systemd and the watchdog.")
    .addParam(
        "gasPriceMultiplier",
        "The gas price multiplier to use (with up to 4 decimal places).",
        undefined,
        types.float,
        true,
    )
    .addParam("maxGasPrice", "The maximum gas price to use (in gwei).", undefined, types.float, true)
    .addParam("txType", "The numeric transaction type (either 0 or 2).", undefined, types.int, true)
    .addParam(
        "numConfirmations",
        "The number of confirmations to wait for after submitting a transaction.",
        5,
        types.int,
        true,
    )
    .addParam("logLevel", "The log level to use.", "info", types.string, true)
    .setAction(async (taskArgs, hre) => {
        process.on("uncaughtException", (err) => {
            // Use console.error just in case the logger is the cause of the exception
            console.error("Uncaught exception:", err);
            process.exit(1);
        });

        process.on("unhandledRejection", (err) => {
            // Use console.error just in case the logger is the cause of the exception
            console.error("Unhandled rejection:", err);
            process.exit(1);
        });

        const redisPassword = process.env.REDIS_PASSWORD;
        const proxyPassword = process.env.PROXY_PASSWORD;

        clearSecretsFromEnv();

        const unitName = "adrastia-" + hre.network.name + "-" + taskArgs.batch;

        initializeLogging(
            taskArgs.service,
            "adrastia-oracle-updater",
            unitName,
            hre.network.name,
            taskArgs.logLevel || "info",
        );

        const logger = getLogger();

        const adrastiaConfig = require(taskArgs.workerConfig).default as AdrastiaConfig;

        const chainConfig = adrastiaConfig.chains[hre.network.name];
        const batchConfig = chainConfig.batches?.[taskArgs.batch];

        logger.defaultMeta["customerId"] = batchConfig?.customerId;
        logger.defaultMeta["batchId"] = batchConfig?.batchId;

        const remoteLogging = batchConfig?.logging;
        if (remoteLogging) {
            if (remoteLogging.type === "logtail") {
                setupLogtail(remoteLogging.sourceToken, remoteLogging.level);
            } else if (remoteLogging.type === "datadog") {
                setupDatadog(remoteLogging.sourceToken, remoteLogging.region, remoteLogging.level);
            }
        }

        const accounts = await hre.ethers.getSigners();

        var store: IKeyValueStore;

        const redisEnabled =
            process.env.REDIS_ENABLED?.toLowerCase() === "true" ||
            process.env.REDIS_ENABLED === "1" ||
            process.env.REDIS_ENABLED?.toLowerCase() === "yes";

        if (redisEnabled) {
            logger.info("Creating Redis client...");

            const redisUsername = process.env.REDIS_USERNAME || "";
            const redisPasswordBlob = redisPassword ? ":" + redisPassword : "";
            const redisHost = process.env.REDIS_HOST || "127.0.0.1";
            const redisPort = process.env.REDIS_PORT || "6379";
            const redisDatabase = process.env.REDIS_DATABASE || "0";
            const redisAtBlob = redisUsername !== "" || redisPasswordBlob !== "" ? "@" : "";

            const redis = require("redis");
            const redisClient = redis.createClient({
                url:
                    "redis://" +
                    redisUsername +
                    redisPasswordBlob +
                    redisAtBlob +
                    redisHost +
                    ":" +
                    redisPort +
                    "/" +
                    redisDatabase,
            });

            redisClient.on("error", function (error) {
                logger.error("Redis error:", error);
            });

            redisClient.on("connect", function () {
                logger.info("Redis client is connecting...");
            });

            redisClient.on("ready", function () {
                logger.info("Redis client is ready.");
            });

            redisClient.on("end", function () {
                logger.info("Redis client has disconnected.");
            });

            redisClient.on("reconnecting", function () {
                logger.info("Redis client is reconnecting...");
            });

            await redisClient.connect();

            logger.info("Redis client created.");

            store = new RedisKeyValueStore(redisClient);
        } else {
            throw new Error("Redis is the only supported key-value store at the moment.");
        }

        // Extract gas price multiplier
        var gasPriceMultiplierDividend = undefined;
        var gasPriceMultiplierDivisor = undefined;
        if (taskArgs.gasPriceMultiplier !== undefined) {
            if (taskArgs.gasPriceMultiplier < 1) {
                throw new Error("Gas price multiplier must be greater than or equal to 1");
            }

            // Take the gas price multiplier from the command line (it's a float) and convert it to a fraction
            gasPriceMultiplierDividend = Math.floor(taskArgs.gasPriceMultiplier * 10000);
            gasPriceMultiplierDivisor = 10000;
        }

        const txType = taskArgs.txType;
        const numConfirmations: number = taskArgs.numConfirmations;

        var maxGasPrice = undefined;
        if (taskArgs.maxGasPrice !== undefined) {
            if (taskArgs.maxGasPrice < 1) {
                throw new Error("Max gas price must be greater than or equal to 1");
            }

            maxGasPrice = parseUnits(taskArgs.maxGasPrice.toString(), "gwei");
        }

        const updateTxOptions: TxConfig = {
            gasPriceMultiplierDividend: bigIntOrUndefined(gasPriceMultiplierDividend),
            gasPriceMultiplierDivisor: bigIntOrUndefined(gasPriceMultiplierDivisor),
            maxGasPrice: bigIntOrUndefined(maxGasPrice),
            txType: taskArgs.txType,
            waitForConfirmations: taskArgs.numConfirmations,
            transactionTimeout: 60 * 1000,
        };

        var updateTxHandler: UpdateTransactionHandler;
        if (taskArgs.type === "aci-address") {
            updateTxHandler = new AciUpdateTransactionHandler(updateTxOptions);
        } else {
            updateTxHandler = new UpdateTransactionHandler(updateTxOptions);
        }

        var proxyConfig: AxiosProxyConfig;

        if (process.env.PROXY_HOST && process.env.PROXY_PORT) {
            proxyConfig = {
                host: process.env.PROXY_HOST,
                port: parseInt(process.env.PROXY_PORT),
                auth:
                    process.env.PROXY_USERNAME || proxyPassword
                        ? {
                              username: process.env.PROXY_USERNAME ?? "",
                              password: proxyPassword ?? "",
                          }
                        : undefined,
            };
        }

        // Extract polling interval (measured in ms)
        var pollingInterval = batchConfig?.pollingInterval;
        if (pollingInterval === undefined && taskArgs.every !== undefined) {
            pollingInterval = taskArgs.every * 1000; // Convert seconds to ms
        }
        const repeatTimes = pollingInterval === undefined ? 1 : Number.MAX_SAFE_INTEGER;
        if (pollingInterval === undefined) {
            pollingInterval = 0;
        }
        // Extract write delay (measured in seconds)
        var writeDelay = batchConfig?.writeDelay;
        if (writeDelay !== undefined) {
            writeDelay /= 1000; // Convert ms to seconds
        }
        if (writeDelay === undefined && taskArgs.delay !== undefined) {
            writeDelay = taskArgs.delay; // taskArgs.delay is in seconds
        }
        if (writeDelay === undefined) {
            writeDelay = 0;
        }

        const notify = taskArgs.service ? require("sd-notify") : undefined;

        if (taskArgs.service) {
            // Inform systemd that we are ready to start
            notify.ready();
        }

        logger.debug("Starting the oracle updater with the following parameters:");
        logger.debug(`  - workerConfig: ${taskArgs.workerConfig}`);
        logger.debug(`  - batch: ${taskArgs.batch}`);
        logger.debug(`  - pollingInterval: ${pollingInterval}ms`);
        logger.debug(`  - dryRun: ${taskArgs.dryRun}`);
        logger.debug(`  - numConfirmations: ${numConfirmations}`);
        logger.debug(`  - txType: ${txType}`);
        logger.debug(`  - delay: ${writeDelay}ms`);
        logger.debug(`  - service: ${taskArgs.service}`);
        logger.debug(`  - type: ${taskArgs.type}`);

        if (taskArgs.gasPriceMultiplier !== undefined) {
            logger.debug(`  - gasPriceMultiplier: ${gasPriceMultiplierDividend / gasPriceMultiplierDivisor}`);
        }

        if (maxGasPrice !== undefined) {
            logger.debug(`  - maxGasPrice: ${formatUnits(maxGasPrice, "gwei")} gwei`);
        }

        if (proxyConfig !== undefined) {
            logger.debug(`  - proxy: ${proxyConfig.auth?.username}@${proxyConfig.host}:${proxyConfig.port}`);
        }

        var timesRepeated = 0;

        while (timesRepeated++ < repeatTimes) {
            if (taskArgs.service) {
                // Inform systemd that we are still running
                notify.watchdog();
            }

            try {
                logger.info(
                    `Running batch ${taskArgs.batch} using account '${
                        accounts[taskArgs.batch].address
                    }' for target chain '${hre.network.name}'`,
                );

                await run(
                    adrastiaConfig,
                    hre.network.name,
                    taskArgs.batch,
                    accounts[taskArgs.batch],
                    store,
                    taskArgs.dryRun,
                    updateTxHandler,
                    writeDelay,
                    taskArgs.type,
                    proxyConfig,
                );
            } catch (e) {
                logger.error(e);
            }

            if (pollingInterval > 0) {
                logger.info("Sleeping for %i ms", pollingInterval);

                await new Promise((resolve) => setTimeout(resolve, pollingInterval));
            }
        }
    });

const config: HardhatUserConfig = {
    solidity: "0.8.13",
    networks: {
        hardhat: {
            forking: process.env.FORKING_URL && {
                url: process.env.FORKING_URL,
                enabled: true,
            },
            mining: {
                auto: false,
                interval: 2000,
            },
            accounts: process.env.PRIVATE_KEY_UPDATER
                ? [
                      {
                          privateKey: process.env.PRIVATE_KEY_DEPLOYER,
                          balance: "50000000000000000000", // 50 ETH
                      } as HardhatNetworkAccountUserConfig,
                      {
                          privateKey: process.env.PRIVATE_KEY_UPDATER,
                          balance: "50000000000000000000", // 50 ETH
                      } as HardhatNetworkAccountUserConfig,
                  ]
                : undefined,
        },
        localhost: {
            accounts: process.env.PRIVATE_KEY_UPDATER ? [process.env.PRIVATE_KEY_UPDATER] : undefined,
        },
        polygon: {
            url: process.env.POLYGON_URL ?? "",
            accounts: {
                mnemonic: process.env.POLYGON_MNEMONIC ?? "",
                path: process.env.POLYGON_PATH ?? DEFAULT_PATH,
                passphrase: process.env.POLYGON_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.POLYGON_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        ethereum: {
            url: process.env.ETHEREUM_URL ?? "",
            accounts: {
                mnemonic: process.env.ETHEREUM_MNEMONIC ?? "",
                path: process.env.ETHEREUM_PATH ?? DEFAULT_PATH,
                passphrase: process.env.ETHEREUM_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.ETHEREUM_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        optimism: {
            url: process.env.OPTIMISM_URL ?? "",
            accounts: {
                mnemonic: process.env.OPTIMISM_MNEMONIC ?? "",
                path: process.env.OPTIMISM_PATH ?? DEFAULT_PATH,
                passphrase: process.env.OPTIMISM_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.OPTIMISM_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        arbitrumOne: {
            url: process.env.ARBITRUMONE_URL ?? "",
            accounts: {
                mnemonic: process.env.ARBITRUMONE_MNEMONIC ?? "",
                path: process.env.ARBITRUMONE_PATH ?? DEFAULT_PATH,
                passphrase: process.env.ARBITRUMONE_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.ARBITRUMONE_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        avalanche: {
            url: process.env.AVALANCHE_URL ?? "",
            accounts: {
                mnemonic: process.env.AVALANCHE_MNEMONIC ?? "",
                path: process.env.AVALANCHE_PATH ?? DEFAULT_PATH,
                passphrase: process.env.AVALANCHE_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.AVALANCHE_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        fantom: {
            url: process.env.FANTOM_URL ?? "",
            accounts: {
                mnemonic: process.env.FANTOM_MNEMONIC ?? "",
                path: process.env.FANTOM_PATH ?? DEFAULT_PATH,
                passphrase: process.env.FANTOM_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.FANTOM_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        bsc: {
            url: process.env.BSC_URL ?? "",
            accounts: {
                mnemonic: process.env.BSC_MNEMONIC ?? "",
                path: process.env.BSC_PATH ?? DEFAULT_PATH,
                passphrase: process.env.BSC_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.BSC_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        evmos: {
            url: process.env.EVMOS_URL ?? "",
            accounts: {
                mnemonic: process.env.EVMOS_MNEMONIC ?? "",
                path: process.env.EVMOS_PATH ?? DEFAULT_PATH,
                passphrase: process.env.EVMOS_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.EVMOS_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        polygonZkEVM: {
            url: process.env.POLYGONZKEVM_URL ?? "",
            accounts: {
                mnemonic: process.env.POLYGONZKEVM_MNEMONIC ?? "",
                path: process.env.POLYGONZKEVM_PATH ?? DEFAULT_PATH,
                passphrase: process.env.POLYGONZKEVM_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.POLYGONZKEVM_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        moonbeam: {
            url: process.env.MOONBEAM_URL ?? "",
            accounts: {
                mnemonic: process.env.MOONBEAM_MNEMONIC ?? "",
                path: process.env.MOONBEAM_PATH ?? DEFAULT_PATH,
                passphrase: process.env.MOONBEAM_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.MOONBEAM_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        bobaEthereum: {
            url: process.env.BOBAETHEREUM_URL ?? "",
            accounts: {
                mnemonic: process.env.BOBAETHEREUM_MNEMONIC ?? "",
                path: process.env.BOBAETHEREUM_PATH ?? DEFAULT_PATH,
                passphrase: process.env.BOBAETHEREUM_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.BOBAETHEREUM_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        zkSyncEra: {
            url: process.env.ZKSYNCERA_URL ?? "",
            accounts: {
                mnemonic: process.env.ZKSYNCERA_MNEMONIC ?? "",
                path: process.env.ZKSYNCERA_PATH ?? DEFAULT_PATH,
                passphrase: process.env.ZKSYNCERA_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.ZKSYNCERA_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        filecoin: {
            url: process.env.FILECOIN_URL ?? "",
            accounts: {
                mnemonic: process.env.FILECOIN_MNEMONIC ?? "",
                path: process.env.FILECOIN_PATH ?? DEFAULT_PATH,
                passphrase: process.env.FILECOIN_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.FILECOIN_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        rootstock: {
            url: process.env.ROOTSTOCK_URL ?? "",
            accounts: {
                mnemonic: process.env.ROOTSTOCK_MNEMONIC ?? "",
                path: process.env.ROOTSTOCK_PATH ?? DEFAULT_PATH,
                passphrase: process.env.ROOTSTOCK_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.ROOTSTOCK_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        base: {
            url: process.env.BASE_URL ?? "",
            accounts: {
                mnemonic: process.env.BASE_MNEMONIC ?? "",
                path: process.env.BASE_PATH ?? DEFAULT_PATH,
                passphrase: process.env.BASE_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.BASE_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        metis: {
            url: process.env.METIS_URL ?? "",
            accounts: {
                mnemonic: process.env.METIS_MNEMONIC ?? "",
                path: process.env.METIS_PATH ?? DEFAULT_PATH,
                passphrase: process.env.METIS_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.METIS_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        gnosis: {
            url: process.env.GNOSIS_URL ?? "",
            accounts: {
                mnemonic: process.env.GNOSIS_MNEMONIC ?? "",
                path: process.env.GNOSIS_PATH ?? DEFAULT_PATH,
                passphrase: process.env.GNOSIS_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.GNOSIS_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        scroll: {
            url: process.env.SCROLL_URL ?? "",
            accounts: {
                mnemonic: process.env.SCROLL_MNEMONIC ?? "",
                path: process.env.SCROLL_PATH ?? DEFAULT_PATH,
                passphrase: process.env.SCROLL_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.SCROLL_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
        mantaPacific: {
            url: process.env.MANTAPACIFIC_URL ?? "",
            accounts: {
                mnemonic: process.env.MANTAPACIFIC_MNEMONIC ?? "",
                path: process.env.MANTAPACIFIC_PATH ?? DEFAULT_PATH,
                passphrase: process.env.MANTAPACIFIC_PASSPHRASE ?? DEFAULT_PASSPHRASE,
                count:
                    parseIntOrUndefined(process.env.MANTAPACIFIC_ACCOUNT_COUNT) ??
                    parseIntOrUndefined(process.env.DEFAULT_ACCOUNT_COUNT) ??
                    DEFAULT_ACCOUNT_COUNT,
            },
        },
    },
};

export default config;
