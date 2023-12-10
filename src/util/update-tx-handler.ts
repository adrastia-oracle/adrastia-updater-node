/*
 * Runs the updater using the signer from Hardhat. We wait for every transaction to be mined up to the specified
 * timeout at which point we drop the transaction.
 */
import Timeout from "await-timeout";

import {
    ethers,
    BytesLike,
    Signer,
    ContractTransaction,
    Overrides,
    ContractTransactionResponse,
    Addressable,
    FeeData,
} from "ethers";
import { IUpdateable } from "../../typechain/adrastia-core-v4";
import { AutomationCompatibleInterface } from "../../typechain/local";

import { abi as IUPDATEABLE_ABI } from "adrastia-core-v4/artifacts/contracts/interfaces/IUpdateable.sol/IUpdateable.json";
import { Logger } from "winston";
import { getLogger } from "../logging/logging";

const ONE_GWEI = BigInt("1000000000");

export type UpdateTransactionOptions = {
    gasLimit?: bigint;
    gasPriceMultiplierDividend?: bigint;
    gasPriceMultiplierDivisor?: bigint;
    waitForConfirmations?: number;
    transactionTimeout?: number;
    maxGasPrice?: bigint; // In wei
    txType?: number;
};

export interface IUpdateTransactionHandler {
    sendUpdateTx(
        updateable: string | Addressable,
        updateData: BytesLike,
        signer: Signer,
        options?: UpdateTransactionOptions,
    ): Promise<void>;

    handleUpdateTx(tx: ContractTransactionResponse, signer: Signer): Promise<void>;
}

export class UpdateTransactionHandler implements IUpdateTransactionHandler {
    updateTxOptions: UpdateTransactionOptions;

    logger: Logger;

    constructor(updateTxOptions: UpdateTransactionOptions) {
        if (!updateTxOptions?.transactionTimeout) {
            throw new Error("transactionTimeout must be a number greater than zero");
        }

        this.updateTxOptions = updateTxOptions;

        this.logger = getLogger();
    }

    async dropTransaction(tx: ContractTransaction, signer: Signer) {
        const signerAddress = await signer.getAddress();

        // 20% + 1 GWEI more gas than previous
        var gasPriceToUse: bigint = (tx.gasPrice * 12n) / 10n + ONE_GWEI;
        var maxFeePerGasToUse: bigint | null = tx.maxFeePerGas;
        var maxPriorityFeePerGasToUse: bigint | null = tx.maxPriorityFeePerGas;
        if (maxFeePerGasToUse !== null && maxFeePerGasToUse !== undefined) {
            maxFeePerGasToUse = (maxFeePerGasToUse * 12n) / 10n + ONE_GWEI;
        }
        if (maxPriorityFeePerGasToUse !== null && maxPriorityFeePerGasToUse !== undefined) {
            maxPriorityFeePerGasToUse = (maxPriorityFeePerGasToUse * 12n) / 10n + ONE_GWEI;
        }

        // Check if the network is consuming more gas than when the transaction was submitted
        const gasPriceData = await this.getGasPriceData(signer, {
            gasPriceMultiplierDividend: 120n,
            gasPriceMultiplierDivisor: 100n,
        });
        // Add 1 gwei just in-case the scaled gas price is the same as the original gas price
        gasPriceData.gasPrice = gasPriceData.gasPrice + ONE_GWEI;
        if (gasPriceData.maxFeePerGas !== null && gasPriceData.maxFeePerGas !== undefined) {
            gasPriceData.maxFeePerGas = gasPriceData.maxFeePerGas + ONE_GWEI;
        }
        if (gasPriceData.maxPriorityFeePerGas !== null && gasPriceData.maxPriorityFeePerGas !== undefined) {
            gasPriceData.maxPriorityFeePerGas = gasPriceData.maxPriorityFeePerGas + ONE_GWEI;
        }
        if (gasPriceData.gasPrice > gasPriceToUse) {
            // The network is consuming more gas than when the transaction was submitted
            // Replace the gas price with the scaled gas price from the provider
            gasPriceToUse = gasPriceData.gasPrice;
            maxFeePerGasToUse = gasPriceData.maxFeePerGas;
            maxPriorityFeePerGasToUse = gasPriceData.maxPriorityFeePerGas;
        }

        this.logger.info(
            "Dropping transaction with nonce " +
                tx.nonce +
                " and gas price " +
                ethers.formatUnits(gasPriceToUse, "gwei"),
        );

        const txType = this.updateTxOptions.txType ?? 0;

        // Transfer 0 ether to self to drop and replace the transaction
        const replacementTx = await signer.sendTransaction({
            from: signerAddress,
            to: signerAddress,
            value: ethers.parseEther("0"),
            nonce: tx.nonce,
            type: txType,
            gasPrice: txType === 2 ? undefined : gasPriceToUse,
            maxFeePerGas: txType === 2 ? maxFeePerGasToUse : undefined,
            maxPriorityFeePerGas: txType === 2 ? maxPriorityFeePerGasToUse : undefined,
        });
        try {
            await Timeout.wrap(replacementTx.wait(), this.updateTxOptions.transactionTimeout, "Timeout");
        } catch (e) {
            if (e.message === "Timeout") {
                this.logger.info("Drop transaction timed out. Trying again...");

                await this.dropTransaction(replacementTx, signer);
            }
        }
    }

