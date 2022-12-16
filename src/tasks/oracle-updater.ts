// Import dependencies available in the autotask environment
import { DefenderRelayProvider, DefenderRelaySigner } from "defender-relay-client/lib/ethers";
import { BaseContract, BigNumber, ethers } from "ethers";
import { Signer } from "@ethersproject/abstract-signer";

// Import typechain
import { IERC165 } from "../../typechain";
import {
    IAccumulator,
    IAggregatedOracle,
    IHasLiquidityAccumulator,
    IHasPriceAccumulator,
    IOracle,
} from "../../typechain/interfaces";
import { LiquidityAccumulator, PriceAccumulator } from "../../typechain/accumulators";

// Import ABIs
import { abi as IERC165_ABI } from "@openzeppelin-v4/contracts/build/contracts/IERC165.json";
import { abi as AGGREGATED_ORACLE_ABI } from "@adrastia-oracle/adrastia-core/artifacts/contracts/oracles/AggregatedOracle.sol/AggregatedOracle.json";
import { abi as PRICE_ACCUMULATOR_ABI } from "@adrastia-oracle/adrastia-core/artifacts/contracts/accumulators/PriceAccumulator.sol/PriceAccumulator.json";
import { abi as LIQUIDITY_ACCUMULATOR_ABI } from "@adrastia-oracle/adrastia-core/artifacts/contracts/accumulators/LiquidityAccumulator.sol/LiquidityAccumulator.json";
import { abi as HAS_PRICE_ACCUMULATOR_ABI } from "@adrastia-oracle/adrastia-core/artifacts/contracts/interfaces/IHasPriceAccumulator.sol/IHasPriceAccumulator.json";
import { abi as HAS_LIQUIDITY_ACCUMULATOR_ABI } from "@adrastia-oracle/adrastia-core/artifacts/contracts/interfaces/IHasLiquidityAccumulator.sol/IHasLiquidityAccumulator.json";

// Import config
import config, { OracleConfig, TokenConfig, ValidationRoute } from "../../adrastia.config";
import { Speed } from "defender-relay-client";
import { KeyValueStoreClient } from "defender-kvstore-client";
import { AggregatedOracle } from "../../typechain/oracles";

import axios, { AxiosInstance, AxiosProxyConfig, AxiosResponse } from "axios";
import axiosRetry from "axios-retry";
import { setupCache } from "axios-cache-adapter";
import { IKeyValueStore } from "../util/key-value-store";

// TODO: Track the items put into the store and use that to implement clear, length, and iterate
class DefenderAxiosStore {
    store: IKeyValueStore;
    prefix: string;

    constructor(store: IKeyValueStore, prefix: string) {
        this.store = store;
        this.prefix = prefix;
    }

    async getItem(key) {
        const item = (await this.store.get(this.prefix + key)) || null;

        return JSON.parse(item);
    }

    async setItem(key, value) {
        await this.store.put(this.prefix + key, JSON.stringify(value));

        return value;
    }

    async removeItem(key) {
        await this.store.del(this.prefix + key);
    }

    async clear() {
        // no-op
    }

    async length() {
        return 0; // no-op
    }

    iterate(fn) {
        // no-op
    }
}

const median = (arr: number[]): number | undefined => {
    if (!arr.length) return undefined;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2.0 : s[mid];
};

const sum = (arr): number => {
    return arr.reduce(function (previous, current) {
        return previous + current;
    });
};

const weightedMedian = (values: number[], weights: number[]): number => {
    var midpoint = 0.5 * sum(weights);

    var cumulativeWeight = 0;
    var belowMidpointIndex = 0;

    var sortedValues = [];
    var sortedWeights = [];

    values
        .map(function (value, i) {
            return [value, weights[i]];
        })
        .sort(function (a, b) {
            return a[0] - b[0];
        })
        .map(function (pair) {
            sortedValues.push(pair[0]);
            sortedWeights.push(pair[1]);
        });

    if (
        sortedWeights.some(function (value) {
            return value > midpoint;
        })
    ) {
        return sortedValues[sortedWeights.indexOf(Math.max.apply(null, sortedWeights))];
    }

    while (cumulativeWeight <= midpoint) {
        belowMidpointIndex++;
        cumulativeWeight += sortedWeights[belowMidpointIndex - 1];
    }

    cumulativeWeight -= sortedWeights[belowMidpointIndex - 1];

    if (cumulativeWeight - midpoint < Number.EPSILON) {
        var bounds = sortedValues.slice(belowMidpointIndex - 2, belowMidpointIndex);
        return sum(bounds) / bounds.length;
    }

    return sortedValues[belowMidpointIndex - 1];
};

export class AdrastiaUpdater {
    // Interface IDs
    static IHASLIQUIDITYACCUMULATOR_INTERFACEID = "0x06a5df37";
    static IHASPRICEACCUMULATOR_INTERFACEID = "0x6b72d0ba";
    static IAGGREGATEDORACLE_INTERFACEID = "0xce2362c4";

    chain: string;
    signer: Signer;
    store: IKeyValueStore;
    handleUpdateTx: (tx: ethers.ContractTransaction, signer: Signer) => Promise<void>;
    updateDelay: number; // in seconds

    useGasLimit = 1000000;
    onlyCritical = false;
    dryRun = false;

    axiosInstance: AxiosInstance;

    proxyConfig?: AxiosProxyConfig;

    constructor(
        chain: string,
        signer: Signer,
        store: IKeyValueStore,
        useGasLimit: number,
        onlyCritical: boolean,
        dryRun: boolean,
        handleUpdateTx: (tx: ethers.ContractTransaction, signer: Signer) => Promise<void>,
        updateDelay: number,
        httpCacheSeconds: number,
        proxyConfig?: AxiosProxyConfig
    ) {
        this.chain = chain;
        this.signer = signer;
        this.store = store;
        this.handleUpdateTx = handleUpdateTx;
        this.updateDelay = updateDelay;

        this.useGasLimit = useGasLimit;
        this.onlyCritical = onlyCritical;
        this.dryRun = dryRun;

        this.proxyConfig = proxyConfig;

        const axiosCache = setupCache({
            maxAge: httpCacheSeconds * 1000,
            exclude: {
                query: false, // Allow caching of requests with query params
            },
            // Attempt reading stale cache data when we're being rate limited
            readOnError: (error, request) => {
                console.log(error);
                return error.response.status == 429 /* back-off warning */ || error.response.status == 418 /* IP ban */;
            },
            // Deactivate `clearOnStale` option so that we can actually read stale cache data
            clearOnStale: false,
            store: new DefenderAxiosStore(this.store, ""),
        });

        this.axiosInstance = axios.create({
            adapter: axiosCache.adapter,
        });

        axiosRetry(this.axiosInstance, {
            retries: 3,
            retryDelay: axiosRetry.exponentialDelay,
        });
    }

