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
import { Web3 } from "web3";
import { IUpdateable } from "../../typechain/adrastia-core-v4";
import { AutomationCompatibleInterface } from "../../typechain/local";

import { abi as IUPDATEABLE_ABI } from "adrastia-core-v4/artifacts/contracts/interfaces/IUpdateable.sol/IUpdateable.json";
import { Logger } from "winston";
import { getLogger } from "../logging/logging";
import { ERROR, NOTICE, WARNING } from "../logging/log-levels";
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
    web3: Web3;
    updateTxOptions: TxConfig;

    logger: Logger;

    constructor(web3: Web3, updateTxOptions: TxConfig) {
        if (!updateTxOptions?.transactionTimeout) {
            throw new Error("transactionTimeout must be a number greater than zero");
        }

        this.web3 = web3;
        this.updateTxOptions = updateTxOptions;

        this.logger = getLogger();
    }

    async dropTransaction(
        tx: ContractTransaction,
        signer: Signer,
        dropStartTime: number,
        dropTries: number,
        maxDropTries: number,
        options?: TxConfig,
        metadata?: WorkItemMetadata,
    ) {
        if (dropTries >= maxDropTries) {
            this.logger.log(ERROR, "Max drop tries reached. Aborting drop transaction.");

            return;
        }

        const signerAddress = await signer.getAddress();

        // 25% + 1 GWEI more gas than previous
        var gasPriceToUse: bigint = (tx.gasPrice * 125n) / 100n + ONE_GWEI;
        var maxFeePerGasToUse: bigint | null = tx.maxFeePerGas;
        var maxPriorityFeePerGasToUse: bigint | null = tx.maxPriorityFeePerGas;
        if (maxFeePerGasToUse !== null && maxFeePerGasToUse !== undefined) {
            maxFeePerGasToUse = (maxFeePerGasToUse * 125n) / 100n + ONE_GWEI;
        }
        if (maxPriorityFeePerGasToUse !== null && maxPriorityFeePerGasToUse !== undefined) {
            maxPriorityFeePerGasToUse = (maxPriorityFeePerGasToUse * 125n) / 100n + ONE_GWEI;
        }

        const txConfig = options ??
            this.updateTxOptions ?? {
                gasPriceMultiplierDividend: 125n,
                gasPriceMultiplierDivisor: 100n,
            };

        // Check if the network is consuming more gas than when the transaction was submitted
        const gasPriceData = await this.getGasPriceData(signer, {
            ...txConfig,
            maxGasPrice: undefined, // Drop transaction should not be capped
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

                await this.dropTransaction(tx, signer, dropStartTime, dropTries + 1, maxDropTries, options, metadata);

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

                await this.dropTransaction(
                    replacementTx,
                    signer,
                    dropStartTime,
                    dropTries + 1,
                    maxDropTries,
                    options,
                    metadata,
                );
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

                await this.dropTransaction(tx, signer, dropStartTime, 0, 5, options, metadata);
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

    formatFeeHistory(result, includePending: boolean, historicalBlocks: number) {
        var blockNum: bigint = result.oldestBlock;
        var index: number = 0;
        const blocks = [];
        const highBlock: bigint = result.oldestBlock + BigInt(historicalBlocks);
        while (blockNum < highBlock) {
            blocks.push({
                number: blockNum,
                baseFeePerGas: result.baseFeePerGas[index],
                gasUsedRatio: result.gasUsedRatio[index],
                priorityFeePerGas: result.reward[index].map((x) => BigInt(x)),
            });
            blockNum += 1n;
            index += 1;
        }
        if (includePending) {
            blocks.push({
                number: "pending",
                baseFeePerGas: result.baseFeePerGas[historicalBlocks],
                gasUsedRatio: NaN,
                priorityFeePerGas: [],
            });
        }
        return blocks;
    }

    avg(arr: bigint[]) {
        const sum: bigint = arr.reduce((a, v) => a + v);

        return sum / BigInt(arr.length);
    }

    async getFeeData(historicalBlocks: number, percentile: number) {
        const feeHistory = await this.web3.eth.getFeeHistory(historicalBlocks, "pending", [percentile]);

        const blocks = this.formatFeeHistory(feeHistory, false, historicalBlocks);

        const priorityFeePerGas = this.avg(blocks.map((b) => b.priorityFeePerGas[0]));

        const block = await this.web3.eth.getBlock("pending");

        const baseFeePerGas = block.baseFeePerGas;

        return {
            baseFeePerGas: baseFeePerGas,
            maxPriorityFeePerGas: priorityFeePerGas,
            maxFeePerGas: baseFeePerGas + priorityFeePerGas,
        };
    }

    async getGasPriceData(signer: Signer, options?: TxConfig) {
        var gasPrice: bigint;
        var maxFeePerGas: bigint | undefined;
        var maxPriorityFeePerGas: bigint | undefined;

        const txType = options?.txType ?? this.updateTxOptions.txType ?? 0;
        if (txType === 2) {
            const defaultPercentile = 50;
            const defaultHistoricalBlocks = 5;

            var percentile =
                options?.eip1559?.percentile ?? this.updateTxOptions.eip1559?.percentile ?? defaultPercentile;
            var historicalBlocks =
                options?.eip1559?.historicalBlocks ??
                this.updateTxOptions.eip1559?.historicalBlocks ??
                defaultHistoricalBlocks;

            if (percentile < 1 || percentile > 100) {
                this.logger.log(
                    WARNING,
                    "Invalid percentile value of " + percentile + ". Using default value of " + defaultPercentile + ".",
                );

                percentile = defaultPercentile;
            }
            if (historicalBlocks < 1) {
                this.logger.log(
                    WARNING,
                    "Invalid historicalBlocks value of " +
                        historicalBlocks +
                        ". Using default value of " +
                        defaultHistoricalBlocks +
                        ".",
                );

                historicalBlocks = defaultHistoricalBlocks;
            }

            const feeData = await this.getFeeData(historicalBlocks, percentile);

            gasPrice = feeData.maxFeePerGas;
            maxFeePerGas = feeData.maxFeePerGas;
            maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
        } else {
            const feeData: FeeData = await signer.provider.getFeeData();

            gasPrice = feeData.gasPrice;
            maxFeePerGas = undefined;
            maxPriorityFeePerGas = undefined;
        }

        this.logger.info(
            "Gas price from signer: " +
                ethers.formatUnits(gasPrice, "gwei") +
                (txType === 2
                    ? " (EIP-1559, base fee = " +
                      ethers.formatUnits(maxFeePerGas - maxPriorityFeePerGas, "gwei") +
                      ", priority fee = " +
                      ethers.formatUnits(maxPriorityFeePerGas, "gwei") +
                      ")"
                    : ""),
        );

        if (options?.gasPriceMultiplierDividend && options?.gasPriceMultiplierDivisor) {
            // Adjust the gas price by the specified multiplier
            gasPrice = (gasPrice * options.gasPriceMultiplierDividend) / options.gasPriceMultiplierDivisor;

            if (maxFeePerGas != null && maxPriorityFeePerGas != null) {
                maxFeePerGas = (maxFeePerGas * options.gasPriceMultiplierDividend) / options.gasPriceMultiplierDivisor;
                maxPriorityFeePerGas =
                    (maxPriorityFeePerGas * options.gasPriceMultiplierDividend) / options.gasPriceMultiplierDivisor;
            }

            this.logger.info(
                "Gas price adjusted by tx options: " +
                    ethers.formatUnits(gasPrice, "gwei") +
                    (txType === 2
                        ? " (EIP-1559, base fee = " +
                          ethers.formatUnits(maxFeePerGas - maxPriorityFeePerGas, "gwei") +
                          ", priority fee = " +
                          ethers.formatUnits(maxPriorityFeePerGas, "gwei") +
                          ")"
                        : ""),
            );
        } else if (
            this.updateTxOptions?.gasPriceMultiplierDividend &&
            this.updateTxOptions?.gasPriceMultiplierDivisor
        ) {
            // Adjust the gas price by the default multiplier
            gasPrice =
                (gasPrice * this.updateTxOptions.gasPriceMultiplierDividend) /
                this.updateTxOptions.gasPriceMultiplierDivisor;

            if (maxFeePerGas != null && maxPriorityFeePerGas != null) {
                maxFeePerGas =
                    (maxFeePerGas * this.updateTxOptions.gasPriceMultiplierDividend) /
                    this.updateTxOptions.gasPriceMultiplierDivisor;
                maxPriorityFeePerGas =
                    (maxPriorityFeePerGas * this.updateTxOptions.gasPriceMultiplierDividend) /
                    this.updateTxOptions.gasPriceMultiplierDivisor;
            }

            this.logger.info(
                "Gas price adjusted by instance options: " +
                    ethers.formatUnits(gasPrice, "gwei") +
                    (txType === 2
                        ? " (EIP-1559, base fee = " +
                          ethers.formatUnits(maxFeePerGas - maxPriorityFeePerGas, "gwei") +
                          ", priority fee = " +
                          ethers.formatUnits(maxPriorityFeePerGas, "gwei") +
                          ")"
                        : ""),
            );
        }

        // Cap the gas price if specified
        if (options?.maxGasPrice && gasPrice > options?.maxGasPrice) {
            gasPrice = options.maxGasPrice;

            if (maxFeePerGas != null && maxPriorityFeePerGas != null) {
                const delta = maxFeePerGas - gasPrice;
                if (delta > 0n) {
                    maxFeePerGas -= delta;
                    maxPriorityFeePerGas -= delta;
                    if (maxPriorityFeePerGas < 0n) {
                        maxPriorityFeePerGas = 0n;
                    }
                }
            }

            this.logger.info(
                "Gas price capped by tx options: " +
                    ethers.formatUnits(gasPrice, "gwei") +
                    (txType === 2
                        ? " (EIP-1559, base fee = " +
                          ethers.formatUnits(maxFeePerGas - maxPriorityFeePerGas, "gwei") +
                          ", priority fee = " +
                          ethers.formatUnits(maxPriorityFeePerGas, "gwei") +
                          ")"
                        : ""),
            );
        }
        if (this.updateTxOptions?.maxGasPrice && gasPrice > this.updateTxOptions?.maxGasPrice) {
            gasPrice = this.updateTxOptions?.maxGasPrice;

            if (maxFeePerGas != null && maxPriorityFeePerGas != null) {
                const delta = maxFeePerGas - gasPrice;
                if (delta > 0n) {
                    maxFeePerGas -= delta;
                    maxPriorityFeePerGas -= delta;
                    if (maxPriorityFeePerGas < 0n) {
                        maxPriorityFeePerGas = 0n;
                    }
                }
            }

            this.logger.info(
                "Gas price capped by instance options: " +
                    ethers.formatUnits(gasPrice, "gwei") +
                    (txType === 2
                        ? " (EIP-1559, base fee = " +
                          ethers.formatUnits(maxFeePerGas - maxPriorityFeePerGas, "gwei") +
                          ", priority fee = " +
                          ethers.formatUnits(maxPriorityFeePerGas, "gwei") +
                          ")"
                        : ""),
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
