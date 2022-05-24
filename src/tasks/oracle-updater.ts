// Import dependencies available in the autotask environment
import { DefenderRelayProvider, DefenderRelaySigner } from "defender-relay-client/lib/ethers";
import { BigNumber, ethers } from "ethers";

// Import typechain
import { IERC165 } from "../../typechain";
import {
    IAccumulator,
    IAggregatedOracle,
    IHasLiquidityAccumulator,
    IHasPriceAccumulator,
} from "../../typechain/interfaces";
import { LiquidityAccumulator, PriceAccumulator } from "../../typechain/accumulators";

// Import ABIs
import { abi as IERC165_ABI } from "@openzeppelin-v4/contracts/build/contracts/IERC165.json";
import { abi as AGGREGATED_ORACLE_ABI } from "@pythia-oracle/pythia-core/artifacts/contracts/oracles/AggregatedOracle.sol/AggregatedOracle.json";
import { abi as PRICE_ACCUMULATOR_ABI } from "@pythia-oracle/pythia-core/artifacts/contracts/accumulators/PriceAccumulator.sol/PriceAccumulator.json";
import { abi as LIQUIDITY_ACCUMULATOR_ABI } from "@pythia-oracle/pythia-core/artifacts/contracts/accumulators/LiquidityAccumulator.sol/LiquidityAccumulator.json";
import { abi as HAS_PRICE_ACCUMULATOR_ABI } from "@pythia-oracle/pythia-core/artifacts/contracts/interfaces/IHasPriceAccumulator.sol/IHasPriceAccumulator.json";
import { abi as HAS_LIQUIDITY_ACCUMULATOR_ABI } from "@pythia-oracle/pythia-core/artifacts/contracts/interfaces/IHasLiquidityAccumulator.sol/IHasLiquidityAccumulator.json";

// Import config
import config from "../../pythia.config";
import { Speed } from "defender-relay-client";
import { KeyValueStoreClient } from "defender-kvstore-client";
import { AggregatedOracle } from "../../typechain/oracles";

import axios, { AxiosResponse } from "axios";
import axiosRetry from "axios-retry";
import { setupCache } from "axios-cache-adapter";

// TODO: Track the items put into the store and use that to implement clear, length, and iterate
class DefenderAxiosStore {
    prefix: string;

    constructor(prefix: string) {
        this.prefix = prefix;
    }

    async getItem(key) {
        const item = (await defenderStore.get(this.prefix + key)) || null;

        return JSON.parse(item);
    }

    async setItem(key, value) {
        await defenderStore.put(this.prefix + key, JSON.stringify(value));

        return value;
    }

