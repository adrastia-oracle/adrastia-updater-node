// Import dependencies available in the autotask environment
import { DefenderRelayProvider, DefenderRelaySigner } from "defender-relay-client/lib/ethers";
import { ethers } from "ethers";

// Import typechain
import { IERC165 } from "../../typechain";
import { IAggregatedOracle, IHasLiquidityAccumulator, IHasPriceAccumulator } from "../../typechain/interfaces";
import { LiquidityAccumulator, PriceAccumulator } from "../../typechain/accumulators";

// Import ABIs
import { abi as IERC165_ABI } from "@openzeppelin-v4/contracts/build/contracts/IERC165.json";
import { abi as AGGREGATED_ORACLE_ABI } from "@pythia-oracle/pythia-core/artifacts/contracts/interfaces/IAggregatedOracle.sol/IAggregatedOracle.json";
import { abi as PRICE_ACCUMULATOR_ABI } from "@pythia-oracle/pythia-core/artifacts/contracts/accumulators/PriceAccumulator.sol/PriceAccumulator.json";
import { abi as LIQUIDITY_ACCUMULATOR_ABI } from "@pythia-oracle/pythia-core/artifacts/contracts/accumulators/LiquidityAccumulator.sol/LiquidityAccumulator.json";
import { abi as HAS_PRICE_ACCUMULATOR_ABI } from "@pythia-oracle/pythia-core/artifacts/contracts/interfaces/IHasPriceAccumulator.sol/IHasPriceAccumulator.json";
import { abi as HAS_LIQUIDITY_ACCUMULATOR_ABI } from "@pythia-oracle/pythia-core/artifacts/contracts/interfaces/IHasLiquidityAccumulator.sol/IHasLiquidityAccumulator.json";

// Import config
import config from "../../pythia.config";
import { Speed } from "defender-relay-client";
import { KeyValueStoreClient } from "defender-kvstore-client";

// Interface IDs
const IHASLIQUIDITYACCUMULATOR_INTERFACEID = "0x06a5df37";
const IHASPRICEACCUMULATOR_INTERFACEID = "0x6b72d0ba";
const IAGGREGATEDORACLE_INTERFACEID = "0xce2362c4";

// Variables
var isLocal = false;
var useGasLimit = 1000000;
var onlyCritical = false;

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

async function handleLaUpdate(
    store: KeyValueStoreClient,
    signer: DefenderRelaySigner,
    liquidityAccumulator: LiquidityAccumulator,
    token: string
) {
    const updateData = ethers.utils.hexZeroPad(token, 32);

    if (await liquidityAccumulator.canUpdate(updateData)) {
        if (onlyCritical) {
            // Critical: changePercent >= updateThreshold * 1.5
            // TODO
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

        const updateTx = await liquidityAccumulator.update(laUpdateData, {
            gasLimit: useGasLimit,
        });
        console.log("Update liquidity accumulator tx:", updateTx.hash);
    }
}

async function handlePaUpdate(
    store: KeyValueStoreClient,
    signer: DefenderRelaySigner,
    priceAccumulator: PriceAccumulator,
    token: string
) {
    const updateData = ethers.utils.hexZeroPad(token, 32);

    if (await priceAccumulator.canUpdate(updateData)) {
        if (onlyCritical) {
            // Critical: changePercent >= updateThreshold * 1.5
            // TODO
        }

        console.log("Updating price accumulator:", priceAccumulator.address);

        const price = await priceAccumulator["consultPrice(address,uint256)"](token, 0);

        const paUpdateData = ethers.utils.defaultAbiCoder.encode(["address", "uint"], [token, price]);

        const updateTx = await priceAccumulator.update(paUpdateData, {
            gasLimit: useGasLimit,
        });
        console.log("Update price accumulator tx:", updateTx.hash);
    }
}

async function handleOracleUpdate(
    store: KeyValueStoreClient,
    signer: DefenderRelaySigner,
    oracle: IAggregatedOracle,
    token: string
) {
    const updateData = ethers.utils.hexZeroPad(token, 32);

    if (await oracle.canUpdate(updateData)) {
        if (onlyCritical) {
            // Critical: timestamp >= observation.timestamp + (period * 1.5)
            // TODO
        }

        console.log("Updating oracle:", oracle.address);

        const updateTx = await oracle.update(updateData, {
            gasLimit: useGasLimit,
        });
        console.log("Update oracle tx:", updateTx.hash);
    }
}

async function keepUpdated(
    store: KeyValueStoreClient,
    signer: DefenderRelaySigner,
    oracleAddress: string,
    token: string
) {
    const oracle: IAggregatedOracle = new ethers.Contract(
        oracleAddress,
        AGGREGATED_ORACLE_ABI,
        signer
    ) as IAggregatedOracle;

    const { las, pas } = await getAccumulators(store, signer, oracleAddress, token);

    console.log("Checking liquidity accumulators for needed updates...");

    // Update all liquidity accumulators (if necessary)
    for (const liquidityAccumulator of las) {
        try {
            await handleLaUpdate(store, signer, liquidityAccumulator, token);
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
    await handleOracleUpdate(store, signer, oracle, token);
}

type OracleConfig = {
    enabled: boolean;
    address: string;
    tokens: string[];
};

// Entrypoint for the Autotask
export async function handler(event) {
    const chainConfig = config.chains[config.target.chain];
    const txConfig = chainConfig.txConfig[config.target.type];

    useGasLimit = txConfig.gasLimit;
    onlyCritical = config.target.type === "critical";

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

    for (const oracleConfig of oraclesConfigs) {
        if (!oracleConfig.enabled) continue;

        for (const token of oracleConfig.tokens) {
            console.log("Updating all components for oracle =", oracleConfig.address, ", token =", token);

            await keepUpdated(store, signer, oracleConfig.address, token);
        }
    }
}

type EnvInfo = {
    API_KEY: string;
    API_SECRET: string;
};

// To run locally (this code will not be executed in Autotasks)
if (require.main === module) {
    require("dotenv").config();
    const { API_KEY: apiKey, API_SECRET: apiSecret } = process.env as EnvInfo;
    isLocal = true;
    handler({ apiKey, apiSecret })
        .then(() => process.exit(0))
        .catch((error: Error) => {
            console.error(error);
            process.exit(1);
        });
}