    async handleUpdateTx(tx: ContractTransactionResponse, signer: Signer) {
        const confirmationsRequired = this.updateTxOptions.waitForConfirmations ?? 10;
        if (confirmationsRequired === 0) {
            return;
        }

        try {
            this.logger.info(
                "Waiting up to " +
                    this.updateTxOptions.transactionTimeout +
                    "ms for transaction to be mined: " +
                    tx.hash,
            );

            await Timeout.wrap(tx.wait(), this.updateTxOptions.transactionTimeout, "Timeout");

            this.logger.info("Transaction mined: " + tx.hash);

            if (confirmationsRequired > 1) {
                this.logger.info("Waiting for " + confirmationsRequired + " confirmations for transaction: " + tx.hash);

                const receipt = await tx.wait(confirmationsRequired);

                const numConfirmations = await receipt.confirmations();

                this.logger.info("Transaction confirmed with " + numConfirmations + " confirmations: " + tx.hash);
            }
        } catch (e) {
            if (e.message === "Timeout") {
                this.logger.info("Transaction timed out: " + tx.hash + ". Dropping...");

                await this.dropTransaction(tx, signer);
            } else {
                this.logger.error("Error waiting for transaction " + tx.hash + ":", e);
            }
        }
    }

    async sendUpdateTxWithOverrides(updateable: string, updateData: BytesLike, signer: Signer, overrides: Overrides) {
        const updateableContract = new ethers.Contract(updateable, IUPDATEABLE_ABI, signer) as unknown as IUpdateable;

        return await updateableContract.update(updateData, overrides);
    }