    async getAccumulators(oracleAddress: string, token: string) {
        let las: LiquidityAccumulator[] = [];
        let pas: PriceAccumulator[] = [];

        console.log("Discovering accumulators for oracle: " + oracleAddress);

        const lasStoreKey = this.chain + "." + oracleAddress + ".las";
        const pasStoreKey = this.chain + "." + oracleAddress + ".pas";

        const lasFromStore = await this.store.get(lasStoreKey);
        const pasFromStore = await this.store.get(pasStoreKey);

        if (
            lasFromStore !== undefined &&
            pasFromStore !== undefined &&
            lasFromStore !== null &&
            pasFromStore !== null
        ) {
            // Use accumulators from the store rather than querying for all of them
            const laAddresses = lasFromStore.split(",");
            const paAddresses = pasFromStore.split(",");

            for (const accumulatorAddress of laAddresses) {
                const accumulator: LiquidityAccumulator = new ethers.Contract(
                    accumulatorAddress,
                    LIQUIDITY_ACCUMULATOR_ABI,
                    this.signer
                ) as LiquidityAccumulator;

                las.push(accumulator);

                console.log("Added liquidity accumulator from store: " + accumulatorAddress);
            }

            for (const accumulatorAddress of paAddresses) {
                const accumulator: PriceAccumulator = new ethers.Contract(
                    accumulatorAddress,
                    PRICE_ACCUMULATOR_ABI,
                    this.signer
                ) as PriceAccumulator;

                pas.push(accumulator);

                console.log("Added price accumulator from store: " + accumulatorAddress);
            }

            return {
                las: las,
                pas: pas,
            };
        } else {
            // Delete accumulators in storage so as to not add duplicates later on
            await this.store.del(lasStoreKey);
            await this.store.del(pasStoreKey);
        }

        // Assume the oracle implements IERC165
        const erc165: IERC165 = new ethers.Contract(oracleAddress, IERC165_ABI, this.signer) as IERC165;

        // Check if the oracle has a liquidity accumulator
        if (await erc165.supportsInterface(AdrastiaUpdater.IHASLIQUIDITYACCUMULATOR_INTERFACEID)) {
            const hasAccumulator: IHasLiquidityAccumulator = new ethers.Contract(
                oracleAddress,
                HAS_LIQUIDITY_ACCUMULATOR_ABI,
                this.signer
            ) as IHasLiquidityAccumulator;
            const accumulatorAddress = await hasAccumulator.liquidityAccumulator();
            const accumulator: LiquidityAccumulator = new ethers.Contract(
                accumulatorAddress,
                LIQUIDITY_ACCUMULATOR_ABI,
                this.signer
            ) as LiquidityAccumulator;

            las.push(accumulator);

            console.log("Added liquidity accumulator: " + accumulatorAddress);
        }

        // Check if the oracle has a price accumulator
        if (await erc165.supportsInterface(AdrastiaUpdater.IHASPRICEACCUMULATOR_INTERFACEID)) {
            const hasAccumulator: IHasPriceAccumulator = new ethers.Contract(
                oracleAddress,
                HAS_PRICE_ACCUMULATOR_ABI,
                this.signer
            ) as IHasPriceAccumulator;
            const accumulatorAddress = await hasAccumulator.priceAccumulator();
            const accumulator: PriceAccumulator = new ethers.Contract(
                accumulatorAddress,
                PRICE_ACCUMULATOR_ABI,
                this.signer
            ) as PriceAccumulator;

            pas.push(accumulator);

            console.log("Added price accumulator: " + accumulatorAddress);
        }

        // Check if the oracle is an aggregator
        if (await erc165.supportsInterface(AdrastiaUpdater.IAGGREGATEDORACLE_INTERFACEID)) {
            const oracle: IAggregatedOracle = new ethers.Contract(
                oracleAddress,
                AGGREGATED_ORACLE_ABI,
                this.signer
            ) as IAggregatedOracle;

            const underlyingOracles: string[] = await oracle.getOraclesFor(token);

            // Discover underlying accumulators
            for (const underlyingOracle of underlyingOracles) {
                const underlyingAccumulators = await this.getAccumulators(underlyingOracle, token);

                // Add all underlying liquidity accumulators
                for (const la of underlyingAccumulators.las) las.push(la);

                // Add all underlying price accumulators
                for (const pa of underlyingAccumulators.pas) pas.push(pa);
            }
        }

        // Add all accumulators to the store
        const lasToStore = las.flatMap((accumulator) => accumulator.address).join(",");
        const pasToStore = pas.flatMap((accumulator) => accumulator.address).join(",");

        try {
            await this.store.put(lasStoreKey, lasToStore);
            await this.store.put(pasStoreKey, pasToStore);
        } catch (e) {
            console.error(e);
        }

        return {
            las: las,
            pas: pas,
        };
    }

    async getAccumulatorUpdateThreshold(accumulator: IAccumulator): Promise<BigNumber> {
        console.log("Getting update threshold for accumulator: " + accumulator.address);

        const updateThresholdStoreKey = this.chain + "." + accumulator.address + ".updateThreshold";
        const updateThresholdFromStore = await this.store.get(updateThresholdStoreKey);

        if (updateThresholdFromStore !== undefined && updateThresholdFromStore !== null) {
            try {
                const updateThreshold = BigNumber.from(updateThresholdFromStore);
                console.log("Update threshold for accumulator from store: " + updateThreshold.toString());

                return updateThreshold;
            } catch (e) {}
        }

        const updateThreshold = await accumulator.updateThreshold();
        console.log("Update threshold for accumulator: " + updateThreshold.toString());

        await this.store.put(updateThresholdStoreKey, updateThreshold.toString());

        return updateThreshold;
    }

