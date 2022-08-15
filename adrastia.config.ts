export type ValidationRoute = {
    symbol: string;
    reverse: boolean;
};

export type TokenConfig = {
    enabled?: boolean;
    address: string;
    validation: {
        enabled: boolean;
        routes: ValidationRoute[];
        allowedChangeBps: number;
    };
    batch: number;
};

export type OracleConfig = {
    enabled: boolean;
    address: string;
    tokens: TokenConfig[];
};

export type UpdaterMode = "normal" | "critical";

export type TxConfig = {
    speed: "normal" | "fast" | "fastest";
    validFor: number;
    gasLimit: number;
};

export type ChainConfig = {
    txConfig: Record<UpdaterMode, TxConfig>;
    oracles: OracleConfig[];
};

export type AdrastiaConfig = {
    target: {
        chain: string;
        type: UpdaterMode;
        batch: number;
        delay: number;
    };
    dryRun: boolean;
    chains: Record<string, ChainConfig>;
};

const config: AdrastiaConfig = {
    // Change target to generate a different script
    target: {
        chain: "polygon",
        type: "normal",
        batch: 1,
        delay: 0, // The amount of time in seconds that has to pass (with an update being needed) before an update transaction is sent
    },
    dryRun: true,
    chains: {
        polygon: {
            txConfig: {
                normal: {
                    speed: "fast",
                    validFor: 120,
                    gasLimit: 1000000,
                },
                critical: {
                    speed: "fastest",
                    validFor: 60,
                    gasLimit: 1000000,
                },
            },
            oracles: [
                {
                    enabled: true,
                    address: "0x637D98D08331Af95DF392CC035629e64987E9Ae3", // Aggregated oracle USDC
                    tokens: [
                        {
                            enabled: true,
                            address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", // WETH
                            validation: {
                                enabled: true,
                                routes: [
                                    {
                                        symbol: "ETHUSDC",
                                        reverse: false,
                                    },
                                ],
                                allowedChangeBps: 100,
                            },
                            batch: 1,
                        },
                        {
                            enabled: true,
                            address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC
                            validation: {
                                enabled: true,
                                routes: [
                                    {
                                        symbol: "MATICUSDT",
                                        reverse: false,
                                    },
                                    {
                                        symbol: "USDCUSDT",
                                        reverse: true,
                                    },
                                ],
                                allowedChangeBps: 100,
                            },
                            batch: 1,
                        },
                        {
                            enabled: true,
                            address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", // USDT
                            validation: {
                                enabled: true,
                                routes: [
                                    {
                                        symbol: "USDCUSDT",
                                        reverse: true,
                                    },
                                ],
                                allowedChangeBps: 100,
                            },
                            batch: 1,
                        },
                    ],
                },
                {
                    enabled: true,
                    address: "0xB284ed29FfC44d62F382202A9232EE8d5AcaebEf", // Aggregated oracle WETH
                    tokens: [
                        {
                            enabled: true,
                            address: "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6", // WBTC
                            validation: {
                                enabled: true,
                                routes: [
                                    {
                                        symbol: "WBTCETH",
                                        reverse: false,
                                    },
                                ],
                                allowedChangeBps: 100,
                            },
                            batch: 1,
                        },
                        {
                            enabled: true,
                            address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC
                            validation: {
                                enabled: true,
                                routes: [
                                    {
                                        symbol: "MATICETH",
                                        reverse: false,
                                    },
                                ],
                                allowedChangeBps: 100,
                            },
                            batch: 1,
                        },
                        {
                            enabled: true,
                            address: "0xd6df932a45c0f255f85145f286ea0b292b21c90b", // AAVE
                            validation: {
                                enabled: true,
                                routes: [
                                    {
                                        symbol: "AAVEETH",
                                        reverse: false,
                                    },
                                ],
                                allowedChangeBps: 100,
                            },
                            batch: 1,
                        },
                    ],
                },
                {
                    enabled: true,
                    address: "0x49fdef7a903bBe540b1E79Bb2AfE6645B393Bdb4", // Aggregated oracle WMATIC
                    tokens: [
                        {
                            enabled: true,
                            address: "0xbbba073c31bf03b8acf7c28ef0738decf3695683", // SAND
                            validation: {
                                enabled: true,
                                routes: [
                                    {
                                        symbol: "SANDUSDT",
                                        reverse: false,
                                    },
                                    {
                                        symbol: "MATICUSDT",
                                        reverse: true,
                                    },
                                ],
                                allowedChangeBps: 100,
                            },
                            batch: 1,
                        },
                        {
                            enabled: true,
                            address: "0x3a58a54c066fdc0f2d55fc9c89f0415c92ebf3c4", // stMATIC
                            validation: {
                                enabled: false,
                                routes: [],
                                allowedChangeBps: 100,
                            },
                            batch: 1,
                        },
                        {
                            enabled: true,
                            address: "0x831753dd7087cac61ab5644b308642cc1c33dc13", // QUICK
                            validation: {
                                enabled: true,
                                routes: [
                                    {
                                        symbol: "QUICKUSDT",
                                        reverse: false,
                                    },
                                    {
                                        symbol: "MATICUSDT",
                                        reverse: true,
                                    },
                                ],
                                allowedChangeBps: 100,
                            },
                            batch: 1,
                        },
                    ],
                },
            ],
        },
        arbitrumOne: {
            txConfig: {
                normal: {
                    speed: "fast",
                    validFor: 120,
                    gasLimit: 1000000,
                },
                critical: {
                    speed: "fastest",
                    validFor: 60,
                    gasLimit: 1000000,
                },
            },
            oracles: [
                {
                    enabled: true,
                    address: "0x138b866d20349fc522cFBFA64335829BA547681b", // Aggregated oracle USDC
                    tokens: [
                        {
                            enabled: true,
                            address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", // WETH
                            validation: {
                                enabled: true,
                                routes: [
                                    {
                                        symbol: "ETHUSDC",
                                        reverse: false,
                                    },
                                ],
                                allowedChangeBps: 100,
                            },
                            batch: 1,
                        },
                    ],
                },
            ],
        },
        avalanche: {
            txConfig: {
                normal: {
                    speed: "fast",
                    validFor: 120,
                    gasLimit: 1000000,
                },
                critical: {
                    speed: "fastest",
                    validFor: 60,
                    gasLimit: 1000000,
                },
            },
            oracles: [
                {
                    enabled: true,
                    address: "0x138b866d20349fc522cFBFA64335829BA547681b", // Aggregated oracle USDC
                    tokens: [
                        {
                            enabled: true,
                            address: "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7", // WAVAX
                            validation: {
                                enabled: true,
                                routes: [
                                    {
                                        symbol: "AVAXUSDT",
                                        reverse: false,
                                    },
                                    {
                                        symbol: "USDCUSDT",
                                        reverse: true,
                                    },
                                ],
                                allowedChangeBps: 100,
                            },
                            batch: 1,
                        },
                        {
                            enabled: true,
                            address: "0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab", // WETH.e
                            validation: {
                                enabled: true,
                                routes: [
                                    {
                                        symbol: "ETHUSDC",
                                        reverse: false,
                                    },
                                ],
                                allowedChangeBps: 100,
                            },
                            batch: 1,
                        },
                    ],
                },
            ],
        },
        bsc: {
            txConfig: {
                normal: {
                    speed: "fast",
                    validFor: 120,
                    gasLimit: 1000000,
                },
                critical: {
                    speed: "fastest",
                    validFor: 60,
                    gasLimit: 1000000,
                },
            },
            oracles: [
                {
                    enabled: true,
                    address: "0xeDA407758c98A4bC34763e6A9DFF7313f817C7d6", // Aggregated oracle BUSD
                    tokens: [
                        {
                            enabled: true,
                            address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", // WBNB
                            validation: {
                                enabled: true,
                                routes: [
                                    {
                                        symbol: "BNBUSDC",
                                        reverse: false,
                                    },
                                ],
                                allowedChangeBps: 100,
                            },
                            batch: 1,
                        },
                    ],
                },
            ],
        },
        optimism: {
            txConfig: {
                normal: {
                    speed: "fast",
                    validFor: 120,
                    gasLimit: 1000000,
                },
                critical: {
                    speed: "fastest",
                    validFor: 60,
                    gasLimit: 1000000,
                },
            },
            oracles: [
                {
                    enabled: true,
                    address: "0x127EE750A56A64c39c2d7abb30d221c51cEDBe12", // Uniswap v3 (3%) Oracle DAI
                    tokens: [
                        {
                            enabled: true,
                            address: "0x4200000000000000000000000000000000000006", // WETH
                            validation: {
                                enabled: true,
                                routes: [
                                    {
                                        symbol: "ETHUSDT",
                                        reverse: false,
                                    },
                                    {
                                        symbol: "USDTDAI",
                                        reverse: false,
                                    },
                                ],
                                allowedChangeBps: 100,
                            },
                            batch: 1,
                        },
                    ],
                },
            ],
        },
    },
};

export default config;
