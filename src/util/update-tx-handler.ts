/*
 * Runs the updater using the signer from Hardhat. We wait for every transaction to be mined up to the specified
 * timeout at which point we drop the transaction.
 */
import Timeout from "await-timeout";

import { BigNumber, ethers } from "ethers";

const ONE_GWEI = BigNumber.from("1000000000");

export class UpdateTransactionHandler {
    transactionTimeout: number;

    constructor(transactionTimeout: number) {
        this.transactionTimeout = transactionTimeout;
    }

    async dropTransaction(tx: ethers.ContractTransaction, signer: ethers.Signer) {
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

    async handleUpdateTx(tx: ethers.ContractTransaction, signer: ethers.Signer) {
        try {
            console.log("Waiting up to " + this.transactionTimeout + "ms for transaction to be mined: " + tx.hash);

            await Timeout.wrap(tx.wait(), this.transactionTimeout, "Timeout");

            console.log("Transaction mined: " + tx.hash);

            const confirmationsRequired = 10;

            console.log("Waiting for " + confirmationsRequired + " confirmations for transaction: " + tx.hash);

            const receipt = await tx.wait(confirmationsRequired);

            console.log("Transaction confirmed with " + receipt.confirmations + " confirmations: " + tx.hash);
        } catch (e) {
            if (e.message === "Timeout") {
                console.log("Transaction timed out: " + tx.hash + ". Dropping...");

                await this.dropTransaction(tx, signer);
            } else {
                console.error("Error waiting for transaction " + tx.hash + ":", e);
            }
        }
    }
}