    async accumulatorNeedsCriticalUpdate(accumulator: IAccumulator, token: string): Promise<boolean> {
        console.log("Checking if accumulator needs a critical update: " + accumulator.address);

        const updateThreshold = await this.getAccumulatorUpdateThreshold(accumulator);
        const criticalUpdateThreshold = updateThreshold.add(updateThreshold.div(2)); // updateThreshold * 1.5
        console.log("Critical update threshold: " + criticalUpdateThreshold);

        const criticalUpdateNeeded = await accumulator.changeThresholdSurpassed(token, criticalUpdateThreshold);
        if (criticalUpdateNeeded) {
            console.log("Critical update is needed");
        }

        return criticalUpdateNeeded;
    }

    async updateIsDelayed(contract: BaseContract, token: string): Promise<boolean> {
        if (this.updateDelay <= 0) return false;

        console.log("Checking if accumulator update is delayed: " + contract.address + " (token: " + token + ")");

        const storeKey =
            this.chain +
            "." +
            contract.address +
            "." +
            token +
            ".updateNeededSince" +
            (this.onlyCritical ? ".critical" : "");
        const timeFromStore = await this.store.get(storeKey);

        const currentTime = Math.floor(Date.now() / 1000); // unix timestamp

        if (timeFromStore !== undefined && timeFromStore !== null) {
            try {
                const updateOnOrAfter = Number.parseInt(timeFromStore) + this.updateDelay; // unix timestamp

                const isDelayed = currentTime < updateOnOrAfter;

                console.log(
                    "Update on or after: " +
                        new Date(updateOnOrAfter * 1000).toISOString() +
                        " (" +
                        (isDelayed ? "delayed" : "not delayed") +
                        ")"
                );

                return isDelayed;
            } catch (e) {}
        }

        console.log("First update needed observation recorded. Update needed in " + this.updateDelay + " seconds.");

        await this.store.put(storeKey, currentTime.toString());

        // This is the first observation that an update is needed, so we return true (update is delayed)
        return true;
    }

    async resetUpdateDelay(contract: BaseContract, token: string): Promise<void> {
        if (this.updateDelay <= 0) {
            // No update delay configured, so no need to reset it
            return;
        }

        console.log("Resetting update delay for contract: " + contract.address + " (token: " + token + ")");

        const storeKey =
            this.chain +
            "." +
            contract.address +
            "." +
            token +
            ".updateNeededSince" +
            (this.onlyCritical ? ".critical" : "");

        await this.store.del(storeKey);
    }

    async handleLaUpdate(liquidityAccumulator: LiquidityAccumulator, token: string) {
        const updateData = ethers.utils.hexZeroPad(token, 32);

        if (this.dryRun || (await liquidityAccumulator.canUpdate(updateData))) {
            if (this.onlyCritical) {
                // Critical: changePercent >= updateThreshold * 1.5
                if (!(await this.accumulatorNeedsCriticalUpdate(liquidityAccumulator, token))) {
                    return;
                }
            }

            if (await this.updateIsDelayed(liquidityAccumulator, token)) {
                // Update is delayed. Do not update.
                return;
            }

            console.log("Updating liquidity accumulator:", liquidityAccumulator.address);

            const [tokenLiquidity, quoteTokenLiquidity] = await liquidityAccumulator[
                "consultLiquidity(address,uint256)"
            ](token, 0);

            const laUpdateData = ethers.utils.defaultAbiCoder.encode(
                ["address", "uint", "uint"],
                [token, tokenLiquidity, quoteTokenLiquidity]
            );

            if (!this.dryRun) {
                const updateTx = await liquidityAccumulator.update(laUpdateData, {
                    gasLimit: this.useGasLimit,
                });
                console.log("Update liquidity accumulator tx:", updateTx.hash);

                if (this.handleUpdateTx) {
                    await this.handleUpdateTx(updateTx, this.signer);
                }
            }
        }

        await this.resetUpdateDelay(liquidityAccumulator, token);
    }

    calculateChange(a: BigNumber, b: BigNumber, changePrecision: BigNumber) {
        // Ensure a is never smaller than b
        if (a.lt(b)) {
            var temp = a;
            a = b;
            b = temp;
        }

        // a >= b

        if (a.eq(0)) {
            // a == b == 0 (since a >= b), therefore no change
            return {
                change: BigNumber.from(0),
                isInfinite: false,
            };
        } else if (b.eq(0)) {
            // (a > 0 && b == 0) => change threshold passed
            // Zero to non-zero always returns true
            return {
                change: BigNumber.from(0),
                isInfinite: true,
            };
        }

        const delta = a.sub(b); // a >= b, therefore no underflow
        const preciseDelta = delta.mul(changePrecision);

        // If the delta is so large that multiplying by CHANGE_PRECISION overflows, we assume that
        // the change threshold has been surpassed.
        // If our assumption is incorrect, the accumulator will be extra-up-to-date, which won't
        // really break anything, but will cost more gas in keeping this accumulator updated.
        if (preciseDelta.lt(delta))
            return {
                change: BigNumber.from(0),
                isInfinite: true,
            };

        return {
            change: preciseDelta.div(b),
            isInfinite: false,
        };
    }

    async getAccumulatorQuoteTokenDecimals(accumulator: PriceAccumulator): Promise<number> {
        console.log("Getting quote token decimals for accumulator: " + accumulator.address);

        const quoteTokenDecimalsStoreKey = this.chain + "." + accumulator.address + ".quoteTokenDecimals";
        const quoteTokenDecimalsFromStore = await this.store.get(quoteTokenDecimalsStoreKey);

        if (quoteTokenDecimalsFromStore !== undefined && quoteTokenDecimalsFromStore !== null) {
            try {
                const quoteTokenDecimals = parseInt(quoteTokenDecimalsFromStore);
                console.log("Quote token decimals for accumulator from store: " + quoteTokenDecimals.toString());

                return quoteTokenDecimals;
            } catch (e) {}
        }

        const quoteTokenDecimals = await accumulator.quoteTokenDecimals();
        console.log("Quote token decimals for accumulator: " + quoteTokenDecimals.toString());

        await this.store.put(quoteTokenDecimalsStoreKey, quoteTokenDecimals.toString());

        return quoteTokenDecimals;
    }

