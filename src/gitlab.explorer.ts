import * as vscode from "vscode";
import { Host } from "./host";
import { BaseResourceOptions } from '@gitbeaker/requester-utils';
import { Resources } from '@gitbeaker/core';
import { Gitlab } from '@gitbeaker/node';
import { kubernetes } from "./logger";
import { AbstractCluster, AbstractClusterExplorer, AbstractObject } from "./abstractcluster";
import * as clipboard from './components/platform/clipboard';
import axios from "axios";

export const GITLAB_STATE = "ms-kubernetes-tools.vscode-kubernetes-tools.gitlab-explorer";

export interface Repository extends BaseResourceOptions<boolean> {
    host: string;
    token: string | undefined;
};

export interface GitOperator {
    defaultBranch(repo: string): Promise<string>;
    branches(repo: string): Promise<string[]>;
    tree(repo: string, branch: string, path: string): Promise<{ name: string; type: string; path: string }[]>;
    raw(repo: string, path: string, ref: string): Promise<any>;
    members(repo: string): Promise<{ username: string; id: any }[]>;
    merge(repo: string, source: string, target: string, title: string, assignee: any): Promise<{ id: any }>;
    upload(repo: string, path: string, branch: string, content: string, message: string): Promise<any>;
}

class GitLabOperator implements GitOperator {
    constructor(private git: Resources.Gitlab) { }
    upload(repo: string, path: string, branch: string, content: string, message: string): Promise<any> {
        return new Promise((resolve, reject) => {
            this.raw(repo, path, branch)
                .then(() => { this.git.RepositoryFiles.edit(repo, path, branch, content, message, { encoding: 'base64' }).then(resolve).catch(reject); })
                .catch(() => { this.git.RepositoryFiles.create(repo, path, branch, content, message, { encoding: 'base64' }).then(resolve).catch(reject); });
        });
    }

    merge(repo: string, source: string, target: string, title: string, assignee: any): Promise<{ id: any }> {
        return this.git!.MergeRequests.create(repo, source, target, title, { assigneeId: assignee });
    }

    members(repo: string): Promise<{ username: string; id: any }[]> {
        return new Promise((resolve, reject) => {
            this.git.ProjectMembers.all(repo).then(resolve).catch(reject);
        });
    }
    raw(repo: string, path: string, ref: string): Promise<any> {
        return new Promise((resolve, reject) => {
            this.git.RepositoryFiles.showRaw(repo, path, { ref }).then(resolve).catch(reject);
        });
    }

    tree(repo: string, _: string, path: string): Promise<{ name: string; type: string; path: string }[]> {
        return new Promise((resolve, reject) => {
            this.git.Repositories.tree(repo, { path: path, perPage: 1000 }).then(resolve).catch(reject);
        });
    }

    defaultBranch(repo: string): Promise<string> {
        return new Promise((resolve, reject) => {
            this.git.Projects.show(repo)
                .then((project) => resolve(project.default_branch || 'master'))
                .catch(reject);
        });
    }
    branches(repo: string): Promise<string[]> {
        return new Promise((resolve, reject) => {
            this.git.Branches.all(repo)
                .then((branches) => resolve(branches.map((b) => b.name)))
                .catch(reject);
        });
    }
}

class GiteeOperator implements GitOperator {
    constructor(private token: string) { }

    upload(repo: string, path: string, branch: string, content: string, message: string): Promise<any> {
        return new Promise((resolve, reject) => {
            axios.get(`https://gitee.com/api/v5/repos/${repo}/contents/${encodeURIComponent(path)}?access_token=${this.token}&ref=${branch}`)
                .then((info) => {
                    if (info.data.sha) {
                        axios.put(`https://gitee.com/api/v5/repos/${repo}/contents/${encodeURIComponent(path)}`,
                            // eslint-disable-next-line quote-props
                            { 'access_token': this.token, content, message, sha: info.data.sha })
                            .then(resolve).catch(reject);
                    } else {
                        axios.post(`https://gitee.com/api/v5/repos/${repo}/contents/${encodeURIComponent(path)}`,
                            // eslint-disable-next-line quote-props
                            { 'access_token': this.token, content, message, branch })
                            .then(resolve).catch(reject);
                    }
                })
        });
    }

