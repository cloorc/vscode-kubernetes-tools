import * as vscode from "vscode";
import { Host } from "./host";
import { AbstractClusterExplorer, AbstractObject } from "./abstractcluster";
import * as clipboard from './components/platform/clipboard';
import { fs } from "./fs";

export class FileObject implements AbstractObject<FileObject> {
    readonly name: string;
    readonly path: vscode.Uri;
    options: string | undefined;
    file: boolean = false;
    repo: string;
    branch: string;
    constructor(name: string, path: vscode.Uri, file: boolean, options: string | undefined) {
        this.name = name;
        this.path = path;
        this.file = file;
        this.options = options;
    }
    async getChildren(): Promise<FileObject[]> {
        if (this.file) {
            return [];
        }
        const files = await fs.dirSync(this.path.fsPath);
        return files.map((f) => {
            const p = vscode.Uri.joinPath(this.path, f);
            return new FileObject(f, p, !fs.statSync(p.fsPath).isDirectory(), this.options);
        });
    }
    getTreeItem(): vscode.TreeItem {
        const item = this.file ? new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.None) :
            new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.Collapsed);
        if (this.file) {
            item.command = {
                command: "vscode.open",
                title: "Open file",
                arguments: [this.path]
            };
        }
        return item;
    }

    copyPath() {
        clipboard.write(this.path.path).then(() => {
            vscode.window.showInformationMessage(`Kubernetes: copied file path ${this.path}`);
        });
    }
}

export class FileExplorer extends AbstractClusterExplorer<FileObject> {
    protected name(): string {
        return process.env.USERPROFILE || process.env.HOME || "/";
    }
    readonly context: vscode.ExtensionContext;

    constructor(host: Host, context: vscode.ExtensionContext) {
        super(host, context);
        this.context = context;
    }

    protected async getClusters(): Promise<FileObject[]> {
        const home = vscode.Uri.file(this.name());
        return Promise.resolve(fs.dirSync(this.name()).map((f) => {
            const target = vscode.Uri.joinPath(home, f);
            return new FileObject(f, target, fs.statSync(target.fsPath).isFile(), undefined);
        }));
    }
}

export function create(host: Host, context: vscode.ExtensionContext): FileExplorer {
    return new FileExplorer(host, context);
}