    async removeItem(key) {
        await defenderStore.del(this.prefix + key);
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

const axiosCache = setupCache({
    maxAge: 30 * 1000, // 30 seconds
    exclude: {
        query: false, // Allow caching of requests with query params
    },
    // Attempt reading stale cache data when we're being rate limited
    readOnError: (error, request) => {
        return error.response.status == 429 /* back-off warning */ || error.response.status == 418 /* IP ban */;
    },
    // Deactivate `clearOnStale` option so that we can actually read stale cache data
    clearOnStale: false,
    store: new DefenderAxiosStore(""),
});

const axiosInstance = axios.create({
    baseURL: "https://api.binance.com",
    adapter: axiosCache.adapter,
});

axiosRetry(axiosInstance, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
});

// Interface IDs
const IHASLIQUIDITYACCUMULATOR_INTERFACEID = "0x06a5df37";
const IHASPRICEACCUMULATOR_INTERFACEID = "0x6b72d0ba";
const IAGGREGATEDORACLE_INTERFACEID = "0xce2362c4";

// Variables
var isLocal = false;
var useGasLimit = 1000000;
var onlyCritical = false;
var defenderStore: KeyValueStoreClient;
var dryRun = false;
var targetFromArgs = undefined;

async function getAccumulators(
    store: KeyValueStoreClient,
    signer: DefenderRelaySigner,
    oracleAddress: string,
    token: string
) {
    let las: LiquidityAccumulator[] = [];
    let pas: PriceAccumulator[] = [];

    console.log("Discovering accumulators for oracle: " + oracleAddress);

    const lasStoreKey = oracleAddress + ".las";
    const pasStoreKey = oracleAddress + ".pas";

    const lasFromStore = await store.get(lasStoreKey);
    const pasFromStore = await store.get(pasStoreKey);

    if (lasFromStore !== undefined && pasFromStore !== undefined && lasFromStore !== null && pasFromStore !== null) {
        // Use accumulators from the store rather than querying for all of them
        const laAddresses = lasFromStore.split(",");
        const paAddresses = pasFromStore.split(",");

        for (const accumulatorAddress of laAddresses) {
            const accumulator: LiquidityAccumulator = new ethers.Contract(
                accumulatorAddress,
                LIQUIDITY_ACCUMULATOR_ABI,
                signer
            ) as LiquidityAccumulator;

            las.push(accumulator);

            console.log("Added liquidity accumulator from store: " + accumulatorAddress);
        }

        for (const accumulatorAddress of paAddresses) {
            const accumulator: PriceAccumulator = new ethers.Contract(
                accumulatorAddress,
                PRICE_ACCUMULATOR_ABI,
                signer
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
        await store.del(lasStoreKey);
        await store.del(pasStoreKey);
    }

    // Assume the oracle implements IERC165
    const erc165: IERC165 = new ethers.Contract(oracleAddress, IERC165_ABI, signer) as IERC165;

    // Check if the oracle has a liquidity accumulator
    if (await erc165.supportsInterface(IHASLIQUIDITYACCUMULATOR_INTERFACEID)) {
        const hasAccumulator: IHasLiquidityAccumulator = new ethers.Contract(
            oracleAddress,
            HAS_LIQUIDITY_ACCUMULATOR_ABI,
            signer
        ) as IHasLiquidityAccumulator;
        const accumulatorAddress = await hasAccumulator.liquidityAccumulator();
        const accumulator: LiquidityAccumulator = new ethers.Contract(
            accumulatorAddress,
            LIQUIDITY_ACCUMULATOR_ABI,
            signer
        ) as LiquidityAccumulator;

        las.push(accumulator);

        console.log("Added liquidity accumulator: " + accumulatorAddress);
    }

    // Check if the oracle has a price accumulator
    if (await erc165.supportsInterface(IHASPRICEACCUMULATOR_INTERFACEID)) {
        const hasAccumulator: IHasPriceAccumulator = new ethers.Contract(
            oracleAddress,
            HAS_PRICE_ACCUMULATOR_ABI,
            signer
        ) as IHasPriceAccumulator;
        const accumulatorAddress = await hasAccumulator.priceAccumulator();
        const accumulator: PriceAccumulator = new ethers.Contract(
            accumulatorAddress,
            PRICE_ACCUMULATOR_ABI,
            signer
        ) as PriceAccumulator;

        pas.push(accumulator);

        console.log("Added price accumulator: " + accumulatorAddress);
    }

    // Check if the oracle is an aggregator
    if (await erc165.supportsInterface(IAGGREGATEDORACLE_INTERFACEID)) {
        const oracle: IAggregatedOracle = new ethers.Contract(
            oracleAddress,
            AGGREGATED_ORACLE_ABI,
            signer
        ) as IAggregatedOracle;

        const underlyingOracles: string[] = await oracle.getOraclesFor(token);

        // Discover underlying accumulators
        for (const underlyingOracle of underlyingOracles) {
            const underlyingAccumulators = await getAccumulators(store, signer, underlyingOracle, token);

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
        await store.put(lasStoreKey, lasToStore);
        await store.put(pasStoreKey, pasToStore);
    } catch (e) {
        console.error(e);
    }

    return {
        las: las,
        pas: pas,
    };
}

async function getAccumulatorUpdateThreshold(
    store: KeyValueStoreClient,
    accumulator: IAccumulator
): Promise<BigNumber> {
    console.log("Getting update threshold for accumulator: " + accumulator.address);

    const updateThresholdStoreKey = accumulator.address + ".updateThreshold";
    const updateThresholdFromStore = await store.get(updateThresholdStoreKey);

    if (updateThresholdFromStore !== undefined && updateThresholdFromStore !== null) {
        try {
            const updateThreshold = BigNumber.from(updateThresholdFromStore);
            console.log("Update threshold for accumulator from store: " + updateThreshold.toString());

            return updateThreshold;
        } catch (e) {}
    }

    const updateThreshold = await accumulator.updateThreshold();
    console.log("Update threshold for accumulator: " + updateThreshold.toString());

    await store.put(updateThresholdStoreKey, updateThreshold.toString());

    return updateThreshold;
}

async function accumulatorNeedsCriticalUpdate(
    store: KeyValueStoreClient,
    accumulator: IAccumulator,
    token: string
): Promise<boolean> {
    console.log("Checking if accumulator needs a critical update: " + accumulator.address);

    const updateThreshold = await getAccumulatorUpdateThreshold(store, accumulator);
    const criticalUpdateThreshold = updateThreshold.add(updateThreshold.div(2)); // updateThreshold * 1.5
    console.log("Critical update threshold: " + criticalUpdateThreshold);

    const criticalUpdateNeeded = await accumulator.changeThresholdSurpassed(token, criticalUpdateThreshold);
    if (criticalUpdateNeeded) {
        console.log("Critical update is needed");
    }

    return criticalUpdateNeeded;
}

async function handleLaUpdate(
    store: KeyValueStoreClient,
    signer: DefenderRelaySigner,
    liquidityAccumulator: LiquidityAccumulator,
    token: string
) {
    const updateData = ethers.utils.hexZeroPad(token, 32);

    if (dryRun || (await liquidityAccumulator.canUpdate(updateData))) {
        if (onlyCritical) {
            // Critical: changePercent >= updateThreshold * 1.5
            if (!(await accumulatorNeedsCriticalUpdate(store, liquidityAccumulator, token))) {
                return;
            }
        }

        console.log("Updating liquidity accumulator:", liquidityAccumulator.address);

        const [tokenLiquidity, quoteTokenLiquidity] = await liquidityAccumulator["consultLiquidity(address,uint256)"](
            token,
            0
        );

        const laUpdateData = ethers.utils.defaultAbiCoder.encode(
            ["address", "uint", "uint"],
            [token, tokenLiquidity, quoteTokenLiquidity]
        );

        if (!dryRun) {
            const updateTx = await liquidityAccumulator.update(laUpdateData, {
                gasLimit: useGasLimit,
            });
            console.log("Update liquidity accumulator tx:", updateTx.hash);
        }
    }
}

function calculateChange(a: BigNumber, b: BigNumber, changePrecision: BigNumber) {
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

async function getAccumulatorQuoteTokenDecimals(
    store: KeyValueStoreClient,
    accumulator: PriceAccumulator
): Promise<number> {
    console.log("Getting quote token decimals for accumulator: " + accumulator.address);

    const quoteTokenDecimalsStoreKey = accumulator.address + ".quoteTokenDecimals";
    const quoteTokenDecimalsFromStore = await store.get(quoteTokenDecimalsStoreKey);

    if (quoteTokenDecimalsFromStore !== undefined && quoteTokenDecimalsFromStore !== null) {
        try {
            const quoteTokenDecimals = parseInt(quoteTokenDecimalsFromStore);
            console.log("Quote token decimals for accumulator from store: " + quoteTokenDecimals.toString());

            return quoteTokenDecimals;
        } catch (e) {}
    }

    const quoteTokenDecimals = await accumulator.quoteTokenDecimals();
    console.log("Quote token decimals for accumulator: " + quoteTokenDecimals.toString());

    await store.put(quoteTokenDecimalsStoreKey, quoteTokenDecimals.toString());

    return quoteTokenDecimals;
}

async function getAccumulatorMaxUpdateDelay(
    store: KeyValueStoreClient,
    accumulator: PriceAccumulator
): Promise<BigNumber> {
    console.log("Getting max update delay for accumulator: " + accumulator.address);

    const maxUpdateDelayStoreKey = accumulator.address + ".maxUpdateDelay";
    const maxUpdateDelayFromStore = await store.get(maxUpdateDelayStoreKey);

    if (maxUpdateDelayFromStore !== undefined && maxUpdateDelayFromStore !== null) {
        try {
            const maxUpdateDelay = BigNumber.from(maxUpdateDelayFromStore);
            console.log("Max update delay for accumulator from store: " + maxUpdateDelay.toString());

            return maxUpdateDelay;
        } catch (e) {}
    }

    const maxUpdateDelay = await accumulator.maxUpdateDelay();
    console.log("Max update delay for accumulator: " + maxUpdateDelay.toString());

    await store.put(maxUpdateDelayStoreKey, maxUpdateDelay.toString());

    return maxUpdateDelay;
}

async function fetchOffchainPrice(token: TokenConfig) {
    var price = 1.0;
    var priceSet = false;

    if (token.validation.routes.length == 0) {
        throw new Error("Token validation has no routes");
    }

    for (const route of token.validation.routes) {
        await axiosInstance
            .get("/api/v3/ticker/price", {
                params: {
                    symbol: route.symbol,
                },
                validateStatus: () => true, // Never throw an error... they're handled below
            })
            .then(async function (response: AxiosResponse) {
                const rateLimitedButHasCache =
                    (response.status == 418 /* rate limit warning */ || response.status == 429) /* IP ban */ &&
                    response.request.fromCache === true;
                if ((response.status >= 200 && response.status < 400) || rateLimitedButHasCache) {
                    var tickerPrice = parseFloat(response.data["price"]);

                    if (tickerPrice == 0) {
                        throw new Error("Ticker price is 0");
                    }

                    if (route.reverse) {
                        tickerPrice = 1.0 / tickerPrice;
                    }

                    price *= tickerPrice;
                    priceSet = true;
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

    if (!priceSet) {
        throw new Error("No price set");
    }

    return price;
}

async function validatePrice(
    store: KeyValueStoreClient,
    accumulator: PriceAccumulator,
    accumulatorPrice: BigNumber,
    token: TokenConfig
) {
    var validated = false;
    var apiPrice = BigNumber.from(0);
    var usePrice = accumulatorPrice;

    console.log("Validating price for accumulator: " + accumulator.address);

    const quoteTokenDecimals = await getAccumulatorQuoteTokenDecimals(store, accumulator);

    const updateData = ethers.utils.hexZeroPad(token.address, 32);

    try {
        apiPrice = ethers.utils.parseUnits(
            (await fetchOffchainPrice(token)).toFixed(quoteTokenDecimals),
            quoteTokenDecimals
        );

        console.log("API price =", ethers.utils.formatUnits(apiPrice, quoteTokenDecimals));
        console.log("Accumulator price =", ethers.utils.formatUnits(accumulatorPrice, quoteTokenDecimals));

        const diff = calculateChange(accumulatorPrice, apiPrice, BigNumber.from("10000")); // in bps

        console.log("Change =", (diff.isInfinite ? "infinite" : diff.change.toString()) + " bps");

        if (!diff.isInfinite && diff.change.lte(token.validation.allowedChangeBps)) {
            validated = true;

            // Use the average of the two prices for on-chain validation
            usePrice = apiPrice.add(accumulatorPrice).div(2);
        }
    } catch (e) {
        console.error(e);
    }

    if (!validated) {
        const timeSinceLastUpdate = await accumulator.timeSinceLastUpdate(updateData);
        const maxUpdateDelay = await getAccumulatorMaxUpdateDelay(store, accumulator);
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
    }

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

async function handlePaUpdate(
    store: KeyValueStoreClient,
    signer: DefenderRelaySigner,
    priceAccumulator: PriceAccumulator,
    token: TokenConfig
) {
    const updateData = ethers.utils.hexZeroPad(token.address, 32);

    if (dryRun || (await priceAccumulator.canUpdate(updateData))) {
        if (onlyCritical) {
            // Critical: changePercent >= updateThreshold * 1.5
            if (!(await accumulatorNeedsCriticalUpdate(store, priceAccumulator, token.address))) {
                return;
            }
        }

        console.log("Updating price accumulator:", priceAccumulator.address);

        var price = await priceAccumulator["consultPrice(address,uint256)"](token.address, 0);

        if (token.validation.enabled) {
            const validation = await validatePrice(store, priceAccumulator, price, token);
            if (!validation.validated) {
                return;
            }

            price = validation.usePrice;
        }

        const paUpdateData = ethers.utils.defaultAbiCoder.encode(["address", "uint"], [token.address, price]);

        if (!dryRun) {
            const updateTx = await priceAccumulator.update(paUpdateData, {
                gasLimit: useGasLimit,
            });
            console.log("Update price accumulator tx:", updateTx.hash);
        }
    }
}

async function getOraclePeriod(store: KeyValueStoreClient, oracle: AggregatedOracle): Promise<number> {
    console.log("Getting period for oracle: " + oracle.address);

    const periodStoreKey = oracle.address + ".period";

    const periodFromStore = await store.get(periodStoreKey);
    if (periodFromStore !== undefined && periodFromStore !== null && !isNaN(parseInt(periodFromStore))) {
        console.log("Period for oracle from store: " + parseInt(periodFromStore));

        return parseInt(periodFromStore);
    }

    const period = await oracle.period();

    console.log("Period for oracle: " + period);

    await store.put(periodStoreKey, period.toNumber().toString());

    return period.toNumber();
}

async function oracleNeedsCriticalUpdate(
    store: KeyValueStoreClient,
    oracle: AggregatedOracle,
    token: string
): Promise<boolean> {
    console.log("Checking if oracle needs a critical update: " + oracle.address);

    const period = await getOraclePeriod(store, oracle);

    const updateData = ethers.utils.hexZeroPad(token, 32);

    const timeSinceLastUpdate = await oracle.timeSinceLastUpdate(updateData);
    console.log("Time since last update: " + timeSinceLastUpdate);

    const criticalUpdateNeeded = timeSinceLastUpdate.gte(period * 1.5);
    if (criticalUpdateNeeded) {
        console.log("Critical update is needed");
    }

    return criticalUpdateNeeded;
}

async function handleOracleUpdate(store: KeyValueStoreClient, oracle: AggregatedOracle, token: string) {
    const updateData = ethers.utils.hexZeroPad(token, 32);

    if (dryRun || (await oracle.canUpdate(updateData))) {
        if (onlyCritical) {
            // Critical: block.timestamp >= observation.timestamp + (period * 1.5)
            if (!(await oracleNeedsCriticalUpdate(store, oracle, token))) {
                return;
            }
        }

        console.log("Updating oracle:", oracle.address);

        if (!dryRun) {
            const updateTx = await oracle.update(updateData, {
                gasLimit: useGasLimit,
            });
            console.log("Update oracle tx:", updateTx.hash);
        }
    }
}

async function keepUpdated(
    store: KeyValueStoreClient,
    signer: DefenderRelaySigner,
    oracleAddress: string,
    token: TokenConfig
) {
    const oracle: AggregatedOracle = new ethers.Contract(
        oracleAddress,
        AGGREGATED_ORACLE_ABI,
        signer
    ) as AggregatedOracle;

    const { las, pas } = await getAccumulators(store, signer, oracleAddress, token.address);

    console.log("Checking liquidity accumulators for needed updates...");

    // Update all liquidity accumulators (if necessary)
    for (const liquidityAccumulator of las) {
        try {
            await handleLaUpdate(store, signer, liquidityAccumulator, token.address);
        } catch (e) {
            console.error(e);
        }
    }

    console.log("Checking price accumulators for needed updates...");

    // Update all price accumulators (if necessary)
    for (const priceAccumulator of pas) {
        try {
            await handlePaUpdate(store, signer, priceAccumulator, token);
        } catch (e) {
            console.error(e);
        }
    }

    console.log("Checking oracle for needed updates...");

    // Update oracle (if necessary)
    await handleOracleUpdate(store, oracle, token.address);
}

type ValidationRoute = {
    symbol: string;
    reverse: boolean;
};

type TokenConfig = {
    enabled?: boolean;
    address: string;
    validation: {
        enabled: boolean;
        routes: ValidationRoute[];
        allowedChangeBps: number;
    };
};

type OracleConfig = {
    enabled: boolean;
    address: string;
    tokens: TokenConfig[];
};

// Entrypoint for the Autotask
export async function handler(event) {
    const target = targetFromArgs ?? config.target;
    const chainConfig = config.chains[target.chain];
    const txConfig = chainConfig.txConfig[target.type];

    useGasLimit = txConfig.gasLimit;
    onlyCritical = target.type === "critical";
    dryRun = config.dryRun;

    if (dryRun && !isLocal) {
        throw new Error("Dry run only supported on local environment");
    }

    const provider = new DefenderRelayProvider(event);
    const signer = new DefenderRelaySigner(event, provider, {
        speed: txConfig.speed as Speed,
        validForSeconds: txConfig.validFor,
    });

    const oraclesConfigs: OracleConfig[] = chainConfig.oracles;

    var store: KeyValueStoreClient;

    if (isLocal) {
        store = new KeyValueStoreClient({ path: "store.json.tmp" });
    } else {
        store = new KeyValueStoreClient(event);
    }

    defenderStore = store;

    console.log("Running for target chain: " + target.chain);

    for (const oracleConfig of oraclesConfigs) {
        if (!oracleConfig.enabled) continue;

        for (const token of oracleConfig.tokens) {
            if (!(token.enabled ?? true)) continue;

            console.log("Updating all components for oracle =", oracleConfig.address, ", token =", token.address);

            await keepUpdated(store, signer, oracleConfig.address, token);
        }
    }
}

async function sleepFor(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handlerRepeat(event, repeatInterval: number) {
    while (true) {
        try {
            await handler(event);
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

            targetFromArgs = {
                chain: chain,
                type: "normal",
            };
        } else {
            apiKey = process.env.API_KEY as string;
            apiSecret = process.env.API_SECRET as string;
        }

        isLocal = true;

        if (argv.every) {
            handlerRepeat({ apiKey, apiSecret }, argv.every)
                .then(() => process.exit(0))
                .catch((error: Error) => {
                    console.error(error);
                    process.exit(1);
                });
        } else {
            handler({ apiKey, apiSecret })
                .then(() => process.exit(0))
                .catch((error: Error) => {
                    console.error(error);
                    process.exit(1);
                });
        }
    }
}
