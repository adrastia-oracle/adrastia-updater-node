/*
 * Runs the updater using the signer from Hardhat. We wait for every transaction to be mined up to the specified
 * timeout at which point we drop the transaction.
 */
import Timeout from "await-timeout";

import { ethers, network } from "hardhat";
import { BigNumber, ethers as _ethers } from "ethers";
import { run } from "../src/tasks/oracle-updater";

import config, { UpdaterMode } from "../adrastia.config";
import { KeyValueStoreClient } from "defender-kvstore-client";

const ONE_GWEI = BigNumber.from("1000000000");

const MODE: UpdaterMode = "normal";

const BATCH: number = 0;

class UpdateTransactionHandler {
    transactionTimeout: number;

    constructor(transactionTimeout: number) {
        this.transactionTimeout = transactionTimeout;
    }

    async dropTransaction(tx: _ethers.ContractTransaction, signer: _ethers.Signer) {
        const signerAddress = await signer.getAddress();

        // 20% + 1 GWEI more gas than previous
        var gasPriceToUse = tx.gasPrice.mul(12).div(10).add(ONE_GWEI);

        const gasPriceFromProvider = (await signer.getGasPrice()).mul(12).div(10).add(ONE_GWEI);
        if (gasPriceFromProvider.gt(gasPriceToUse)) {
            gasPriceToUse = gasPriceFromProvider;
        }

        console.log(
            "Dropping transaction with nonce " +
                tx.nonce +
                " and gas price " +
                ethers.utils.formatUnits(gasPriceToUse, "gwei")
        );

        // Transfer 0 ether to self to drop and replace the transaction
        const replacementTx = await signer.sendTransaction({
            from: signerAddress,
            to: signerAddress,
            value: ethers.utils.parseEther("0"),
            nonce: tx.nonce,
            gasPrice: gasPriceToUse,
        });
        try {
            await Timeout.wrap(replacementTx.wait(), this.transactionTimeout, "Timeout");
        } catch (e) {
            if (e.message === "Timeout") {
                console.log("Drop transaction timed out. Trying again...");

                await this.dropTransaction(replacementTx, signer);
            }
        }
    }

    async handleUpdateTx(tx: _ethers.ContractTransaction, signer: _ethers.Signer) {
        try {
            await Timeout.wrap(tx.wait(), this.transactionTimeout, "Timeout");
        } catch (e) {
            if (e.message === "Timeout") {
                console.log("Transaction timed out. Dropping...");

                await this.dropTransaction(tx, signer);
            }
        }
    }
}

async function main() {
    const accounts = await ethers.getSigners();

    const store = new KeyValueStoreClient({ path: "store.json.tmp" });

    const txConfig = config.chains[network.name].txConfig[MODE];

    const updateTxHandler = new UpdateTransactionHandler(txConfig.validFor * 1000);

    console.log(network.name);

    await run(
        config.chains[network.name].oracles,
        BATCH,
        accounts[BATCH],
        store,
        txConfig.gasLimit,
        false, // only critical
        false, // dry run
        updateTxHandler.handleUpdateTx
    );
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
