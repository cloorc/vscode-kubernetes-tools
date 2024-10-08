import * as vscode from 'vscode';

const HELM_CHANNEL = "Helm";
const DEFAULT_CHANNEL = "Kubernetes";

interface Logger extends vscode.Disposable {
    log(msg: string): void;
}

// LoggingConsole provides a log-like facility for sending messages to a shared output channel.
//
// A console is disposable, since it allocates a channel.
class LoggingConsole implements Logger {
    channel: vscode.OutputChannel;
    constructor(channelName: string) {
        this.channel = vscode.window.createOutputChannel(channelName);
    }
    log(msg: string) {
        this.channel.append(msg);
        this.channel.append("\n");
        this.channel.show(true);
    }
    dispose() {
        this.channel.dispose();
    }
}

export const helm: Logger = new LoggingConsole(HELM_CHANNEL);
export const kubernetes = new LoggingConsole(DEFAULT_CHANNEL);
