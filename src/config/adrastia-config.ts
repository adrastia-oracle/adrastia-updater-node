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

export type ValidationConfig = {
    enabled: boolean; // TODO: Replace this with disabled (default false)
    minimumWeight: number;
    sources: ValidationSource[];
    allowedChangeBps: number;
};

export type TxConfig = {
    gasLimit?: bigint;
    gasPriceMultiplierDividend?: bigint;
    gasPriceMultiplierDivisor?: bigint;
    waitForConfirmations?: number;
    transactionTimeout?: number; // In milliseconds
    maxGasPrice?: bigint; // In wei
    txType?: number;
};

export type TokenConfig = {
    enabled?: boolean; // TODO: Replace this with disabled (default false)
    address: string;
    txConfig?: TxConfig;
    validation?: ValidationConfig;
    batch: number;
    extra?: any;
};

export type OracleConfig = {
    enabled: boolean; // TODO: Replace this with disabled (default false)
    address: string;
    txConfig?: TxConfig;
    tokens: TokenConfig[];
};

export type ChainConfig = {
    txConfig?: TxConfig;
    oracles: OracleConfig[];
};

export type AdrastiaConfig = {
    httpCacheSeconds: number;
    txConfig?: TxConfig;
    chains: Record<string, ChainConfig>;
};
