import { BucketItem, BucketStream } from "minio";
import { Readable } from "stream";

export async function readToBuffer(is: Readable): Promise<Buffer> {
    if (undefined === is || null === is) {
        return Promise.resolve(Buffer.from([]));
    }
    return new Promise((resolve) => {
        let length = 0;
        const buffers: Buffer[] = [];
        const finish = () => {
            const buffer = Buffer.alloc(length);
            buffers.forEach((buf) => buf.copy(buffer));
            resolve(buffer);
        };
        is.on("data", (chunk: any) => {
            const data = Buffer.from(chunk);
            buffers.push(data);
            length += data.length;
        });
        is.on("end", finish);
        is.on("close", finish);
    });
}

export async function readToList<T>(is: BucketStream<BucketItem>): Promise<T[]> {
    if (undefined === is || null === is) {
        return Promise.resolve([]);
    }
    return new Promise((resolve) => {
        const items: T[] = [];
        const finish = () => {
            resolve(items);
        };
        is.on("data", (item: any) => {
            items.push(item);
        });
        is.on("end", finish);
        is.on("error", finish);
        is.on("close", finish);
    });
}