    async getAccumulatorMaxUpdateDelay(accumulator: PriceAccumulator): Promise<BigNumber> {
        console.log("Getting max update delay for accumulator: " + accumulator.address);

        const maxUpdateDelayStoreKey = this.chain + "." + accumulator.address + ".maxUpdateDelay";
        const maxUpdateDelayFromStore = await this.store.get(maxUpdateDelayStoreKey);

        if (maxUpdateDelayFromStore !== undefined && maxUpdateDelayFromStore !== null) {
            try {
                const maxUpdateDelay = BigNumber.from(maxUpdateDelayFromStore);
                console.log("Max update delay for accumulator from store: " + maxUpdateDelay.toString());

                return maxUpdateDelay;
            } catch (e) {}
        }

        const maxUpdateDelay = await accumulator.maxUpdateDelay();
        console.log("Max update delay for accumulator: " + maxUpdateDelay.toString());

        await this.store.put(maxUpdateDelayStoreKey, maxUpdateDelay.toString());

        return maxUpdateDelay;
    }

    async fetchBinancePrice(routes: ValidationRoute[]) {
        var price = 1.0;
        var hasPrice = false;

        for (const route of routes) {
            await this.axiosInstance
                .get((route.source ?? "https://api.binance.com") + "/api/v3/ticker/price", {
                    params: {
                        symbol: route.symbol,
                    },
                    validateStatus: () => true, // Never throw an error... they're handled below,
                    timeout: 5000, // timeout after 5 seconds,
                    proxy: this.proxyConfig,
                })
                .then(async function (response: AxiosResponse) {
                    const rateLimitedButHasCache =
                        (response.status == 418 /* rate limit warning */ || response.status == 429) /* IP ban */ &&
                        response.request.fromCache === true;
                    if ((response.status >= 200 && response.status < 400) || rateLimitedButHasCache) {
                        var tickerPrice = parseFloat(response.data["price"]);

                        if (tickerPrice == 0 || isNaN(tickerPrice)) {
                            throw new Error("Cannot parse price from Binance");
                        }

                        if (route.reverse) {
                            tickerPrice = 1.0 / tickerPrice;
                        }

                        price *= tickerPrice;
                        hasPrice = true;
                    } else {
                        const responseBody = response.data ? JSON.stringify(response.data) : "";

                        throw new Error(
                            "Binance API responded with error " +
                                response.status +
                                " for symbol " +
                                route.symbol +
                                ": " +
                                response.statusText +
                                ". Response body: " +
                                responseBody
                        );
                    }
                });
        }

        if (!hasPrice) {
            throw new Error("Could not fetch price from Binance");
        }

        return price;
    }

    async fetchCoinbasePrice(routes: ValidationRoute[]) {
        var price = 1.0;
        var hasPrice = false;

        for (const route of routes) {
            await this.axiosInstance
                .get((route.source ?? "https://api.exchange.coinbase.com") + "/products/" + route.symbol + "/ticker", {
                    validateStatus: () => true, // Never throw an error... they're handled below
                    timeout: 5000, // timeout after 5 seconds
                    proxy: this.proxyConfig,
                })
                .then(async function (response: AxiosResponse) {
                    if ((response.status >= 200 && response.status < 400) || response.request.fromCache) {
                        var tickerPrice = parseFloat(response.data["price"]);

                        if (tickerPrice == 0 || isNaN(tickerPrice)) {
                            throw new Error(
                                "Cannot parse price from Coinbase for symbol " +
                                    route.symbol +
                                    ": " +
                                    JSON.stringify(response.data)
                            );
                        }

                        if (route.reverse) {
                            tickerPrice = 1.0 / tickerPrice;
                        }

                        price *= tickerPrice;
                        hasPrice = true;
                    } else {
                        const responseBody = response.data ? JSON.stringify(response.data) : "";

                        throw new Error(
                            "Coinbase API responded with error " +
                                response.status +
                                " for symbol " +
                                route.symbol +
                                ": " +
                                response.statusText +
                                ". Response body: " +
                                responseBody
                        );
                    }
                });
        }

        if (!hasPrice) {
            throw new Error("Could not fetch price from Coinbase");
        }

        return price;
    }

    async fetchBitfinixPrice(routes: ValidationRoute[]) {
        var price = 1.0;
        var hasPrice = false;

        for (const route of routes) {
            await this.axiosInstance
                .get((route.source ?? "https://api-pub.bitfinex.com") + "/v2/ticker/t" + route.symbol, {
                    validateStatus: () => true, // Never throw an error... they're handled below
                    timeout: 5000, // timeout after 5 seconds
                    proxy: this.proxyConfig,
                })
                .then(async function (response: AxiosResponse) {
                    if ((response.status >= 200 && response.status < 400) || response.request.fromCache) {
                        var tickerPrice = parseFloat(response.data[6]);

                        if (tickerPrice == 0 || isNaN(tickerPrice)) {
                            throw new Error(
                                "Cannot parse price from Bitfinix for symbol " +
                                    route.symbol +
                                    ": " +
                                    JSON.stringify(response.data)
                            );
                        }

                        if (route.reverse) {
                            tickerPrice = 1.0 / tickerPrice;
                        }

                        price *= tickerPrice;
                        hasPrice = true;
                    } else {
                        const responseBody = response.data ? JSON.stringify(response.data) : "";

                        throw new Error(
                            "Bitfinix API responded with error " +
                                response.status +
                                " for symbol " +
                                route.symbol +
                                ": " +
                                response.statusText +
                                ". Response body: " +
                                responseBody
                        );
                    }
                });
        }

        if (!hasPrice) {
            throw new Error("Could not fetch price from Bitfinix");
        }

        return price;
    }

    async fetchKucoinPrice(routes: ValidationRoute[]) {
        var price = 1.0;
        var hasPrice = false;

        for (const route of routes) {
            await this.axiosInstance
                .get(
                    (route.source ?? "https://api.kucoin.com") +
                        "/api/v1/market/orderbook/level1?symbol=" +
                        route.symbol,
                    {
                        validateStatus: () => true, // Never throw an error... they're handled below
                        timeout: 5000, // timeout after 5 seconds
                        proxy: this.proxyConfig,
                    }
                )
                .then(async function (response: AxiosResponse) {
                    if ((response.status >= 200 && response.status < 400) || response.request.fromCache) {
                        var tickerPrice = parseFloat(response.data["data"]["price"]);

                        if (tickerPrice == 0 || isNaN(tickerPrice)) {
                            throw new Error("Cannot parse price from Kucoin for symbol: " + route.symbol);
                        }

                        if (route.reverse) {
                            tickerPrice = 1.0 / tickerPrice;
                        }

                        price *= tickerPrice;
                        hasPrice = true;
                    } else {
                        const responseBody = response.data ? JSON.stringify(response.data) : "";

                        throw new Error(
                            "Kucoin API responded with error " +
                                response.status +
                                " for symbol " +
                                route.symbol +
                                ": " +
                                response.statusText +
                                ". Response body: " +
                                responseBody
                        );
                    }
                });
        }

        if (!hasPrice) {
            throw new Error("Could not fetch price from Kucoin");
        }

        return price;
    }