    defaultBranch(repo: string): Promise<string> {
        return new Promise((resolve, reject) => {
            axios.get(`https://gitee.com/api/v5/repos/${repo}?access_token=${this.token}`)
                .then((res) => resolve(res.data.default_branch))
                .catch(reject);
        });
    }
    branches(repo: string): Promise<string[]> {
        return new Promise((resolve, reject) => {
            axios.get(`https://gitee.com/api/v5/repos/${repo}/branches?access_token=${this.token}`)
                .then((res) => resolve(res.data.map((b: any) => b.name)))
                .catch(reject);
        });
    }
    tree(repo: string, branch: string, path: string): Promise<{ name: string; type: string; path: string }[]> {
        path = path.startsWith('/') ? path.substring(1) : path;
        return new Promise((resolve, reject) => {
            axios.get(`https://gitee.com/api/v5/repos/${repo}/git/trees/${branch}?access_token=${this.token}&recursive=1`)
                .then((res) => resolve(res.data.tree.map((b: any) => {
                    b.name = b.path.substring(b.path.lastIndexOf("/") + 1);
                    return b;
                }).filter((f: any) => {
                    return f.path !== path && f.path.startsWith(path) && f.path.substring(path.length + 1).indexOf("/") < 0;
                })))
                .catch(reject);
        });
    }
    raw(repo: string, path: string, ref: string): Promise<any> {
        return new Promise((resolve, reject) => {
            axios.get(`https://gitee.com/api/v5/repos/${repo}/contents/${encodeURIComponent(path)}?access_token=${this.token}&ref=${ref}`)
                .then((res) => resolve(Buffer.from(res.data.content, 'base64').toString()))
                .catch(reject);
        });
    }
    members(repo: string): Promise<{ username: string; id: any }[]> {
        return new Promise((resolve, reject) => {
            axios.get(`https://gitee.com/api/v5/repos/${repo}/collaborators?access_token=${this.token}&page=1&per_page=100`)
                .then((res) => resolve(res.data))
                .catch(reject);
        });
    }
    merge(_repo: string, _source: string, _target: string, _title: string, _assignee: any): Promise<{ id: any }> {
        throw new Error("Method not implemented.");
    }
}

export class GitObject implements AbstractObject<GitObject> {
    readonly name: string;
    readonly path: string;
    options: string | undefined;
    git: GitOperator | undefined;
    file: boolean = false;
    repo: string;
    branch: string;
    readonly token: string | undefined;
    constructor(name: string, repo: string, path: string, file: boolean,
        branch: string, token: string | undefined, options: string | undefined,
        gitlab: GitOperator | undefined) {
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
        this.git = gitlab;
        if (this.options && !this.git) {
            const opts = JSON.parse(this.options);
            this.git = 'https://gitee.com' === opts.host ? new GiteeOperator(this.token!) :
                new GitLabOperator(new Gitlab(opts));
        }
    }
    async getChildren(): Promise<GitObject[]> {
        if (this.file) {
            return [];
        }
        const files = await this.git!.tree(this.repo, this.branch, this.path);
        return files.map((f) => new GitObject(f.name, this.repo, f.path, 'blob' === f.type,
            this.branch, this.token, this.options, this.git));
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
            item.contextValue = "vskubernetes/gitlab/file";
        } else if (this.path === "/") {
            item.contextValue = "vskubernetes/gitlab/repo";
        } else {
            item.contextValue = "vskubernetes/gitlab/folder";
        }
        return item;
    }

    copyPath() {
        clipboard.write(this.path).then(() => {
            vscode.window.showInformationMessage(`Kubernetes: copied gitlab object path ${this.path}`);
        });
    }

    copyName() {
        clipboard.write(this.name).then(() => {
            vscode.window.showInformationMessage(`Kubernetes: copied gitlab object name ${this.name}`);
        });
    }

    async createMergeRequest(): Promise<void> {
        const branches = await this.git!.branches(this.repo);
        const sourceBranch = await vscode.window.showQuickPick(branches, { title: `Please specify the source branch:`, placeHolder: this.branch, canPickMany: false });
        const targetBranch = await vscode.window.showQuickPick(branches, { title: `Please specify the target branch:`, canPickMany: false });
        if (sourceBranch && targetBranch) {
            const assignees = await this.git!.members(this.repo);
            const username = await vscode.window.showQuickPick(assignees.map((a) => a.username), { title: `Please specify the assignee:` });
            const assignee = assignees.filter((a) => a.username === username)[0];
            if (assignee) {
                this.git!.merge(this.repo, sourceBranch, targetBranch,
                    `New merge request from Visual Studio Code - Kubernetes`, assignee).then((res) => {
                        vscode.window.showInformationMessage(`Merge request created successfully: ${res.id}`);
                    }).catch((err) => {
                        vscode.window.showWarningMessage(`Unable to create merge request: ${err}`);
                    });
            } else {
                vscode.window.showWarningMessage(`Missing assignee, which is requred.`);
            }
        } else {
            vscode.window.showWarningMessage(`Missing target or source branch, which is requred.`);
        }
    }
}

