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
    eip1559?: {
        percentile?: number;
        historicalBlocks?: number;
    };
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
    type: "logtail" | "datadog";
    sourceToken: string;
    level: "debug" | "info" | "notice" | "warn" | "error";
    region?: string;
};

export type BatchConfig = {
    pollingInterval?: number; // In milliseconds. Default: one-shot.
    writeDelay?: number; // In milliseconds. Default: 0.
    logging?: BatchLoggingConfig;
    customerId?: string;
    batchId?: string;
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
