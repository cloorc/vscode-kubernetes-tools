import * as vscode from 'vscode';

export function append<T>(first: vscode.ProviderResult<T[]>, ...rest: Promise<T[]>[]): vscode.ProviderResult<T[]> {
    if (isThenable(first)) {
        return appendAsync(first, ...rest);
    } else {
        return appendSyncAsync(first as T[], ...rest);
    }
}

export function transform<T>(obj: T | Promise<T>, f: (t: T) => void): T | Promise<T> {
    if (isThenableStrict(obj)) {
        return transformThenable(obj, f);
    }
    f(obj);
    return obj;
}

export function transformPossiblyAsync<T>(obj: T | Promise<T>, f: (t: T) => true | Promise<true>): T | Promise<T> {
    if (isThenableStrict(obj)) {
        return transformPossiblyAsyncThenable(obj, f);
    }
    const transformer = f(obj);
    if (transformer === true) {
        return obj;
    } else {
        return whenReady(transformer, obj);
    }
}

export function map<T, U>(source: vscode.ProviderResult<T[]>, f: (t: T) => U): U[] | vscode.ProviderResult<U[]> {
    if (isThenable(source)) {
        return mapThenable(source, f);
    }
    if (!source) {
        return source;
    }
    return (source as T[]).map(f);
}

function isThenable<T>(r: vscode.ProviderResult<T>): r is Promise<T | null | undefined> {
    return !!((r as Promise<T>).then);
}

function isThenableStrict<T>(r: T | Promise<T>): r is Promise<T> {
    return !!((r as Promise<T>).then);
}

async function appendAsync<T>(first: Promise<T[] | null | undefined>, ...rest: Promise<T[]>[]): Promise<T[]> {
    return appendSyncAsync(await first, ...rest);
}

async function appendSyncAsync<T>(first: T[] | null | undefined, ...rest: Promise<T[]>[]): Promise<T[]> {
    const f = first || [];
    const r = await Promise.all(rest);
    return f.concat(...r);
}

async function transformThenable<T>(obj: Promise<T>, f: (t: T) => void): Promise<T> {
    f(await obj);
    return obj;
}

async function transformPossiblyAsyncThenable<T>(obj: Promise<T>, f: (t: T) => true | Promise<true>): Promise<T> {
    const transformer = f(await obj);
    if (transformer === true) {
        return obj;
    } else {
        return whenReady(transformer, obj);
    }
}

async function mapThenable<T, U>(obj: Promise<T[] | null | undefined>, f: (t: T) => U): Promise<U[] | null | undefined> {
    const sequence = await obj;
    if (!sequence) {
        return sequence;
    }
    return sequence.map(f);
}

async function whenReady<T>(w: Promise<true>, obj: T): Promise<T> {
    await w;
    return obj;
}
