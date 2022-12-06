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

dotenv.config();

const DEFAULT_PATH = "m/44'/60'/0'/0/0";
const DEFAULT_PASSPHRASE = "";

task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
    const accounts = await hre.ethers.getSigners();

    for (var i = 0; i < accounts.length; ++i) {
        console.log(i + ": " + accounts[i].address);
    }
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
    .addFlag("dryRun", "Whether to run the updater in dry-run mode.")
    .setAction(async (taskArgs, hre) => {
        const accounts = await hre.ethers.getSigners();

        const store = new KeyValueStoreClient({ path: "store.json.tmp" });

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

        console.log("Starting the oracle updater with the following parameters:");
        console.log(`  - batch: ${taskArgs.batch}`);
        console.log(`  - mode: ${taskArgs.mode}`);
        console.log(`  - every: ${taskArgs.every}`);
        console.log(`  - dryRun: ${taskArgs.dryRun}`);
        console.log(`  - transactionTimeout: ${transactionTimeout}`);
        console.log(`  - delay: ${taskArgs.delay}`);

        if (proxyConfig !== undefined) {
            console.log(`  - proxy: ${proxyConfig.auth?.username}@${proxyConfig.host}:${proxyConfig.port}`);
        }

        const repeatInterval = taskArgs.every ?? 0;
        const repeatTimes = taskArgs.every === undefined ? 1 : Number.MAX_SAFE_INTEGER;

        var timesRepeated = 0;

        while (timesRepeated++ < repeatTimes) {
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
            forking: {
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
            gasMultiplier: 1.25,
        },
        ethereum: {
            url: process.env.ETHEREUM_URL,
            accounts: {
                mnemonic: process.env.ETHEREUM_MNEMONIC,
                path: process.env.ETHEREUM_PATH ?? DEFAULT_PATH,
                passphrase: process.env.ETHEREUM_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier: 1.25,
        },
        optimism: {
            url: process.env.OPTIMISM_URL,
            accounts: {
                mnemonic: process.env.OPTIMISM_MNEMONIC,
                path: process.env.OPTIMISM_PATH ?? DEFAULT_PATH,
                passphrase: process.env.OPTIMISM_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier: 1.25,
        },
        arbitrumOne: {
            url: process.env.ARBITRUMONE_URL,
            accounts: {
                mnemonic: process.env.ARBITRUMONE_MNEMONIC,
                path: process.env.ARBITRUMONE_PATH ?? DEFAULT_PATH,
                passphrase: process.env.ARBITRUMONE_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier: 1.25,
        },
        avalanche: {
            url: process.env.AVALANCHE_URL,
            accounts: {
                mnemonic: process.env.AVALANCHE_MNEMONIC,
                path: process.env.AVALANCHE_PATH ?? DEFAULT_PATH,
                passphrase: process.env.AVALANCHE_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier: 1.25,
        },
        fantom: {
            url: process.env.FANTOM_URL,
            accounts: {
                mnemonic: process.env.FANTOM_MNEMONIC,
                path: process.env.FANTOM_PATH ?? DEFAULT_PATH,
                passphrase: process.env.FANTOM_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier: 1.25,
        },
        bsc: {
            url: process.env.BSC_URL,
            accounts: {
                mnemonic: process.env.BSC_MNEMONIC,
                path: process.env.BSC_PATH ?? DEFAULT_PATH,
                passphrase: process.env.BSC_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier: 1.25,
        },
        evmos: {
            url: process.env.EVMOS_URL,
            accounts: {
                mnemonic: process.env.EVMOS_MNEMONIC,
                path: process.env.EVMOS_PATH ?? DEFAULT_PATH,
                passphrase: process.env.EVMOS_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
            gasMultiplier: 1.25,
        },
    },
};

export default config;
