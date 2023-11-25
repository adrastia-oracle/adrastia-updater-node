/*
 * Runs the updater using the signer from Hardhat. We wait for every transaction to be mined up to the specified
 * timeout at which point we drop the transaction.
 */
import Timeout from "await-timeout";

import { ethers, BytesLike, Signer, ContractTransaction, Overrides, ContractTransactionResponse, Addressable } from "ethers";
import { IUpdateable } from "../../typechain/adrastia-core-v4";
import { AutomationCompatibleInterface } from "../../typechain/local";

import { abi as IUPDATEABLE_ABI } from "adrastia-core-v4/artifacts/contracts/interfaces/IUpdateable.sol/IUpdateable.json";

const ONE_GWEI = BigInt("1000000000");

export type UpdateTransactionOptions = {
    gasLimit?: bigint;
    gasPriceMultiplierDividend?: bigint;
    gasPriceMultiplierDivisor?: bigint;
    waitForConfirmations?: number;
    transactionTimeout?: number;
    maxGasPrice?: bigint; // In wei
};

export interface IUpdateTransactionHandler {
    sendUpdateTx(
        updateable: string | Addressable,
        updateData: BytesLike,
        signer: Signer,
        options?: UpdateTransactionOptions
    ): Promise<void>;

    handleUpdateTx(tx: ContractTransactionResponse, signer: Signer): Promise<void>;
}

export class UpdateTransactionHandler implements IUpdateTransactionHandler {
    updateTxOptions: UpdateTransactionOptions;

    constructor(updateTxOptions: UpdateTransactionOptions) {
        if (!updateTxOptions?.transactionTimeout) {
            throw new Error("transactionTimeout must be a number greater than zero");
        }

        this.updateTxOptions = updateTxOptions;
    }

    async dropTransaction(tx: ContractTransaction, signer: Signer) {
        const signerAddress = await signer.getAddress();

        // 20% + 1 GWEI more gas than previous
        var gasPriceToUse: bigint = ((tx.gasPrice * 12n) / 10n) + ONE_GWEI;

        const gasPriceFromProvider: bigint = ((((await signer.provider.getFeeData()).gasPrice) * 12n) / 10n) + ONE_GWEI;
        if (gasPriceFromProvider > gasPriceToUse) {
            gasPriceToUse = gasPriceFromProvider;
        }

        console.log(
            "Dropping transaction with nonce " +
                tx.nonce +
                " and gas price " +
                ethers.formatUnits(gasPriceToUse, "gwei")
        );

        // Transfer 0 ether to self to drop and replace the transaction
        const replacementTx = await signer.sendTransaction({
            from: signerAddress,
            to: signerAddress,
            value: ethers.parseEther("0"),
            nonce: tx.nonce,
            gasPrice: gasPriceToUse,
        });
        try {
            await Timeout.wrap(replacementTx.wait(), this.updateTxOptions.transactionTimeout, "Timeout");
        } catch (e) {
            if (e.message === "Timeout") {
                console.log("Drop transaction timed out. Trying again...");

                await this.dropTransaction(replacementTx, signer);
            }
        }
    }

    async handleUpdateTx(tx: ContractTransactionResponse, signer: Signer) {
        try {
            console.log(
                "Waiting up to " +
                    this.updateTxOptions.transactionTimeout +
                    "ms for transaction to be mined: " +
                    tx.hash
            );

            await Timeout.wrap(tx.wait(), this.updateTxOptions.transactionTimeout, "Timeout");

            console.log("Transaction mined: " + tx.hash);

            const confirmationsRequired = this.updateTxOptions.waitForConfirmations ?? 10;

            console.log("Waiting for " + confirmationsRequired + " confirmations for transaction: " + tx.hash);

            const receipt = await tx.wait(confirmationsRequired);

            const numConfirmations = await receipt.confirmations();

            console.log("Transaction confirmed with " + numConfirmations + " confirmations: " + tx.hash);
        } catch (e) {
            if (e.message === "Timeout") {
                console.log("Transaction timed out: " + tx.hash + ". Dropping...");

                await this.dropTransaction(tx, signer);
            } else {
                console.error("Error waiting for transaction " + tx.hash + ":", e);
            }
        }
    }

