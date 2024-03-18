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
    TransactionReceipt,
    TransactionResponse,
} from "ethers";
import { IUpdateable } from "../../typechain/adrastia-core-v4";
import { AutomationCompatibleInterface } from "../../typechain/local";

import { abi as IUPDATEABLE_ABI } from "adrastia-core-v4/artifacts/contracts/interfaces/IUpdateable.sol/IUpdateable.json";
import { Logger } from "winston";
import { getLogger } from "../logging/logging";
import { NOTICE } from "../logging/log-levels";
import { TxConfig } from "../config/adrastia-config";

const ONE_GWEI = BigInt("1000000000");
const ZERO = BigInt("0");

export interface IUpdateTransactionHandler {
    sendUpdateTx(
        updateable: string | Addressable,
        updateData: BytesLike,
        signer: Signer,
        options?: TxConfig,
        metadata?: WorkItemMetadata,
    ): Promise<void>;

    handleUpdateTx(tx: ContractTransactionResponse, signer: Signer): Promise<void>;
}

export type WorkItemMetadata = {
    discoveryTimeMs?: number;
};

export class UpdateTransactionHandler implements IUpdateTransactionHandler {
    updateTxOptions: TxConfig;

    logger: Logger;

    constructor(updateTxOptions: TxConfig) {
        if (!updateTxOptions?.transactionTimeout) {
            throw new Error("transactionTimeout must be a number greater than zero");
        }

        this.updateTxOptions = updateTxOptions;

        this.logger = getLogger();
    }

    async dropTransaction(
        tx: ContractTransaction,
        signer: Signer,
        dropStartTime: number,
        options?: TxConfig,
        metadata?: WorkItemMetadata,
    ) {
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
        const gasPriceData = await this.getGasPriceData(
            signer,
            options ?? {
                gasPriceMultiplierDividend: 120n,
                gasPriceMultiplierDivisor: 100n,
            },
        );
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

        this.logger.log(
            NOTICE,
            "Dropping transaction with nonce " +
                tx.nonce +
                " and gas price " +
                ethers.formatUnits(gasPriceToUse, "gwei"),
        );

        const txType = options.txType ?? this.updateTxOptions.txType ?? 0;

        var replacementTx;
        try {
            // Transfer 0 ether to self to drop and replace the transaction
            replacementTx = await signer.sendTransaction({
                from: signerAddress,
                to: signerAddress,
                value: ethers.parseEther("0"),
                nonce: tx.nonce,
                type: txType,
                gasPrice: txType === 2 ? undefined : gasPriceToUse,
                maxFeePerGas: txType === 2 ? maxFeePerGasToUse : undefined,
                maxPriorityFeePerGas: txType === 2 ? maxPriorityFeePerGasToUse : undefined,
            });
        } catch (e) {
            if (e.message?.includes("replacement transaction underpriced")) {
                this.logger.log(NOTICE, "Replacement transaction underpriced. Trying again...");

                await this.dropTransaction(tx, signer, dropStartTime, options, metadata);

                return;
            } else {
                throw e;
            }
        }
        try {
            const receiptPromise = replacementTx.wait();

            const transactionTimeout = options.transactionTimeout ?? this.updateTxOptions.transactionTimeout ?? 60000;

            await Timeout.wrap(receiptPromise, transactionTimeout, "Timeout");

            const dropTime = Date.now();
            const timeToDrop = dropTime - dropStartTime;
            var totalWaitTime;

            if (metadata?.discoveryTimeMs) {
                totalWaitTime = dropTime - metadata.discoveryTimeMs;
            } else {
                this.logger.warn("Metadata discoveryTimeMs not found. Cannot calculate total drop wait time.");
            }

            const receipt = await receiptPromise;
            const gasData = this.extractGasData(replacementTx, receipt);

            this.logger.log(
                NOTICE,
                "Dropped transaction with nonce " +
                    tx.nonce +
                    " and replaced it with " +
                    replacementTx.hash +
                    " in " +
                    timeToDrop +
                    "ms",
                {
                    droppedUpdateTx: {
                        dropped: 1,
                        timeToDrop: timeToDrop,
                        ...gasData,
                        totalWaitTime: totalWaitTime,
                    },
                },
            );
        } catch (e) {
            if (e.message === "Timeout") {
                this.logger.log(NOTICE, "Drop transaction timed out. Trying again...");

                // The wait() call is still listening for the transaction to be mined. Remove all listeners to prevent
                // spamming the RPC node with requests.
                await signer.provider.removeAllListeners();

                await this.dropTransaction(replacementTx, signer, dropStartTime, options, metadata);
            }
        }
    }

