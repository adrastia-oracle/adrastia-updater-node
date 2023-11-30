import * as dotenv from "dotenv";

import { task, types } from "hardhat/config";
import { HardhatNetworkAccountUserConfig, HardhatUserConfig } from "hardhat/types";
import "@nomicfoundation/hardhat-toolbox";

import { KeyValueStoreClient } from "defender-kvstore-client";

import { default as adrastiaConfig } from "./adrastia.config";
import {
    AciUpdateTransactionHandler,
    UpdateTransactionHandler,
    UpdateTransactionOptions,
} from "./src/util/update-tx-handler";
import { run } from "./src/tasks/oracle-updater";

import "log-timestamp";
import { AxiosProxyConfig } from "axios";
import { RedisKeyValueStore } from "./src/util/redis-key-value-store";
import { IKeyValueStore } from "./src/util/key-value-store";
import { formatUnits, parseUnits } from "ethers";

dotenv.config();

const DEFAULT_PATH = "m/44'/60'/0'/0/0";
const DEFAULT_PASSPHRASE = "";
const DEFAULT_GASMULTIPLIER = 1.25;
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

function parseFloatOrUndefined(value: string | undefined): number | undefined {
    if (value === undefined || value === "" || value === null) {
        return undefined;
    }

    return parseFloat(value);
}

task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
    const accounts = await hre.ethers.getSigners();

    for (var i = 0; i < accounts.length; ++i) {
        console.log(i + ": " + accounts[i].address);
    }
});

task("gasmultiplier", "Prints the gas multiplier for the current network", async (taskArgs, hre) => {
    const gasMultiplier = hre.network.config.gasMultiplier;

    console.log("Gas multiplier for network", hre.network.name, "is", gasMultiplier);
});

