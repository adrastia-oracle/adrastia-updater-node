export default {
    // Change target to generate a different script
    target: {
        chain: "polygon",
        type: "normal",
    },
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
                    address: "0xC8a4609C18ca3628676C0478779037898ab498f4", // Aggregated oracle USDC
                    tokens: [
                        "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", // WETH
                        "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC
                    ],
                },
            ],
        },
    },
};