    async getGasPriceData(signer: Signer, options?: UpdateTransactionOptions) {
        const feeData: FeeData = await signer.provider.getFeeData();
        const gasPriceFromSigner = feeData.gasPrice;

        var gasPrice: bigint = gasPriceFromSigner;
        var maxFeePerGas: bigint | null = feeData.maxFeePerGas;
        var maxPriorityFeePerGas: bigint | null = feeData.maxPriorityFeePerGas;

        this.logger.info("Gas price from signer: " + ethers.formatUnits(gasPrice, "gwei"));

        if (options.gasPriceMultiplierDividend && options.gasPriceMultiplierDivisor) {
            // Adjust the gas price by the specified multiplier
            gasPrice = (gasPrice * options.gasPriceMultiplierDividend) / options.gasPriceMultiplierDivisor;

            if (
                maxFeePerGas !== null &&
                maxFeePerGas !== undefined &&
                maxPriorityFeePerGas !== null &&
                maxPriorityFeePerGas !== undefined
            ) {
                maxFeePerGas = (maxFeePerGas * options.gasPriceMultiplierDividend) / options.gasPriceMultiplierDivisor;
                maxPriorityFeePerGas =
                    (maxPriorityFeePerGas * options.gasPriceMultiplierDividend) / options.gasPriceMultiplierDivisor;
            }

            this.logger.info("Gas price adjusted by tx options: " + ethers.formatUnits(gasPrice, "gwei"));
        } else if (this.updateTxOptions.gasPriceMultiplierDividend && this.updateTxOptions.gasPriceMultiplierDivisor) {
            // Adjust the gas price by the default multiplier
            gasPrice =
                (gasPrice * this.updateTxOptions.gasPriceMultiplierDividend) /
                this.updateTxOptions.gasPriceMultiplierDivisor;

            if (
                maxFeePerGas !== null &&
                maxFeePerGas !== undefined &&
                maxPriorityFeePerGas !== null &&
                maxPriorityFeePerGas !== undefined
            ) {
                maxFeePerGas =
                    (maxFeePerGas * this.updateTxOptions.gasPriceMultiplierDividend) /
                    this.updateTxOptions.gasPriceMultiplierDivisor;
                maxPriorityFeePerGas =
                    (maxPriorityFeePerGas * this.updateTxOptions.gasPriceMultiplierDividend) /
                    this.updateTxOptions.gasPriceMultiplierDivisor;
            }

            this.logger.info("Gas price adjusted by instance options: " + ethers.formatUnits(gasPrice, "gwei"));
        }

        // Cap the gas price if specified
        if (options.maxGasPrice && gasPrice > options.maxGasPrice) {
            gasPrice = options.maxGasPrice;

            this.logger.info("Gas price capped by tx options: " + ethers.formatUnits(gasPrice, "gwei"));
        }
        if (this.updateTxOptions.maxGasPrice && gasPrice > this.updateTxOptions.maxGasPrice) {
            gasPrice = this.updateTxOptions.maxGasPrice;

            this.logger.info("Gas price capped by instance options: " + ethers.formatUnits(gasPrice, "gwei"));
        }
        if (gasPrice < gasPriceFromSigner) {
            throw new Error(
                "Calculated gas price is less than the gas price from the signer. The transaction will fail. Aborting...",
            );
        }

        return {
            gasPrice: gasPrice,
            maxFeePerGas: maxFeePerGas,
            maxPriorityFeePerGas: maxPriorityFeePerGas,
        };
    }

    async sendUpdateTx(
        updateable: string | Addressable,
        updateData: BytesLike,
        signer: Signer,
        options?: UpdateTransactionOptions,
    ) {
        const gasPriceData = await this.getGasPriceData(signer, options);

        this.logger.info(
            "Sending update transaction with gas price: " + ethers.formatUnits(gasPriceData.gasPrice, "gwei"),
        );

        const updateableAddress = typeof updateable === "string" ? updateable : await updateable.getAddress();

        const txType = options?.txType ?? this.updateTxOptions.txType ?? 0;

        const tx = await this.sendUpdateTxWithOverrides(updateableAddress, updateData, signer, {
            type: txType,
            gasLimit: options?.gasLimit ?? this.updateTxOptions.gasLimit,
            gasPrice: txType === 2 ? undefined : gasPriceData.gasPrice,
            maxFeePerGas: txType === 2 ? gasPriceData.maxFeePerGas : undefined,
            maxPriorityFeePerGas: txType === 2 ? gasPriceData.maxPriorityFeePerGas : undefined,
        });

        this.logger.info("Sent update transaction (tx type " + txType + "): " + tx.hash);

        await this.handleUpdateTx(tx, signer);
    }
}

export class AciUpdateTransactionHandler extends UpdateTransactionHandler {
    automationCompatibleInterface = require("../../artifacts/contracts/AutomationCompatibleInterface.sol/AutomationCompatibleInterface.json");

    async sendUpdateTxWithOverrides(updateable: string, updateData: BytesLike, signer: Signer, overrides: Overrides) {
        const updateableContract = new ethers.Contract(
            updateable,
            this.automationCompatibleInterface.abi,
            signer,
        ) as unknown as AutomationCompatibleInterface;

        return await updateableContract.performUpkeep(updateData, overrides);
    }
}
