import * as vscode from "vscode";
import { Host } from "./host";
import { Etcd3 } from 'etcd3';
import { AbstractCluster, AbstractClusterExplorer, AbstractObject } from "./abstractcluster";

export const STATE = "ms-kubernetes-tools.vscode-kubernetes-tools.etcd-explorer";

export interface Cluster {
    name: string;
    options: any;
}

export class EtcdObject implements AbstractObject<EtcdObject> {
    readonly name: string;
    options: string | undefined;
    key: string | undefined;
    etcd3: Etcd3 | undefined;
    leaf: boolean = false;
    constructor(name: string, leaf: boolean, options: string | undefined, key: string | undefined, etcd3: Etcd3 | undefined) {
        if (!options && (!key && !etcd3)) {
            throw new Error(`Options or ETCD3 should be provided at least one.`);
        }
        this.name = name;
        this.leaf = leaf;
        this.options = options;
        this.key = key;
        this.etcd3 = etcd3;
        if (this.options && !this.etcd3) {
            this.etcd3 = new Etcd3(JSON.parse(this.options));
        }
    }
    async getChildren(): Promise<EtcdObject[]> {
        if (this.leaf) {
            return [];
        }
        try {
            const keys = await this.etcd3!.getAll().prefix(this.key!).keys("ascii");
            return keys.map((key) => new EtcdObject(key.toString(), true, undefined, `${key.toString()}`, this.etcd3));
        } catch (err) {
            vscode.window.showWarningMessage(`Unexpected error on talking to ${this.name}: ${JSON.stringify(err)}`);
            return [];
        }
    }
    getTreeItem(): vscode.TreeItem {
        const item = this.leaf ? new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.None) :
            new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.command = {
            command: "kubernetes.etcdExplorer.getKeyValue",
            title: "Get value",
            arguments: [this]
        };
        return item;
    }
}

export class EtcdExplorer extends AbstractClusterExplorer<EtcdObject> {
    protected name(cluster: AbstractCluster): string {
        return (cluster as Cluster).name || JSON.stringify(cluster);
    }
    readonly context: vscode.ExtensionContext;
    constructor(host: Host, context: vscode.ExtensionContext) {
        super(host, context);
        this.context = context;
    }

    protected async getClusters(): Promise<EtcdObject[]> {
        const rawClusters: string = this.context.globalState.get(STATE) || "[]";
        const clusters: Cluster[] = JSON.parse(rawClusters);
        return Promise.resolve(clusters.map((cluster) => {
            const options = cluster.options || {};
            const etcd = new Etcd3(options);
            return new EtcdObject(cluster.name, false, undefined, "/", etcd);
        }));
    }

    public async removeClusters() {
        super.removeClusters(STATE);
    }
}

export async function addExistingEtcdCluster(etcdExplorer: EtcdExplorer, context: vscode.ExtensionContext) {
    const hosts = await vscode.window.showInputBox({ prompt: `Please specify hosts of the existing cluster:`, placeHolder: `127.0.0.1:2379` });
    if (!hosts) {
        vscode.window.showErrorMessage(`Cluster hosts is required.`);
        return;
    }
    const name = await vscode.window.showInputBox({ prompt: `Please specify the cluster name:`, placeHolder: hosts });
    const state: string | undefined = context.globalState.get(STATE);
    const clusters: Cluster[] = JSON.parse(state || "[]");
    const validClusters: Cluster[] = [];
    let exists = false;
    for (const cluster of clusters) {
        if (!cluster.name || !cluster.options) {
            continue;
        }
        if (cluster.name === name) {
            cluster.options = { hosts: hosts };
            exists = true;
        }
        validClusters.push(cluster);
    }
    if (!exists) {
        validClusters.push({ name: name || hosts, options: { hosts: hosts } });
    }
    context.globalState.update(STATE, JSON.stringify(validClusters));
    etcdExplorer.refresh();
}

export function create(host: Host, context: vscode.ExtensionContext): EtcdExplorer {
    return new EtcdExplorer(host, context);
}

export async function getKeyValue(node: EtcdObject): Promise<void> {
    try {
        if (node.etcd3 && node.key) {
            const value = await node.etcd3.get(node.key).buffer();
            if (value) {
                let doc = { language: "plaintext", content: value.toString("base64") };
                try {
                    JSON.parse(value.toString());
                    doc = { language: "json", content: value.toString() };
                } catch (_err) { }
                vscode.workspace.openTextDocument({ language: doc.language, content: doc.content }).then((d) => {
                    vscode.window.showTextDocument(d);
                });
            } else {
                vscode.window.showWarningMessage(`Got null value of ${node.name}.`);
            }
        } else {
            vscode.window.showWarningMessage(`Unable to get value of ${node.name} for cluster or key is invalid.`);
        }
    } catch (err) {
        vscode.window.showWarningMessage(`Unexpected error on talking to ${node.name}: ${JSON.stringify(err)}`);
    }
}