    async fetchBitstampPrice(routes: ValidationRoute[]) {
        var price = 1.0;
        var hasPrice = false;

        for (const route of routes) {
            await this.axiosInstance
                .get((route.source ?? "https://www.bitstamp.net") + "/api/v2/ticker/" + route.symbol + "/", {
                    validateStatus: () => true, // Never throw an error... they're handled below
                    timeout: 5000, // timeout after 5 seconds
                    proxy: this.proxyConfig,
                })
                .then(async function (response: AxiosResponse) {
                    if ((response.status >= 200 && response.status < 400) || response.request.fromCache) {
                        var tickerPrice = parseFloat(response.data["last"]);

                        if (tickerPrice == 0 || isNaN(tickerPrice)) {
                            throw new Error("Cannot parse price from Bitstamp for symbol: " + route.symbol);
                        }

                        if (route.reverse) {
                            tickerPrice = 1.0 / tickerPrice;
                        }

                        price *= tickerPrice;
                        hasPrice = true;
                    } else {
                        const responseBody = response.data ? JSON.stringify(response.data) : "";

                        throw new Error(
                            "Bitstamp API responded with error " +
                                response.status +
                                " for symbol " +
                                route.symbol +
                                ": " +
                                response.statusText +
                                ". Response body: " +
                                responseBody
                        );
                    }
                });
        }

        if (!hasPrice) {
            throw new Error("Could not fetch price from Bitstamp");
        }

        return price;
    }

    async fetchHuobiPrice(routes: ValidationRoute[]) {
        var price = 1.0;
        var hasPrice = false;

        for (const route of routes) {
            await this.axiosInstance
                .get((route.source ?? "https://api.huobi.pro") + "/market/trade?symbol=" + route.symbol, {
                    validateStatus: () => true, // Never throw an error... they're handled below
                    timeout: 5000, // timeout after 5 seconds
                    proxy: this.proxyConfig,
                })
                .then(async function (response: AxiosResponse) {
                    if ((response.status >= 200 && response.status < 400) || response.request.fromCache) {
                        var tickerPrice = parseFloat(response.data["tick"]?.["data"]?.[0]?.["price"]);

                        if (tickerPrice == 0 || isNaN(tickerPrice)) {
                            throw new Error("Cannot parse price from Huobi for symbol: " + route.symbol);
                        }

                        if (route.reverse) {
                            tickerPrice = 1.0 / tickerPrice;
                        }

                        price *= tickerPrice;
                        hasPrice = true;
                    } else {
                        const responseBody = response.data ? JSON.stringify(response.data) : "";

                        throw new Error(
                            "Huobi API responded with error " +
                                response.status +
                                " for symbol " +
                                route.symbol +
                                ": " +
                                response.statusText +
                                ". Response body: " +
                                responseBody
                        );
                    }
                });
        }

        if (!hasPrice) {
            throw new Error("Could not fetch price from Huobi");
        }

        return price;
    }

    async fetchCoinExPrice(routes: ValidationRoute[]) {
        var price = 1.0;
        var hasPrice = false;

        for (const route of routes) {
            await this.axiosInstance
                .get((route.source ?? "https://api.coinex.com") + "/v1/market/ticker?market=" + route.symbol, {
                    validateStatus: () => true, // Never throw an error... they're handled below
                    timeout: 5000, // timeout after 5 seconds
                    proxy: this.proxyConfig,
                })
                .then(async function (response: AxiosResponse) {
                    if ((response.status >= 200 && response.status < 400) || response.request.fromCache) {
                        var tickerPrice = parseFloat(response.data["data"]?.["ticker"]?.["last"]);

                        if (tickerPrice == 0 || isNaN(tickerPrice)) {
                            throw new Error("Cannot parse price from Huobi for symbol: " + route.symbol);
                        }

                        if (route.reverse) {
                            tickerPrice = 1.0 / tickerPrice;
                        }

                        price *= tickerPrice;
                        hasPrice = true;
                    } else {
                        const responseBody = response.data ? JSON.stringify(response.data) : "";

                        throw new Error(
                            "Huobi API responded with error " +
                                response.status +
                                " for symbol " +
                                route.symbol +
                                ": " +
                                response.statusText +
                                ". Response body: " +
                                responseBody
                        );
                    }
                });
        }

        if (!hasPrice) {
            throw new Error("Could not fetch price from Huobi");
        }

        return price;
    }

    async fetchKrakenPrice(routes: ValidationRoute[]) {
        var price = 1.0;
        var hasPrice = false;

        for (const route of routes) {
            await this.axiosInstance
                .get((route.source ?? "https://api.kraken.com") + "/0/public/Ticker?pair=" + route.symbol, {
                    validateStatus: () => true, // Never throw an error... they're handled below
                    timeout: 5000, // timeout after 5 seconds
                    proxy: this.proxyConfig,
                })
                .then(async function (response: AxiosResponse) {
                    if ((response.status >= 200 && response.status < 400) || response.request.fromCache) {
                        if (response.data["error"] && response.data["error"].length > 0) {
                            throw new Error(
                                "Kraken API responded with error: " + JSON.stringify(response.data["error"])
                            );
                        }

                        if (!response.data["result"]) {
                            throw new Error("Kraken API did not return a result");
                        }

                        if (!response.data["result"][route.symbol]) {
                            throw new Error(
                                "Kraken API did not return price for symbol " +
                                    route.symbol +
                                    ": " +
                                    JSON.stringify(response.data["result"])
                            );
                        }

                        var tickerPrice = parseFloat(response.data["result"][route.symbol]["c"][0]);

                        if (tickerPrice == 0 || isNaN(tickerPrice)) {
                            throw new Error("Cannot parse price from Kraken");
                        }

                        if (route.reverse) {
                            tickerPrice = 1.0 / tickerPrice;
                        }

                        price *= tickerPrice;
                        hasPrice = true;
                    } else {
                        const responseBody = response.data ? JSON.stringify(response.data) : "";

                        throw new Error(
                            "Kraken API responded with error " +
                                response.status +
                                " for symbol " +
                                route.symbol +
                                ": " +
                                response.statusText +
                                ". Response body: " +
                                responseBody
                        );
                    }
                });
        }

        if (!hasPrice) {
            throw new Error("Could not fetch price from Kraken");
        }

        return price;
    }

