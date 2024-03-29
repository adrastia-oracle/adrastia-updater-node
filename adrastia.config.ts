import { AdrastiaConfig } from "./src/config/adrastia-config";

const config: AdrastiaConfig = {
    httpCacheSeconds: 30, // The amount of time in seconds that the HTTP cache (used when fetching off-chain prices) is valid for
    chains: {
        polygon: {
            txConfig: {
                gasPriceMultiplierDividend: 125n,
                gasPriceMultiplierDivisor: 100n,
                gasLimit: 1000000n,
                transactionTimeout: 120 * 1000,
            },
            oracles: [
                {
                    address: "0x637D98D08331Af95DF392CC035629e64987E9Ae3", // Aggregated oracle USDC
                    tokens: [
                        {
                            address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", // WETH
                            validation: {
                                minimumWeight: 8,
                                sources: [
                                    {
                                        weight: 8,
                                        type: "binance", // Binance
                                        routes: [
                                            {
                                                symbol: "ETHBUSD", // ETH -> BUSD (1:1 w/ USDC)
                                                reverse: false,
                                            },
                                        ],
                                    },
                                    {
                                        weight: 1,
                                        type: "binance", // MEXC Exchange
                                        routes: [
                                            {
                                                symbol: "ETHUSDT", // ETH -> USDT
                                                reverse: false,
                                                source: "https://api.mexc.com",
                                            },
                                            {
                                                symbol: "USDCUSDT", // USDT -> USDC
                                                reverse: true,
                                                source: "https://api.mexc.com",
                                            },
                                        ],
                                    },
                                    {
                                        weight: 6,
                                        type: "kraken", // Kraken
                                        routes: [
                                            {
                                                symbol: "XETHZUSD", // ETH -> USD
                                                reverse: false,
                                            },
                                            {
                                                symbol: "USDCUSD", // USD -> USDC
                                                reverse: true,
                                            },
                                        ],
                                    },
                                    {
                                        weight: 6,
                                        type: "coinbase", // Coinbase
                                        routes: [
                                            {
                                                symbol: "ETH-USD", // ETH -> USD
                                                reverse: false,
                                            },
                                            {
                                                symbol: "USDT-USD", // USD -> USDT
                                                reverse: true,
                                            },
                                            {
                                                symbol: "USDT-USDC", // USDT -> USDC
                                                reverse: false,
                                            },
                                        ],
                                    },
                                    {
                                        weight: 1,
                                        type: "kucoin", // Kucoin
                                        routes: [
                                            {
                                                symbol: "ETH-USDT", // ETH -> USDT
                                                reverse: false,
                                            },
                                            {
                                                symbol: "USDT-USDC", // USDT -> USDC
                                                reverse: false,
                                            },
                                        ],
                                    },
                                    {
                                        weight: 1,
                                        type: "bitstamp", // Bitstamp
                                        routes: [
                                            {
                                                symbol: "ethusd", // ETH -> USD
                                                reverse: false,
                                            },
                                            {
                                                symbol: "usdcusd", // USD -> USDC
                                                reverse: true,
                                            },
                                        ],
                                    },
                                    {
                                        weight: 1,
                                        type: "bitfinix", // Bitfinix
                                        routes: [
                                            {
                                                symbol: "ETHUSD", // ETH -> USD
                                                reverse: false,
                                            },
                                            {
                                                symbol: "UDCUSD", // USD -> USDC
                                                reverse: true,
                                            },
                                        ],
                                    },
                                    {
                                        weight: 1,
                                        type: "huobi", // Huobi
                                        routes: [
                                            {
                                                symbol: "ethusdt", // ETH -> USDT
                                                reverse: false,
                                            },
                                            {
                                                symbol: "usdcusdt", // USDT -> USDC
                                                reverse: true,
                                            },
                                        ],
                                    },
                                    {
                                        weight: 1,
                                        type: "coinex", // CoinEx
                                        routes: [
                                            {
                                                symbol: "ETHUSDT", // ETH -> USDT
                                                reverse: false,
                                            },
                                            {
                                                symbol: "USDCUSDT", // USDT -> USDC
                                                reverse: true,
                                            },
                                        ],
                                    },
                                    {
                                        weight: 10,
                                        type: "llama", // DefiLlama
                                        routes: [
                                            {
                                                symbol: "polygon:0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", // WETH -> USD
                                                reverse: false,
                                            },
                                            {
                                                symbol: "polygon:0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USD -> USDC
                                                reverse: true,
                                            },
                                        ],
                                    },
                                ],
                                allowedChangeBps: 100,
                            },
                            batch: 0,
                        },
                    ],
                },
            ],
        },
    },
};

export default config;
