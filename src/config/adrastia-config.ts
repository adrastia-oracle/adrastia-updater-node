export type ValidationSource = {
    weight: number;
    type: "binance" | "llama" | "kraken" | "coinbase" | "kucoin" | "bitstamp" | "bitfinix" | "huobi" | "coinex";
    routes: ValidationRoute[];
};

export type ValidationRoute = {
    symbol: string;
    reverse: boolean;
    source?: string;
};

export type TokenConfig = {
    enabled?: boolean;
    address: string;
    validation: {
        enabled: boolean;
        minimumWeight: number;
        sources: ValidationSource[];
        allowedChangeBps: number;
    };
    batch: number;
    extra?: any;
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
    httpCacheSeconds: number;
    type: "dex" | "gas" | "aci-address";
    chains: Record<string, ChainConfig>;
};