    async fetchLlamaPrice(routes: ValidationRoute[]) {
        var price = 1.0;
        var hasPrice = false;

        for (const route of routes) {
            await this.axiosInstance
                .get((route.source ?? "https://coins.llama.fi") + "/prices/current/" + route.symbol, {
                    validateStatus: () => true, // Never throw an error... they're handled below
                    timeout: 5000, // timeout after 5 seconds
                    proxy: this.proxyConfig,
                })
                .then(async function (response: AxiosResponse) {
                    if ((response.status >= 200 && response.status < 400) || response.request.fromCache) {
                        var tickerPrice = parseFloat(response.data["coins"][route.symbol]["price"]);

                        if (tickerPrice == 0 || isNaN(tickerPrice)) {
                            throw new Error("Cannot parse price from Llama");
                        }

                        if (route.reverse) {
                            tickerPrice = 1.0 / tickerPrice;
                        }

                        price *= tickerPrice;
                        hasPrice = true;
                    } else {
                        const responseBody = response.data ? JSON.stringify(response.data) : "";

                        throw new Error(
                            "Llama API responded with error " +
                                response.status +
                                " for symbol " +
                                route.symbol +
                                ": " +
                                response.statusText +
                                ". Response body: " +
                                responseBody
                        );
                    }
                });
        }

        if (!hasPrice) {
            throw new Error("Could not fetch price from DefiLlama");
        }

        return price;
    }

    async fetchOffchainPrice(token: TokenConfig) {
        var prices: number[] = [];
        var weights: number[] = [];

        var sumWeights = 0;

        if (token.validation.sources.length == 0) {
            throw new Error("Token validation has no sources");
        }

        var sourceIndex = 0;

        for (const source of token.validation.sources) {
            var price = 1.0;
            var hasPrice = false;

            try {
                if (source.type === "binance") {
                    price = await this.fetchBinancePrice(source.routes);
                    hasPrice = true;

                    console.log("Binance price =", price.toString() + " (index = " + sourceIndex.toString() + ")");
                } else if (source.type === "huobi") {
                    price = await this.fetchHuobiPrice(source.routes);
                    hasPrice = true;

                    console.log("Huobi price =", price.toString() + " (index = " + sourceIndex.toString() + ")");
                } else if (source.type === "coinex") {
                    price = await this.fetchCoinExPrice(source.routes);
                    hasPrice = true;

                    console.log("CoinEx price =", price.toString() + " (index = " + sourceIndex.toString() + ")");
                } else if (source.type === "bitfinix") {
                    price = await this.fetchBitfinixPrice(source.routes);
                    hasPrice = true;

                    console.log("Bitfinix price =", price.toString() + " (index = " + sourceIndex.toString() + ")");
                } else if (source.type === "bitstamp") {
                    price = await this.fetchBitstampPrice(source.routes);
                    hasPrice = true;

                    console.log("Bitstamp price =", price.toString() + " (index = " + sourceIndex.toString() + ")");
                } else if (source.type === "coinbase") {
                    price = await this.fetchCoinbasePrice(source.routes);
                    hasPrice = true;

                    console.log("Coinbase price =", price.toString() + " (index = " + sourceIndex.toString() + ")");
                } else if (source.type === "kucoin") {
                    price = await this.fetchKucoinPrice(source.routes);
                    hasPrice = true;

                    console.log("Kucoin price =", price.toString() + " (index = " + sourceIndex.toString() + ")");
                } else if (source.type === "llama") {
                    price = await this.fetchLlamaPrice(source.routes);
                    hasPrice = true;

                    console.log("Llama price =", price.toString() + " (index = " + sourceIndex.toString() + ")");
                } else if (source.type === "kraken") {
                    price = await this.fetchKrakenPrice(source.routes);
                    hasPrice = true;

                    console.log("Kraken price =", price.toString() + " (index = " + sourceIndex.toString() + ")");
                } else {
                    throw new Error("Unknown source type: " + source.type);
                }
            } catch (e) {
                console.log("Error fetching price from source: " + e.message);
            }

            if (hasPrice) {
                prices.push(price);
                weights.push(source.weight);
                sumWeights += source.weight;
            }

            ++sourceIndex;
        }

        if (prices.length == 0) {
            throw new Error("No price set");
        } else if (sumWeights < token.validation.minimumWeight) {
            throw new Error(
                "Weight is too low: " +
                    sumWeights.toString() +
                    ", minimum: " +
                    token.validation.minimumWeight.toString()
            );
        }

        return weightedMedian(prices, weights);
    }

