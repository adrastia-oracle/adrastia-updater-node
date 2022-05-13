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
                    address: "0x9A8ecEeca9388aC17B690d3D4Ae5f37edC01bD05", // Aggregated oracle USDC
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
                            address: "0xE6469Ba6D2fD6130788E0eA9C0a0515900563b59", // UST
                            validation: {
                                enabled: true,
                                routes: [
                                    {
                                        symbol: "USTBUSD",
                                        reverse: false,
                                    },
                                    {
                                        symbol: "BUSDUSDT",
                                        reverse: true,
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
                    address: "0x71Db3CB69D09bf4ca97a440B331A51e7826a768A", // Aggregated oracle WETH
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
                    address: "0x8aC5f2E2960fb3d022cD45f5410201c5bFc95891", // Aggregated oracle WMATIC
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
    },
};
