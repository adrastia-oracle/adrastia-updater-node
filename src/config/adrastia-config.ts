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
    disabled?: boolean; // Default: false
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
    disabled?: boolean; // Default: false
    address: string | string[];
    txConfig?: TxConfig;
    validation?: ValidationConfig;
    batch: number;
    extra?: any;
};

export type OracleConfig = {
    disabled?: boolean; // Default: false
    address: string;
    txConfig?: TxConfig;
    tokens: TokenConfig[];
};

export type BatchLoggingConfig = {
    sourceToken: string;
    level: "debug" | "info" | "warn" | "error";
};

export type BatchConfig = {
    pollingInterval?: number; // In milliseconds. Default: one-shot.
    writeDelay?: number; // In milliseconds. Default: 0.
    logging?: BatchLoggingConfig;
};

export type ChainConfig = {
    txConfig?: TxConfig;
    multicall2Address?: string;
    uptimeWebhookUrl?: string;
    oracles: OracleConfig[];
    batches?: Record<number, BatchConfig>;
};

export type AdrastiaConfig = {
    httpCacheSeconds: number;
    txConfig?: TxConfig;
    chains: Record<string, ChainConfig>;
};