    async validatePrice(accumulator: PriceAccumulator, accumulatorPrice: BigNumber, token: TokenConfig) {
        var validated = false;
        var apiPrice = BigNumber.from(0);
        var usePrice = accumulatorPrice;

        console.log("Validating price for accumulator: " + accumulator.address);

        const quoteTokenDecimals = await this.getAccumulatorQuoteTokenDecimals(accumulator);

        const updateData = ethers.utils.hexZeroPad(token.address, 32);

        try {
            apiPrice = ethers.utils.parseUnits(
                (await this.fetchOffchainPrice(token)).toFixed(quoteTokenDecimals),
                quoteTokenDecimals
            );

            console.log("API price =", ethers.utils.formatUnits(apiPrice, quoteTokenDecimals));
            console.log("Accumulator price =", ethers.utils.formatUnits(accumulatorPrice, quoteTokenDecimals));

            const diff = this.calculateChange(accumulatorPrice, apiPrice, BigNumber.from("10000")); // in bps

            console.log("Change =", (diff.isInfinite ? "infinite" : diff.change.toString()) + " bps");

            if (!diff.isInfinite && diff.change.lte(token.validation.allowedChangeBps)) {
                validated = true;
                usePrice = accumulatorPrice;
            }
        } catch (e) {
            console.error(e);
        }

        // Forceful validation disabled. Attacks can be performed when the time since last update approaches the max
        // update delay. Stale data is preferred over inaccurate data. Consumers can always use fallback oracles.
        /*if (!validated) {
            const timeSinceLastUpdate = await accumulator.timeSinceLastUpdate(updateData);
            const maxUpdateDelay = await this.getAccumulatorMaxUpdateDelay(accumulator);
            if (timeSinceLastUpdate.gte(maxUpdateDelay)) {
                // Hasn't been updated in over the max period,
                // so we forcefully validate even though prices are different

                console.log(
                    "Time since last update exceeds " +
                        maxUpdateDelay.toString() +
                        " seconds (" +
                        timeSinceLastUpdate.toString() +
                        "). Forcefully validating."
                );

                validated = true;
                usePrice = accumulatorPrice;
            }
        }*/

        if (!validated) {
            console.log("Price validation failed (exceeds " + token.validation.allowedChangeBps + " bps)");
        } else {
            console.log(
                "Validation succeeded. Using price of " +
                    ethers.utils.formatUnits(usePrice, quoteTokenDecimals) +
                    " for on-chain validation."
            );
        }

        return {
            validated: validated,
            usePrice: usePrice,
        };
    }

    async handlePaUpdate(priceAccumulator: PriceAccumulator, token: TokenConfig) {
        const updateData = ethers.utils.hexZeroPad(token.address, 32);

        if (this.dryRun || (await priceAccumulator.canUpdate(updateData))) {
            if (this.onlyCritical) {
                // Critical: changePercent >= updateThreshold * 1.5
                if (!(await this.accumulatorNeedsCriticalUpdate(priceAccumulator, token.address))) {
                    return;
                }
            }

            if (await this.updateIsDelayed(priceAccumulator, token.address)) {
                // Update is delayed. Do not update.
                return;
            }

            console.log("Updating price accumulator:", priceAccumulator.address);

            var price = await priceAccumulator["consultPrice(address,uint256)"](token.address, 0);

            if (token.validation.enabled) {
                const validation = await this.validatePrice(priceAccumulator, price, token);
                if (!validation.validated) {
                    return;
                }

                price = validation.usePrice;
            }

            const paUpdateData = ethers.utils.defaultAbiCoder.encode(["address", "uint"], [token.address, price]);

            if (!this.dryRun) {
                const updateTx = await priceAccumulator.update(paUpdateData, {
                    gasLimit: this.useGasLimit,
                });
                console.log("Update price accumulator tx:", updateTx.hash);

                if (this.handleUpdateTx) {
                    await this.handleUpdateTx(updateTx, this.signer);
                }
            }
        }

        await this.resetUpdateDelay(priceAccumulator, token.address);
    }

    async getOraclePeriod(oracle: AggregatedOracle): Promise<number> {
        console.log("Getting period for oracle: " + oracle.address);

        const periodStoreKey = this.chain + "." + oracle.address + ".period";

        const periodFromStore = await this.store.get(periodStoreKey);
        if (periodFromStore !== undefined && periodFromStore !== null && !isNaN(parseInt(periodFromStore))) {
            console.log("Period for oracle from store: " + parseInt(periodFromStore));

            return parseInt(periodFromStore);
        }

        const period = await oracle.period();

        console.log("Period for oracle: " + period);

        await this.store.put(periodStoreKey, period.toNumber().toString());

        return period.toNumber();
    }

    async oracleNeedsCriticalUpdate(oracle: AggregatedOracle, token: string): Promise<boolean> {
        console.log("Checking if oracle needs a critical update: " + oracle.address);

        const period = await this.getOraclePeriod(oracle);

        const updateData = ethers.utils.hexZeroPad(token, 32);

        const timeSinceLastUpdate = await oracle.timeSinceLastUpdate(updateData);
        console.log("Time since last update: " + timeSinceLastUpdate);

        const criticalUpdateNeeded = timeSinceLastUpdate.gte(period * 1.5);
        if (criticalUpdateNeeded) {
            console.log("Critical update is needed");
        }

        return criticalUpdateNeeded;
    }

    async handleOracleUpdate(oracle: AggregatedOracle, token: string) {
        const updateData = ethers.utils.hexZeroPad(token, 32);

        if (this.dryRun || (await oracle.canUpdate(updateData))) {
            if (this.onlyCritical) {
                // Critical: block.timestamp >= observation.timestamp + (period * 1.5)
                if (!(await this.oracleNeedsCriticalUpdate(oracle, token))) {
                    return;
                }
            }

            if (await this.updateIsDelayed(oracle, token)) {
                // Update is delayed. Do not update.
                return;
            }

            console.log("Updating oracle:", oracle.address);

            if (!this.dryRun) {
                const updateTx = await oracle.update(updateData, {
                    gasLimit: this.useGasLimit,
                });
                console.log("Update oracle tx:", updateTx.hash);

                if (this.handleUpdateTx) {
                    await this.handleUpdateTx(updateTx, this.signer);
                }
            }
        }

        await this.resetUpdateDelay(oracle, token);
    }

    async keepUpdated(oracleAddress: string, token: TokenConfig) {
        const oracle: AggregatedOracle = new ethers.Contract(
            oracleAddress,
            AGGREGATED_ORACLE_ABI,
            this.signer
        ) as AggregatedOracle;

        const { las, pas } = await this.getAccumulators(oracleAddress, token.address);

        console.log("Checking liquidity accumulators for needed updates...");

        // Update all liquidity accumulators (if necessary)
        for (const liquidityAccumulator of las) {
            try {
                await this.handleLaUpdate(liquidityAccumulator, token.address);
            } catch (e) {
                console.error(e);
            }
        }

        console.log("Checking price accumulators for needed updates...");

        // Update all price accumulators (if necessary)
        for (const priceAccumulator of pas) {
            try {
                await this.handlePaUpdate(priceAccumulator, token);
            } catch (e) {
                console.error(e);
            }
        }

        console.log("Checking oracle for needed updates...");

        // Update oracle (if necessary)
        await this.handleOracleUpdate(oracle, token.address);
    }
}

