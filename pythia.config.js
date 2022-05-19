export default {
    // Change target to generate a different script
    target: {
        chain: "polygon",
        type: "normal",
    },
    dryRun: false,
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
                        },
                        {
                            enabled: true,
                            address: "0x3a58a54c066fdc0f2d55fc9c89f0415c92ebf3c4", // stMATIC
                            validation: {
                                enabled: false,
                                routes: [],
                                allowedChangeBps: 100,
                            },
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
                        },
                    ],
                },
            ],
        },
    },
};