    async sendUpdateTxWithOverrides(updateable: string, updateData: BytesLike, signer: Signer, overrides: Overrides) {
        const updateableContract = new ethers.Contract(updateable, IUPDATEABLE_ABI, signer) as unknown as IUpdateable;

        return await updateableContract.update(updateData, overrides);
    }

    async sendUpdateTx(updateable: string | Addressable, updateData: BytesLike, signer: Signer, options?: UpdateTransactionOptions) {
        var gasPriceFromSigner: bigint = (await signer.provider.getFeeData()).gasPrice;
        var gasPrice: bigint = gasPriceFromSigner;

        console.log("Gas price from signer: " + ethers.formatUnits(gasPrice, "gwei"));

        if (options.gasPriceMultiplierDividend && options.gasPriceMultiplierDivisor) {
            // Adjust the gas price by the specified multiplier
            gasPrice = (gasPrice * options.gasPriceMultiplierDividend) / options.gasPriceMultiplierDivisor;

            console.log("Gas price adjusted by tx options: " + ethers.formatUnits(gasPrice, "gwei"));
        } else if (this.updateTxOptions.gasPriceMultiplierDividend && this.updateTxOptions.gasPriceMultiplierDivisor) {
            // Adjust the gas price by the default multiplier
            gasPrice = (gasPrice
                * this.updateTxOptions.gasPriceMultiplierDividend) /
                this.updateTxOptions.gasPriceMultiplierDivisor;

            console.log("Gas price adjusted by instance options: " + ethers.formatUnits(gasPrice, "gwei"));
        }

        // Cap the gas price if specified
        if (options.maxGasPrice && gasPrice > options.maxGasPrice) {
            gasPrice = options.maxGasPrice;

            console.log("Gas price capped by tx options: " + ethers.formatUnits(gasPrice, "gwei"));
        }
        if (this.updateTxOptions.maxGasPrice && gasPrice > this.updateTxOptions.maxGasPrice) {
            gasPrice = this.updateTxOptions.maxGasPrice;

            console.log("Gas price capped by instance options: " + ethers.formatUnits(gasPrice, "gwei"));
        }
        if (gasPrice < gasPriceFromSigner) {
            throw new Error(
                "Calculated gas price is less than the gas price from the signer. The transaction will fail. Aborting..."
            );
        }

        console.log("Sending update transaction with gas price: " + ethers.formatUnits(gasPrice, "gwei"));

        const updateableAddress = typeof updateable === "string" ? updateable : await updateable.getAddress();

        const tx = await this.sendUpdateTxWithOverrides(updateableAddress, updateData, signer, {
            gasLimit: options?.gasLimit ?? this.updateTxOptions.gasLimit,
            gasPrice: gasPrice,
        });

        console.log("Sent update transaction: " + tx.hash);

        await this.handleUpdateTx(tx, signer);
    }
}

export class AciUpdateTransactionHandler extends UpdateTransactionHandler {
    automationCompatibleInterface = require("../../artifacts/contracts/AutomationCompatibleInterface.sol/AutomationCompatibleInterface.json");

    async sendUpdateTxWithOverrides(updateable: string, updateData: BytesLike, signer: Signer, overrides: Overrides) {
        const updateableContract = new ethers.Contract(
            updateable,
            this.automationCompatibleInterface.abi,
            signer
        ) as unknown as AutomationCompatibleInterface;

        return await updateableContract.performUpkeep(updateData, overrides);
    }
}

export class DefenderUpdateTransactionHandler extends UpdateTransactionHandler {
    async handleUpdateTx(tx: ContractTransaction, signer: Signer) {
        // NO-OP: Defender handles the transaction
    }
}
