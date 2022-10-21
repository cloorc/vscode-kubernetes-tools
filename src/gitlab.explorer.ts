import * as vscode from "vscode";
import { Host } from "./host";
import { BaseResourceOptions } from '@gitbeaker/requester-utils';
import { Resources } from '@gitbeaker/core';
import { Gitlab } from '@gitbeaker/node';
import { kubernetes } from "./logger";
import { AbstractCluster, AbstractClusterExplorer, AbstractObject } from "./abstractcluster";

export const GITLAB_STATE = "ms-kubernetes-tools.vscode-kubernetes-tools.gitlab-explorer";

export interface Repository extends BaseResourceOptions<boolean> {
    host: string;
    token: string | undefined;
};

export class GitLabObject implements AbstractObject<GitLabObject> {
    readonly name: string;
    readonly path: string;
    options: string | undefined;
    gitlab: Resources.Gitlab | undefined;
    file: boolean = false;
    repo: string;
    readonly token: string | undefined;
    readonly project: number;
    constructor(name: string, repo: string, path: string, file: boolean, token: string | undefined, options: string | undefined, gitlab: Resources.Gitlab | undefined) {
        if (!options && !gitlab) {
            throw new Error(`Options or gitlab should be provided at least one.`);
        }
        this.name = name;
        this.repo = repo;
        this.path = path;
        this.file = file;
        this.options = options;
        this.token = token;
        this.gitlab = gitlab;
        if (this.options && !this.gitlab) {
            this.gitlab = new Gitlab(JSON.parse(this.options));
        }
    }
    async getChildren(): Promise<GitLabObject[]> {
        if (this.file) {
            return [];
        }
        const files = await this.gitlab!.Repositories.tree(this.repo, { path: this.path, perPage: 1000 });
        return files.map((f) => new GitLabObject(f.name, this.repo, f.path, 'blob' === f.type, this.token, this.options, this.gitlab));
    }
    getTreeItem(): vscode.TreeItem {
        const item = this.file ? new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.None) :
            new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.Collapsed);
        if (this.file) {
            item.contextValue = "gitlabfile";
        } else {
            item.contextValue = "gitlabfolder";
        }
        return item;
    }
}

export class GitLabExplorer extends AbstractClusterExplorer<GitLabObject> {
    protected name(cluster: AbstractCluster): string {
        return (cluster as Repository).host;
    }
    readonly context: vscode.ExtensionContext;

    constructor(host: Host, context: vscode.ExtensionContext) {
        super(host, context);
        this.context = context;
    }

    protected async getClusters(): Promise<GitLabObject[]> {
        const rawClusters: string = this.context.globalState.get(GITLAB_STATE) || "[]";
        const clusters: Repository[] = JSON.parse(rawClusters);
        const validClusters: GitLabObject[] = [];
        for (const cluster of clusters) {
            const options = cluster || {};
            try {
                const uri = vscode.Uri.parse(options.host);
                const client = new Gitlab({
                    ...options,
                    host: `${uri.scheme}://${uri.authority}`,
                    version: 4
                });
                validClusters.push(new GitLabObject(cluster.host, uri.path.substring(1), "/", false, undefined, undefined, client));
            } catch (err) {
                kubernetes.log(`Skip invalid cluster: ${JSON.stringify(cluster)}(${JSON.stringify(err)})`);
            }
        }
        return Promise.resolve(validClusters);
    }

    public async removeClusters(): Promise<void> {
        return super.removeClusters(GITLAB_STATE);
    }
}

export async function addExistingGitLabRepository(etcdExplorer: GitLabExplorer, context: vscode.ExtensionContext) {
    const endpoint = await vscode.window.showInputBox({
        prompt: `Please specify the URL of GitLab repository:`,
        placeHolder: `https://gitlab.com/group/repository`
    });
    if (!endpoint) {
        vscode.window.showErrorMessage(`Repository URL is required.`);
        return;
    }
    const token = await vscode.window.showInputBox({ prompt: `Please specify the token:`, placeHolder: `` });
    const state: string | undefined = context.globalState.get(GITLAB_STATE);
    const clusters: Repository[] = JSON.parse(state || "[]");
    const validClusters: Repository[] = [];
    let exists = false;
    for (const cluster of clusters) {
        if (!cluster.host) {
            continue;
        }
        if (cluster.host === endpoint) {
            cluster.token = token;
            exists = true;
        }
        validClusters.push(cluster);
    }
    if (!exists) {
        validClusters.push({ host: endpoint, token: token });
    }
    context.globalState.update(GITLAB_STATE, JSON.stringify(validClusters));
    etcdExplorer.refresh();
}

export function create(host: Host, context: vscode.ExtensionContext): GitLabExplorer {
    return new GitLabExplorer(host, context);
}

export async function getContent(node: GitLabObject): Promise<void> {
    try {
        if (node.gitlab) {
            const value = await node.gitlab.RepositoryFiles.showRaw(node.repo, node.path);
            if (value) {
                vscode.workspace.openTextDocument({ language: "plaintext", content: value }).then((d) => {
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
