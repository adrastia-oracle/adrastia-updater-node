import * as dotenv from "dotenv";

import "@nomiclabs/hardhat-waffle";

import { task } from "hardhat/config";
import { HardhatUserConfig } from "hardhat/types";

dotenv.config();

const DEFAULT_PATH = "m/44'/60'/0'/0/0";
const DEFAULT_PASSPHRASE = "";

task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
    const accounts = await hre.ethers.getSigners();

    for (var i = 0; i < accounts.length; ++i) {
        console.log(i + ": " + accounts[i].address);
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
        },
        ethereum: {
            url: process.env.ETHEREUM_URL,
            accounts: {
                mnemonic: process.env.ETHEREUM_MNEMONIC,
                path: process.env.ETHEREUM_PATH ?? DEFAULT_PATH,
                passphrase: process.env.ETHEREUM_PASSPHRASE ?? DEFAULT_PASSPHRASE,
            },
        },
    },
};

export default config;