    extractGasData(tx: TransactionResponse, receipt: TransactionReceipt | undefined) {
        var gasPrice: bigint = receipt.gasPrice ?? ZERO;
        const gasUsed: bigint = receipt.gasUsed ?? ZERO;
        var gasFee: bigint = receipt.fee ?? ZERO;
        const gasLimit: bigint = tx.gasLimit ?? ZERO;
        const sufficientGas = receipt.status == 1 || gasUsed < gasLimit;

        if (gasPrice === ZERO) {
            // If the gas price is not in the receipt, we take it from the transaction response
            // This occurance has been seen with Rootstock RPC providers
            gasPrice = tx.gasPrice ?? ZERO;
        }
        if (gasFee === ZERO) {
            // If the gas fee is not in the receipt, we calculate it from the gas price and gas used
            // This occurance has been seen with Rootstock RPC providers
            gasFee = gasPrice * gasUsed;
        }

        // The total fee in wei can easily surpass MAX_SAFE_INTEGER, so we convert it to a floating point number in gwei
        const feeInGwei = Number(ethers.formatUnits(gasFee.toString(), "gwei"));

        const gasUsedPercent = (gasUsed * 1000000n) / gasLimit;

        return {
            gasUsed: Number(gasUsed),
            gasLimit: Number(gasLimit),
            gasUsedPercent: Number(gasUsedPercent) / 10000,
            sufficientGas: sufficientGas ? 1 : 0,
            gasPrice: Number(gasPrice), // in wei
            fee: feeInGwei, // in gwei
        };
    }

    async handleUpdateTx(
        tx: ContractTransactionResponse,
        signer: Signer,
        options?: TxConfig,
        metadata?: WorkItemMetadata,
    ) {
        const confirmationsRequired = options.waitForConfirmations ?? this.updateTxOptions.waitForConfirmations ?? 5;
        if (confirmationsRequired === 0) {
            return;
        }

        const sendTime = Date.now();

        try {
            const transactionTimeout = options.transactionTimeout ?? this.updateTxOptions.transactionTimeout ?? 60000;

            this.logger.info("Waiting up to " + transactionTimeout + "ms for transaction to be mined: " + tx.hash);

            const txReceiptPromise = tx.wait();

            await Timeout.wrap(txReceiptPromise, transactionTimeout, "Timeout");

            const minedTime = Date.now();
            const timeToMine = minedTime - sendTime;
            var totalWaitTime;

            if (metadata?.discoveryTimeMs) {
                totalWaitTime = minedTime - metadata.discoveryTimeMs;
            } else {
                this.logger.warn("Metadata discoveryTimeMs not found. Cannot calculate total mined wait time.");
            }

            const receipt = await txReceiptPromise;
            const gasData = this.extractGasData(tx, receipt);

            this.logger.log(NOTICE, "Transaction mined in " + timeToMine + "ms: " + tx.hash, {
                minedUpdateTx: {
                    mined: 1,
                    timeToMine: timeToMine,
                    ...gasData,
                    totalWaitTime: totalWaitTime,
                },
            });

            if (confirmationsRequired > 1) {
                this.logger.info("Waiting for " + confirmationsRequired + " confirmations for transaction: " + tx.hash);

                const receipt = await tx.wait(confirmationsRequired);

                const numConfirmations = await receipt.confirmations();

                this.logger.info("Transaction confirmed with " + numConfirmations + " confirmations: " + tx.hash);
            }
        } catch (e) {
            if (e.message === "Timeout") {
                this.logger.log(NOTICE, "Transaction timed out: " + tx.hash + ". Dropping...");

                // The wait() call is still listening for the transaction to be mined. Remove all listeners to prevent
                // spamming the RPC node with requests.
                await signer.provider.removeAllListeners();

                const dropStartTime = Date.now();

                await this.dropTransaction(tx, signer, dropStartTime, options, metadata);
            } else {
                if (e.message?.includes("transaction execution reverted")) {
                    const timeReverted = Date.now();
                    const timeToRevert = timeReverted - sendTime;
                    var totalWaitTime;

                    if (metadata?.discoveryTimeMs) {
                        totalWaitTime = timeReverted - metadata.discoveryTimeMs;
                    } else {
                        this.logger.warn(
                            "Metadata discoveryTimeMs not found. Cannot calculate total revert wait time.",
                        );
                    }

                    const gasData = this.extractGasData(tx, e.receipt);

                    this.logger.log(NOTICE, "Transaction reverted in " + timeToRevert + "ms: " + tx.hash, {
                        revertedUpdateTx: {
                            reverted: 1,
                            timeToRevert: timeToRevert,
                            ...gasData,
                            totalWaitTime: totalWaitTime,
                        },
                    });
                }

                this.logger.error("Error waiting for transaction " + tx.hash + ".", { error: e });
            }
        }
    }

    async sendUpdateTxWithOverrides(updateable: string, updateData: BytesLike, signer: Signer, overrides: Overrides) {
        const updateableContract = new ethers.Contract(updateable, IUPDATEABLE_ABI, signer) as unknown as IUpdateable;

        return await updateableContract.update(updateData, overrides);
    }

    async getGasPriceData(signer: Signer, options?: TxConfig) {
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
        options?: TxConfig,
        metadata?: WorkItemMetadata,
    ) {
        const gasPriceData = await this.getGasPriceData(signer, options);

        this.logger.log(
            NOTICE,
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

        this.logger.log(NOTICE, "Sent update transaction (tx type " + txType + "): " + tx.hash);

        await this.handleUpdateTx(tx, signer, options, metadata);
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