task("run-oracle-updater", "Runs the updater using the signer from Hardhat.")
    .addParam("batch", "The index of the account to use as the updater.", 0, types.int, true)
    .addParam("mode", "The mode of the updater. Either 'normal' or 'critical'.", "normal", types.string, true)
    .addParam(
        "every",
        "The interval in seconds to run the updater. The updater is only run once by default.",
        undefined,
        types.int,
        true
    )
    .addParam(
        "delay",
        "The amount of time in seconds that has to pass (with an update being needed) before an update transaction is sent.",
        0,
        types.int,
        true
    )
    .addParam("type", "The type of the updater. Either 'dex', 'aci-address', or 'gas'.", "dex", types.string, true)
    .addFlag("dryRun", "Whether to run the updater in dry-run mode.")
    .addFlag("service", "Enables service mode to communicate with systemd and the watchdog.")
    .addParam(
        "gasPriceMultiplier",
        "The gas price multiplier to use (with up to 4 decimal places).",
        undefined,
        types.float,
        true
    )
    .addParam("maxGasPrice", "The maximum gas price to use (in gwei).", undefined, types.float, true)
    .addParam("txType", "The numeric transaction type (either 0 or 2).", undefined, types.int, true)
    .addParam("numConfirmations", "The number of confirmations to wait for after submitting a transaction.", 10, types.int, true)
    .setAction(async (taskArgs, hre) => {
        const accounts = await hre.ethers.getSigners();

        var store: IKeyValueStore;

        const redisEnabled =
            process.env.REDIS_ENABLED?.toLowerCase() === "true" ||
            process.env.REDIS_ENABLED === "1" ||
            process.env.REDIS_ENABLED?.toLowerCase() === "yes";

        if (redisEnabled) {
            console.log("Creating Redis client...");

            const redisUsername = process.env.REDIS_USERNAME || "";
            const redisPasswordBlob = process.env.REDIS_PASSWORD ? ":" + process.env.REDIS_PASSWORD : "";
            const redisHost = process.env.REDIS_HOST || "127.0.0.1";
            const redisPort = process.env.REDIS_PORT || "6379";
            const redisDatabase = process.env.REDIS_DATABASE || "0";
            const redisAtBlob = redisUsername !== "" || redisPasswordBlob !== "" ? "@" : "";

            const redis = require("redis");
            const redisClient = redis.createClient({
                url: 'redis://' + redisUsername + redisPasswordBlob + redisAtBlob + redisHost + ':' + redisPort + '/' + redisDatabase,
            });

            redisClient.on("error", function (error) {
                console.error("Redis error:", error);
            });

            redisClient.on("connect", function () {
                console.log("Redis client is connecting...");
            });

            redisClient.on("ready", function () {
                console.log("Redis client is ready.");
            });

            redisClient.on("end", function () {
                console.log("Redis client has disconnected.");
            });

            redisClient.on("reconnecting", function () {
                console.log("Redis client is reconnecting...");
            });

            await redisClient.connect();

            console.log("Redis client created.");

            store = new RedisKeyValueStore(redisClient);
        } else {
            store = new KeyValueStoreClient({ path: "store.json.tmp" });
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

        const txConfig = adrastiaConfig.chains[hre.network.name].txConfig[taskArgs.mode];

        const transactionTimeout = txConfig.validFor * 1000;

        const txType = taskArgs.txType ?? 0;
        const numConfirmations: number = taskArgs.numConfirmations;

        var maxGasPrice = undefined;
        if (taskArgs.maxGasPrice !== undefined) {
            if (taskArgs.maxGasPrice < 1) {
                throw new Error("Max gas price must be greater than or equal to 1");
            }

            maxGasPrice = parseUnits(taskArgs.maxGasPrice.toString(), "gwei");
        }

        const updateTxOptions: UpdateTransactionOptions = {
            gasLimit: bigIntOrUndefined(txConfig.gasLimit),
            transactionTimeout: transactionTimeout,
            gasPriceMultiplierDividend: bigIntOrUndefined(gasPriceMultiplierDividend),
            gasPriceMultiplierDivisor: bigIntOrUndefined(gasPriceMultiplierDivisor),
            maxGasPrice: bigIntOrUndefined(maxGasPrice),
            txType: txType,
            waitForConfirmations: numConfirmations,
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
                    process.env.PROXY_USERNAME || process.env.PROXY_PASSWORD
                        ? {
                              username: process.env.PROXY_USERNAME ?? "",
                              password: process.env.PROXY_PASSWORD ?? "",
                          }
                        : undefined,
            };
        }

        const notify = taskArgs.service ? require("sd-notify") : undefined;

        if (taskArgs.service) {
            // Inform systemd that we are ready to start
            notify.ready();
        }

        console.log("Starting the oracle updater with the following parameters:");
        console.log(`  - batch: ${taskArgs.batch}`);
        console.log(`  - mode: ${taskArgs.mode}`);
        console.log(`  - every: ${taskArgs.every}`);
        console.log(`  - dryRun: ${taskArgs.dryRun}`);
        console.log(`  - transactionTimeout: ${transactionTimeout}`);
        console.log(`  - numConfirmations: ${numConfirmations}`);
        console.log(`  - txType: ${txType}`);
        console.log(`  - delay: ${taskArgs.delay}`);
        console.log(`  - service: ${taskArgs.service}`);
        console.log(`  - type: ${taskArgs.type}`);

        if (taskArgs.gasPriceMultiplier !== undefined) {
            console.log(`  - gasPriceMultiplier: ${gasPriceMultiplierDividend / gasPriceMultiplierDivisor}`);
        }

        if (maxGasPrice !== undefined) {
            console.log(`  - maxGasPrice: ${formatUnits(maxGasPrice, "gwei")} gwei`);
        }

        if (proxyConfig !== undefined) {
            console.log(`  - proxy: ${proxyConfig.auth?.username}@${proxyConfig.host}:${proxyConfig.port}`);
        }

        const repeatInterval = taskArgs.every ?? 0;
        const repeatTimes = taskArgs.every === undefined ? 1 : Number.MAX_SAFE_INTEGER;

        var timesRepeated = 0;

        while (timesRepeated++ < repeatTimes) {
            if (taskArgs.service) {
                // Inform systemd that we are still running
                notify.watchdog();
            }

            try {
                console.log(
                    `Running batch ${taskArgs.batch} using account '${
                        accounts[taskArgs.batch].address
                    }' for target chain '${hre.network.name}'`
                );

                await run(
                    adrastiaConfig.chains[hre.network.name].oracles,
                    hre.network.name,
                    taskArgs.batch,
                    accounts[taskArgs.batch],
                    store,
                    txConfig.gasLimit,
                    taskArgs.mode === "critical",
                    taskArgs.dryRun,
                    updateTxHandler,
                    taskArgs.delay,
                    adrastiaConfig.httpCacheSeconds,
                    taskArgs.type,
                    proxyConfig
                );
            } catch (e) {
                console.error(e);
            }

            if (repeatInterval > 0) {
                console.log("Sleeping for", repeatInterval, "seconds");

                await new Promise((resolve) => setTimeout(resolve, repeatInterval * 1000));
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
                auto: true,
                interval: 2000,
            },
            accounts: process.env.PRIVATE_KEY_UPDATER ? [
                {
                    privateKey: process.env.PRIVATE_KEY_DEPLOYER,
                    balance: "50000000000000000000", // 50 ETH
                } as HardhatNetworkAccountUserConfig,
                {
                    privateKey: process.env.PRIVATE_KEY_UPDATER,
                    balance: "50000000000000000000", // 50 ETH
                } as HardhatNetworkAccountUserConfig
            ] : undefined,
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
            gasMultiplier:
                parseFloatOrUndefined(process.env.POLYGON_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
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
            gasMultiplier:
                parseFloatOrUndefined(process.env.ETHEREUM_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
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
            gasMultiplier:
                parseFloatOrUndefined(process.env.OPTIMISM_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
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
            gasMultiplier:
                parseFloatOrUndefined(process.env.ARBITRUMONE_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
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
            gasMultiplier:
                parseFloatOrUndefined(process.env.AVALANCHE_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
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
            gasMultiplier:
                parseFloatOrUndefined(process.env.FANTOM_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
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
            gasMultiplier:
                parseFloatOrUndefined(process.env.BSC_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
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
            gasMultiplier:
                parseFloatOrUndefined(process.env.EVMOS_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
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
            gasMultiplier:
                parseFloatOrUndefined(process.env.POLYGONZKEVM_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
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
            gasMultiplier:
                parseFloatOrUndefined(process.env.MOONBEAM_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
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
            gasMultiplier:
                parseFloatOrUndefined(process.env.BOBAETHEREUM_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
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
            gasMultiplier:
                parseFloatOrUndefined(process.env.ZKSYNCERA_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
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
            gasMultiplier:
                parseFloatOrUndefined(process.env.FILECOIN_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
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
            gasMultiplier:
                parseFloatOrUndefined(process.env.ROOTSTOCK_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
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
            gasMultiplier:
                parseFloatOrUndefined(process.env.BASE_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
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
            gasMultiplier:
                parseFloatOrUndefined(process.env.METIS_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
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
            gasMultiplier:
                parseFloatOrUndefined(process.env.GNOSIS_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
        },
    },
};

export default config;
