import * as vscode from 'vscode';

const clipboard: any = import('clipboardy');

export async function write(text: string) {
    const cb = (<any>vscode.env).clipboard;
    if (cb) {
        await cb.writeText(text);
    } else {
        await clipboard.write(text);
    }
}