export async function run(
    oracleConfigs: OracleConfig[],
    chain: string,
    batch: number,
    signer: Signer,
    store: IKeyValueStore,
    useGasLimit: number,
    onlyCritical: boolean,
    dryRun: boolean,
    handleUpdateTx: (tx: ethers.providers.TransactionResponse, signer: Signer) => Promise<void>,
    updateDelay: number,
    httpCacheSeconds: number,
    proxyConfig?: AxiosProxyConfig
) {
    const updater = new AdrastiaUpdater(
        chain,
        signer,
        store,
        useGasLimit,
        onlyCritical,
        dryRun,
        handleUpdateTx,
        updateDelay,
        httpCacheSeconds,
        proxyConfig
    );

    for (const oracleConfig of oracleConfigs) {
        if (!oracleConfig.enabled) continue;

        for (const token of oracleConfig.tokens) {
            if (!(token.enabled ?? true)) continue;

            if (token.batch != batch) continue;

            console.log("Updating all components for oracle =", oracleConfig.address, ", token =", token.address);

            await updater.keepUpdated(oracleConfig.address, token);
        }
    }
}

// Entrypoint for the Autotask
export async function handler(event) {
    const target = config.target;
    const chainConfig = config.chains[target.chain];
    const txConfig = chainConfig.txConfig[target.type];

    const provider = new DefenderRelayProvider(event);
    const signer = new DefenderRelaySigner(event, provider, {
        speed: txConfig.speed as Speed,
        validForSeconds: txConfig.validFor,
    });

    var proxyConfig: AxiosProxyConfig;

    const { PROXY_HOST, PROXY_PORT, PROXY_USERNAME, PROXY_PASSWORD } = event.secrets;

    if (PROXY_HOST && PROXY_PORT) {
        proxyConfig = {
            host: PROXY_HOST,
            port: parseInt(PROXY_PORT),
            auth:
                PROXY_USERNAME || PROXY_PASSWORD
                    ? { username: PROXY_USERNAME ?? "", password: PROXY_PASSWORD ?? "" }
                    : undefined,
        };
    }

    const oracleConfigs: OracleConfig[] = chainConfig.oracles;

    const store: KeyValueStoreClient = new KeyValueStoreClient(event);

    console.log(`Running batch ${target.batch} for target chain: ${target.chain}`);

    if (proxyConfig) {
        console.log(`Using proxy: ${proxyConfig.auth?.username}@${proxyConfig.host}:${proxyConfig.port}`);
    }

    await run(
        oracleConfigs,
        target.chain,
        target.batch,
        signer,
        store,
        txConfig.gasLimit,
        target.type === "critical",
        config.dryRun,
        undefined,
        target.delay,
        config.httpCacheSeconds,
        proxyConfig
    );
}

async function sleepFor(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRepeat(
    store: IKeyValueStore,
    defenderCredentials: any,
    chain: string,
    mode: string,
    batch: number,
    repeatInterval: number,
    repeatTimes: number,
    updateDelay: number,
    proxyConfig?: AxiosProxyConfig
) {
    const chainConfig = config.chains[chain];
    const txConfig = chainConfig.txConfig[mode];

    const provider = new DefenderRelayProvider(defenderCredentials);
    const signer = new DefenderRelaySigner(defenderCredentials, provider, {
        speed: txConfig.speed as Speed,
        validForSeconds: txConfig.validFor,
    });

    const oracleConfigs: OracleConfig[] = chainConfig.oracles;

    var timesRepeated = 0;

    while (timesRepeated++ < repeatTimes) {
        try {
            console.log(`Running batch ${batch} for target chain: ${chain}`);

            await run(
                oracleConfigs,
                chain,
                batch,
                signer,
                store,
                txConfig.gasLimit,
                mode === "critical",
                config.dryRun,
                undefined,
                updateDelay,
                config.httpCacheSeconds,
                proxyConfig
            );
        } catch (e) {
            console.error(e);
        }

        console.log("Sleeping for", repeatInterval, "seconds");

        await sleepFor(repeatInterval * 1000);
    }
}

// To run locally (this code will not be executed in Autotasks)
if (require.main === module) {
    require("dotenv").config();

    const yargs = require("yargs");

    const argv = yargs
        .command("start", "Starts the oracle updater bot", {
            chain: {
                description: "The chain to update the oracles for",
                alias: "c",
                type: "string",
            },
            every: {
                description: "The interval in seconds to update the oracles",
                alias: "e",
                type: "number",
            },
            batch: {
                description: "The batch of assets to update the oracles for",
                alias: "b",
                type: "number",
                default: 1,
            },
            delay: {
                description:
                    "The amount of time in seconds that has to pass (with an update being needed) before an update transaction is sent",
                alias: "d",
                type: "number",
                default: 0,
            },
        })
        .help()
        .alias("help", "h").argv;

    if (argv._.includes("start")) {
        const chain = argv.chain;

        let apiKey: string, apiSecret: string;

        if (chain) {
            const chainInCaps = chain.toUpperCase();

            apiKey = process.env[`${chainInCaps}_API_KEY`] as string;
            apiSecret = process.env[`${chainInCaps}_API_SECRET`] as string;
        } else {
            apiKey = process.env.API_KEY as string;
            apiSecret = process.env.API_SECRET as string;
        }

        var proxyConfig: AxiosProxyConfig;

        if (process.env.PROXY_HOST && process.env.PROXY_PORT) {
            proxyConfig = {
                host: process.env.PROXY_HOST,
                port: parseInt(process.env.PROXY_PORT),
                auth:
                    process.env.PROXY_USERNAME || process.env.PROXY_PASSWORD
                        ? { username: process.env.PROXY_USERNAME ?? "", password: process.env.PROXY_PASSWORD ?? "" }
                        : undefined,
            };
        }

        const store = new KeyValueStoreClient({ path: "store.json.tmp" });

        if (argv.every) {
            runRepeat(
                store,
                { apiKey, apiSecret },
                argv.chain,
                "normal",
                argv.batch,
                argv.every,
                Number.MAX_SAFE_INTEGER,
                argv.delay,
                proxyConfig
            )
                .then(() => process.exit(0))
                .catch((error: Error) => {
                    console.error(error);
                    process.exit(1);
                });
        } else {
            runRepeat(store, { apiKey, apiSecret }, argv.chain, "normal", argv.batch, 0, 1, argv.delay, proxyConfig)
                .then(() => process.exit(0))
                .catch((error: Error) => {
                    console.error(error);
                    process.exit(1);
                });
        }
    }
}
