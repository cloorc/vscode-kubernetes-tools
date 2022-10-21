import * as vscode from "vscode";
import { Host } from "./host";
import { BaseResourceOptions } from '@gitbeaker/requester-utils';
import { Resources } from '@gitbeaker/core';
import { Gitlab } from '@gitbeaker/node';
import { kubernetes } from "./logger";
import { AbstractCluster, AbstractClusterExplorer, AbstractObject } from "./abstractcluster";
import * as clipboard from './components/platform/clipboard';

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
    branch: string;
    readonly token: string | undefined;
    readonly project: number;
    constructor(name: string, repo: string, path: string, file: boolean,
        branch: string, token: string | undefined, options: string | undefined,
        gitlab: Resources.Gitlab | undefined) {
        if (!options && !gitlab) {
            throw new Error(`Options or gitlab should be provided at least one.`);
        }
        this.name = name;
        this.repo = repo;
        this.path = path;
        this.file = file;
        this.options = options;
        this.branch = branch;
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
        return files.map((f) => new GitLabObject(f.name, this.repo, f.path, 'blob' === f.type,
            this.branch, this.token, this.options, this.gitlab));
    }
    getTreeItem(): vscode.TreeItem {
        const item = this.file ? new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.None) :
            new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.Collapsed);
        if (this.file) {
            item.command = {
                command: "kubernetes.gitlabExplorer.getContent",
                title: "Get the file content",
                arguments: [this]
            };
            item.contextValue = "gitlabfile";
        } else {
            item.contextValue = "gitlabfolder";
        }
        return item;
    }

    copyPath() {
        clipboard.write(this.path).then(() => {
            vscode.window.showInformationMessage(`Kubernetes: copied gitlab object path ${this.path}`);
        });
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
                const repo = uri.path.substring(1);
                const client = new Gitlab({
                    ...options,
                    host: `${uri.scheme}://${uri.authority}`,
                    version: 4
                });
                const project = await client.Projects.show(repo);
                validClusters.push(new GitLabObject(cluster.host, repo, "/",
                    false, project.default_branch || "master", undefined, undefined, client));
            } catch (err) {
                kubernetes.log(`Skip invalid cluster: ${JSON.stringify(cluster)}(${JSON.stringify(err)})`);
            }
        }
        return Promise.resolve(validClusters);
    }

    public async removeClusters(): Promise<void> {
        return super.removeClusters(GITLAB_STATE);
    }

    public async submitContentToRepository(): Promise<void> {
        const rawClusters: string = this.context.globalState.get(GITLAB_STATE) || "[]";
        const clusters: Repository[] = JSON.parse(rawClusters);
        const text = await vscode.window.showQuickPick(clusters.map((c) => c.host), { canPickMany: false });
        const cluster = clusters.filter((c) => text === c.host)[0];
        if (cluster) {
            const path = await vscode.window.showInputBox({ title: `Please specify file path and name:` });
            if (path) {
                const content = Buffer.from(await vscode.window.activeTextEditor?.document.getText() || "").toString("base64");
                const uri = vscode.Uri.parse(cluster.host);
                const repo = uri.path.substring(1);
                const client = new Gitlab({
                    ...cluster,
                    host: `${uri.scheme}://${uri.authority}`,
                    version: 4
                });
                const project = await client.Projects.show(repo);
                const branch = project.default_branch || "master";
                client.RepositoryFiles.show(repo, path, branch, undefined).then((_) => {
                    client.RepositoryFiles.edit(repo, path, branch, content, "Submit from kubernetes gitlab explorer",
                        { encoding: "base64" });
                }).catch((_) => {
                    client.RepositoryFiles.create(repo, path, branch, content, "Submit from kubernetes gitlab explorer",
                        { encoding: "base64" });
                });
            }
        } else {
            vscode.window.showInformationMessage(`Kubectl: cluster not selected.`);
        }
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
                let language = "plaintext";
                const extension = (node.path.match(/.*\.([^.]+)/) || [])[1];
                if (extension) {
                    switch (extension.toLowerCase()) {
                        case "md":
                            language = "markdown";
                            break;
                        case "abap":
                            language = "abap";
                            break;
                        case "bibtex":
                            language = "bibtex";
                            break;
                        case "coffeescript":
                            language = "coffeescript";
                            break;
                        case "csharp":
                            language = "csharp";
                            break;
                        case "cuda-cpp":
                            language = "cuda-cpp";
                            break;
                        case "dockerfile":
                            language = "dockerfile";
                            break;
                        case "fsharp":
                            language = "fsharp";
                            break;
                        case "git-commit":
                            language = "git-commit";
                            break;
                        case "git-rebase":
                            language = "git-rebase";
                            break;
                        case "groovy":
                            language = "groovy";
                            break;
                        case "handlebars":
                            language = "handlebars";
                            break;
                        case "haml":
                            language = "haml";
                            break;
                        case "javascript":
                            language = "javascript";
                            break;
                        case "javascriptreact":
                            language = "javascriptreact";
                            break;
                        case "jsonc":
                            language = "jsonc";
                            break;
                        case "latex":
                            language = "latex";
                            break;
                        case "makefile":
                            language = "makefile";
                            break;
                        case "objective-c":
                            language = "objective-c";
                            break;
                        case "objective-cpp":
                            language = "objective-cpp";
                            break;
                        case "powershell":
                            language = "powershell";
                            break;
                        case "jade,":
                            language = "jade,";
                            break;
                        case "pug":
                            language = "pug";
                            break;
                        case "python":
                            language = "python";
                            break;
                        case "razor":
                            language = "razor";
                            break;
                        case "ruby":
                            language = "ruby";
                            break;
                        case "rust":
                            language = "rust";
                            break;
                        case "shaderlab":
                            language = "shaderlab";
                            break;
                        case "shellscript":
                            language = "shellscript";
                            break;
                        case "slim":
                            language = "slim";
                            break;
                        case "stylus":
                            language = "stylus";
                            break;
                        case "typescript":
                            language = "typescript";
                            break;
                        case "typescriptreact":
                            language = "typescriptreact";
                            break;
                        case "vue-html":
                            language = "vue-html";
                            break;
                        default:
                            language = extension.toLowerCase();
                            break;
                    }
                }
                vscode.workspace.openTextDocument({ language, content: value }).then((d) => {
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
