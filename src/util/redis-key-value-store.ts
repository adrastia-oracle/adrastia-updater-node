import { RedisClientType } from "redis";
import { IKeyValueStore } from "./key-value-store";

export class RedisKeyValueStore implements IKeyValueStore {
    client: RedisClientType;

    constructor(redisClient: RedisClientType) {
        this.client = redisClient;
    }

    async get(key: string): Promise<string | undefined> {
        return await this.client.get(key);
    }

    async put(key: string, value: string): Promise<void> {
        await this.client.set(key, value);
    }

    async del(key: string): Promise<void> {
        await this.client.del(key);
    }
}
