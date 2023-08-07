import * as vscode from "vscode";
import { affectsUs } from "./components/config/config";
import { Host } from "./host";

export interface AbstractObject<T> {
    getChildren(): Promise<T[]>;
    getTreeItem(): vscode.TreeItem;
}

export interface AbstractCluster {
}

export abstract class AbstractClusterExplorer<T extends AbstractObject<T>> implements vscode.TreeDataProvider<T> {
    readonly context: vscode.ExtensionContext;
    private onDidChangeTreeDataEmitter: vscode.EventEmitter<T | undefined> = new vscode.EventEmitter<T | undefined>();
    readonly onDidChangeTreeData: vscode.Event<T | undefined> = this.onDidChangeTreeDataEmitter.event;
    constructor(host: Host, context: vscode.ExtensionContext) {
        this.context = context;
        host.onDidChangeConfiguration((change) => {
            if (affectsUs(change)) {
                this.refresh();
            }
        });
    }

    getTreeItem(element: T): vscode.TreeItem | Promise<vscode.TreeItem> {
        return element.getTreeItem();
    }

    getChildren(parent?: T): vscode.ProviderResult<T[]> {
        if (parent) {
            return parent.getChildren();
        }

        return this.getClusters();
    }

    async refresh(node?: T): Promise<void> {
        this.onDidChangeTreeDataEmitter.fire(node);
    }

    protected abstract getClusters(): vscode.ProviderResult<T[]>;
    protected abstract name(cluster: AbstractCluster): string;

    public async removeClusters(storage: string) {
        const state: string | undefined = this.context.globalState.get(storage);
        const clusters: AbstractCluster[] = JSON.parse(state || "[]");
        if (!clusters || clusters.length <= 0) {
            vscode.window.showInformationMessage(`No clusters found ... `);
            return;
        }
        const candidates = clusters.map((cluster) => this.name(cluster));
        const selection = await vscode.window.showQuickPick(candidates, { canPickMany: true, title: `Please select clusters you want to remove:` });
        if (!selection || selection.length <= 0) {
            vscode.window.showInformationMessage(`User cancelled removing clusters ... `);
            return;
        } else {
            const confirm = await vscode.window.showWarningMessage(`Are you sure to remove clusters: ${JSON.stringify(selection)}?`, { modal: true }, "Yes", "No");
            if ("yes" !== confirm?.toLowerCase()) {
                vscode.window.showInformationMessage(`User cancelled removing clusters ... `);
                return;
            }
        }
        const deleting = new Set(selection);
        const keptClusters: AbstractCluster[] = [];
        for (const cluster of clusters) {
            if (!deleting.has(this.name(cluster))) {
                keptClusters.push(cluster);
            }
        }
        this.context.globalState.update(storage, JSON.stringify(keptClusters));
    }
}
