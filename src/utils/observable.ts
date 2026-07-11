export interface Observable<T> {
    subscribe(observer: Observer<T>): void;
}

export interface Observer<T> {
    onNext(value: T): Promise<boolean>;
}

export type Sequence<T> = T | Promise<T> | Observable<T>;

export function isObservable<T>(s: Sequence<T>): s is Observable<T> {
    return !!((s as Observable<T>).subscribe);
}

export function isThenable<T>(s: Sequence<T>): s is Promise<T> {
    return !!((s as Promise<T>).then);
}