export class GitExplorer extends AbstractClusterExplorer<GitObject> {
    protected name(cluster: AbstractCluster): string {
        return (cluster as Repository).host.match(/https?:\/\/[^\/]+\/(.*)/)![1];
    }
    readonly context: vscode.ExtensionContext;

    constructor(host: Host, context: vscode.ExtensionContext) {
        super(host, context);
        this.context = context;
    }

    protected async getClusters(): Promise<GitObject[]> {
        const rawClusters: string = this.context.globalState.get(GITLAB_STATE) || "[]";
        const clusters: Repository[] = JSON.parse(rawClusters);
        const validClusters: GitObject[] = [];
        for (const cluster of clusters) {
            const options = cluster || {};
            try {
                const uri = vscode.Uri.parse(options.host);
                const repo = uri.path.substring(1);
                const host = `${uri.scheme}://${uri.authority}`;
                const client = uri.authority === 'gitee.com' ? new GiteeOperator(options.token!) :
                    new GitLabOperator(new Gitlab({
                        ...options,
                        host,
                        version: 4
                    }));
                const branch = await client.defaultBranch(repo);
                validClusters.push(new GitObject(cluster.host.substring(host.length + 1), repo, "/",
                    false, branch || "master", undefined, undefined, client));
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
                const client = uri.authority === 'gitee.com' ? new GiteeOperator(cluster.token!) : new GitLabOperator(new Gitlab({
                    ...cluster,
                    host: `${uri.scheme}://${uri.authority}`,
                    version: 4
                }));
                const defaultBranch = await client.defaultBranch(repo);
                const branches = await client!.branches(repo);
                const branch = await vscode.window.showQuickPick(branches, {
                    title: `Please specify the target branch:`, placeHolder: defaultBranch || "master", canPickMany: false
                });
                if (branch) {
                    client.upload(repo, path, branch, content, "Submit from kubernetes gitlab explorer").then(() => {
                        vscode.window.showInformationMessage(`Kubectl GitLab: content has been committed successfully.`);
                    }).catch((err) => {
                        vscode.window.showInformationMessage(`Kubectl GitLab: content hasn't been committed ${err}`);
                    });
                } else {
                    vscode.window.showInformationMessage(`Kubectl: invalid target branch ${branch}.`);
                }
            }
        } else {
            vscode.window.showInformationMessage(`Kubectl: cluster not selected.`);
        }
    }
}

export async function addExistingGitLabRepository(etcdExplorer: GitExplorer, context: vscode.ExtensionContext) {
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

export function create(host: Host, context: vscode.ExtensionContext): GitExplorer {
    return new GitExplorer(host, context);
}

export async function getContent(node: GitObject): Promise<void> {
    try {
        if (node.git) {
            const value = await node.git.raw(node.repo, node.path, node.branch);
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
                        case "yml":
                        case "YAML":
                        case "YML":
                            language = "yaml";
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
