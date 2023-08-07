import * as vscode from "vscode";
import { Host } from "./host";
import * as Minio from 'minio';
import { readToBuffer, readToList } from "./utils/stream";
import { kubernetes } from "./logger";
import { AbstractCluster, AbstractClusterExplorer, AbstractObject } from "./abstractcluster";

export const MINIO_STATE = "ms-kubernetes-tools.vscode-kubernetes-tools.minio-explorer";

export type Cluster = Minio.ClientOptions & AbstractCluster;

export class MinioObject implements AbstractObject<MinioObject> {
    readonly name: string;
    readonly path: string;
    readonly bucket: string | undefined;
    options: string | undefined;
    minio: Minio.Client | undefined;
    file: boolean = false;
    constructor(name: string, path: string, file: boolean, bucket: string | undefined, options: string | undefined, minio: Minio.Client | undefined) {
        if (!options && (!bucket && !minio)) {
            throw new Error(`Options or minio should be provided at least one.`);
        }
        this.name = name;
        this.path = path;
        this.file = file;
        this.options = options;
        this.bucket = bucket;
        this.minio = minio;
        if (this.options && !this.minio) {
            this.minio = new Minio.Client(JSON.parse(this.options));
        }
    }
    async getChildren(): Promise<MinioObject[]> {
        if (this.file) {
            return [];
        }
        return new Promise((resolve) => {
            try {
                if (!this.bucket) {
                    this.minio!.listBuckets().then((buckets) => {
                        resolve(buckets.map((bucket) => new MinioObject(bucket.name, "", false, bucket.name, undefined, this.minio)));
                    });
                } else {
                    const objects = this.minio!.listObjects(this.bucket!, this.path);
                    readToList<Minio.BucketItem>(objects).then((items) => {
                        resolve(items.map((item) => {
                            const isFile = !item.prefix && item.name ? true : false;
                            const path = isFile ? item.name : item.prefix;
                            return new MinioObject(path.substring(this.path.length), path, isFile, this.bucket, undefined, this.minio);
                        }));
                    });
                }
            } catch (err) {
                vscode.window.showWarningMessage(`Unexpected error on talking to ${this.name}: ${JSON.stringify(err)}`);
                resolve([]);
            }
        });
    }
    getTreeItem(): vscode.TreeItem {
        const item = this.file ? new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.None) :
            new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.Collapsed);
        if (this.file) {
            item.command = {
                command: "kubernetes.minioExplorer.getContent",
                title: "Get file content",
                arguments: [this]
            };
        }
        return item;
    }
}

export class MinioExplorer extends AbstractClusterExplorer<MinioObject> {
    protected name(cluster: AbstractCluster): string {
        return (cluster as Cluster).endPoint;
    }
    readonly context: vscode.ExtensionContext;

    constructor(host: Host, context: vscode.ExtensionContext) {
        super(host, context);
        this.context = context;
    }

    protected async getClusters(): Promise<MinioObject[]> {
        const rawClusters: string = this.context.globalState.get(MINIO_STATE) || "[]";
        const clusters: Cluster[] = JSON.parse(rawClusters);
        const validClusters: MinioObject[] = [];
        for (const cluster of clusters) {
            const options = cluster || {};
            try {
                const uri = vscode.Uri.parse(cluster.endPoint);
                options.endPoint = uri.authority.split(":")[0];
                if (uri.scheme === "https") {
                    options.useSSL = true;
                    options.port = 443;
                } else {
                    options.useSSL = false;
                    options.port = parseInt(uri.authority.split(":")[1] || "9000");
                }
                const client = new Minio.Client(options);
                validClusters.push(new MinioObject(cluster.endPoint, "", false, undefined, undefined, client));
            } catch (err) {
                kubernetes.log(`Skip invalid cluster: ${JSON.stringify(cluster)}(${JSON.stringify(err)})`);
            }
        }
        return Promise.resolve(validClusters);
    }

    public async removeClusters(): Promise<void> {
        return super.removeClusters(MINIO_STATE);
    }
}

// TODO add remove cluster support
export async function addExistingMinioCluster(etcdExplorer: MinioExplorer, context: vscode.ExtensionContext) {
    const endpoint = await vscode.window.showInputBox({ prompt: `Please specify endpoint of the existing cluster:`, placeHolder: `127.0.0.1:9000` });
    if (!endpoint) {
        vscode.window.showErrorMessage(`Cluster endpoint is required.`);
        return;
    }
    const credential = await vscode.window.showInputBox({ prompt: `Please specify the accesskey/secretkey:`, placeHolder: `accessKey:secretKey` });
    const secret = credential ? credential.split(":") : ["", ""];
    const state: string | undefined = context.globalState.get(MINIO_STATE);
    const clusters: Cluster[] = JSON.parse(state || "[]");
    const validClusters: Cluster[] = [];
    let exists = false;
    for (const cluster of clusters) {
        if (!cluster.endPoint) {
            continue;
        }
        if (cluster.endPoint === endpoint) {
            cluster.accessKey = secret[0];
            cluster.secretKey = secret[1];
            exists = true;
        }
        validClusters.push(cluster);
    }
    if (!exists) {
        validClusters.push({ endPoint: endpoint, accessKey: secret[0], secretKey: secret[1] });
    }
    context.globalState.update(MINIO_STATE, JSON.stringify(validClusters));
    etcdExplorer.refresh();
}

export function create(host: Host, context: vscode.ExtensionContext): MinioExplorer {
    return new MinioExplorer(host, context);
}

export async function getContent(node: MinioObject): Promise<void> {
    try {
        if (node.minio && node.bucket) {
            const value = await node.minio.getObject(node.bucket, node.path);
            if (value) {
                const buffer = await readToBuffer(value);
                vscode.workspace.openTextDocument({ language: "plaintext", content: buffer.toString() }).then((d) => {
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
