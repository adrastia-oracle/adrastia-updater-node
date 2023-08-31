import * as dotenv from "dotenv";

import "@nomiclabs/hardhat-waffle";

import { task, types } from "hardhat/config";
import { HardhatUserConfig } from "hardhat/types";
import { KeyValueStoreClient } from "defender-kvstore-client";

import { default as adrastiaConfig } from "./adrastia.config";
import { UpdateTransactionHandler } from "./src/util/update-tx-handler";
import { run } from "./src/tasks/oracle-updater";

import "log-timestamp";
import { AxiosProxyConfig } from "axios";
import { RedisKeyValueStore } from "./src/util/redis-key-value-store";
import { IKeyValueStore } from "./src/util/key-value-store";

dotenv.config();

const DEFAULT_PATH = "m/44'/60'/0'/0/0";
const DEFAULT_PASSPHRASE = "";
const DEFAULT_GASMULTIPLIER = 1.25;

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
    .addParam("type", "The type of the updater. Either 'dex' or 'gas'.", "dex", types.string, true)
    .addFlag("dryRun", "Whether to run the updater in dry-run mode.")
    .addFlag("service", "Enables service mode to communicate with systemd and the watchdog.")
    .setAction(async (taskArgs, hre) => {
        const accounts = await hre.ethers.getSigners();

        var store: IKeyValueStore;

        const redisEnabled =
            process.env.REDIS_ENABLED?.toLowerCase() === "true" ||
            process.env.REDIS_ENABLED === "1" ||
            process.env.REDIS_ENABLED?.toLowerCase() === "yes";

        if (redisEnabled) {
            console.log("Creating Redis client...");

            const redis = require("redis");
            const redisClient = redis.createClient({
                host: process.env.REDIS_HOST,
                port: process.env.REDIS_PORT,
                username: process.env.REDIS_USERNAME,
                password: process.env.REDIS_PASSWORD,
                database: process.env.REDIS_DATABASE,
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

        const txConfig = adrastiaConfig.chains[hre.network.name].txConfig[taskArgs.mode];

        const transactionTimeout = txConfig.validFor * 1000;

        const updateTxHandler = new UpdateTransactionHandler(transactionTimeout);

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
        console.log(`  - delay: ${taskArgs.delay}`);
        console.log(`  - service: ${taskArgs.service}`);
        console.log(`  - type: ${taskArgs.type}`);

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
                    updateTxHandler.handleUpdateTx.bind(updateTxHandler),
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
    solidity: "0.8.15",
    networks: {
        hardhat: {
            forking: process.env.FORKING_URL && {
                url: process.env.FORKING_URL,
                enabled: true,
            },
        },
        polygon: {
            url: process.env.POLYGON_URL,
            accounts: {
                mnemonic: process.env.POLYGON_MNEMONIC,
                path: process.env.POLYGON_PATH ?? DEFAULT_PATH,
                passphrase: process.env.POLYGON_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier:
                parseFloatOrUndefined(process.env.POLYGON_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
        },
        ethereum: {
            url: process.env.ETHEREUM_URL,
            accounts: {
                mnemonic: process.env.ETHEREUM_MNEMONIC,
                path: process.env.ETHEREUM_PATH ?? DEFAULT_PATH,
                passphrase: process.env.ETHEREUM_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier:
                parseFloatOrUndefined(process.env.ETHEREUM_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
        },
        optimism: {
            url: process.env.OPTIMISM_URL,
            accounts: {
                mnemonic: process.env.OPTIMISM_MNEMONIC,
                path: process.env.OPTIMISM_PATH ?? DEFAULT_PATH,
                passphrase: process.env.OPTIMISM_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier:
                parseFloatOrUndefined(process.env.OPTIMISM_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
        },
        arbitrumOne: {
            url: process.env.ARBITRUMONE_URL,
            accounts: {
                mnemonic: process.env.ARBITRUMONE_MNEMONIC,
                path: process.env.ARBITRUMONE_PATH ?? DEFAULT_PATH,
                passphrase: process.env.ARBITRUMONE_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier:
                parseFloatOrUndefined(process.env.ARBITRUMONE_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
        },
        avalanche: {
            url: process.env.AVALANCHE_URL,
            accounts: {
                mnemonic: process.env.AVALANCHE_MNEMONIC,
                path: process.env.AVALANCHE_PATH ?? DEFAULT_PATH,
                passphrase: process.env.AVALANCHE_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier:
                parseFloatOrUndefined(process.env.AVALANCHE_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
        },
        fantom: {
            url: process.env.FANTOM_URL,
            accounts: {
                mnemonic: process.env.FANTOM_MNEMONIC,
                path: process.env.FANTOM_PATH ?? DEFAULT_PATH,
                passphrase: process.env.FANTOM_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier:
                parseFloatOrUndefined(process.env.FANTOM_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
        },
        bsc: {
            url: process.env.BSC_URL,
            accounts: {
                mnemonic: process.env.BSC_MNEMONIC,
                path: process.env.BSC_PATH ?? DEFAULT_PATH,
                passphrase: process.env.BSC_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier:
                parseFloatOrUndefined(process.env.BSC_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
        },
        evmos: {
            url: process.env.EVMOS_URL,
            accounts: {
                mnemonic: process.env.EVMOS_MNEMONIC,
                path: process.env.EVMOS_PATH ?? DEFAULT_PATH,
                passphrase: process.env.EVMOS_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier:
                parseFloatOrUndefined(process.env.EVMOS_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
        },
        polygonZkEVM: {
            url: process.env.POLYGONZKEVM_URL,
            accounts: {
                mnemonic: process.env.POLYGONZKEVM_MNEMONIC,
                path: process.env.POLYGONZKEVM_PATH ?? DEFAULT_PATH,
                passphrase: process.env.POLYGONZKEVM_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier:
                parseFloatOrUndefined(process.env.POLYGONZKEVM_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
        },
        moonbeam: {
            url: process.env.MOONBEAM_URL,
            accounts: {
                mnemonic: process.env.MOONBEAM_MNEMONIC,
                path: process.env.MOONBEAM_PATH ?? DEFAULT_PATH,
                passphrase: process.env.MOONBEAM_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier:
                parseFloatOrUndefined(process.env.MOONBEAM_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
        },
        bobaEthereum: {
            url: process.env.BOBAETHEREUM_URL,
            accounts: {
                mnemonic: process.env.BOBAETHEREUM_MNEMONIC,
                path: process.env.BOBAETHEREUM_PATH ?? DEFAULT_PATH,
                passphrase: process.env.BOBAETHEREUM_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier:
                parseFloatOrUndefined(process.env.BOBAETHEREUM_GASMULTIPLIER) ??
                parseFloatOrUndefined(process.env.DEFAULT_GASMULTIPLIER) ??
                DEFAULT_GASMULTIPLIER,
        },
    },
};

export default config;
