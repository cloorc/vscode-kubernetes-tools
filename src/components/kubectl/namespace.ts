import { refreshExplorer } from '../clusterprovider/common/explorer';
import { promptKindName, quickPickKindName } from '../../extension';
import { host } from '../../host';
import * as kubectlUtils from '../../kubectlUtils';
import * as kuberesources from '../../kuberesources';
import { Kubectl } from '../../kubectl';
import { ClusterExplorerNode } from '../clusterexplorer/node';
import { NODE_TYPES } from '../clusterexplorer/explorer';


export async function useNamespaceKubernetes(kubectl: Kubectl, explorerNode: ClusterExplorerNode, options: { preferPick: boolean }) {
    if (explorerNode && explorerNode.nodeType === NODE_TYPES.resource) {
        if (await kubectlUtils.switchNamespace(kubectl, explorerNode.name)) {
            refreshExplorer();
            host.showInformationMessage(`Switched to namespace ${explorerNode.name}`);
            return;
        }
    }

    const currentNS = await kubectlUtils.currentNamespace(kubectl);
    const resourceKind = [kuberesources.allKinds.namespace];
    const interactiveOptions = {
        prompt: 'What namespace do you want to use?',
        placeHolder: 'Enter the namespace to switch to or press enter to select from available list',
        filterNames: [currentNS]
    };
    const kindName = options.preferPick ? await quickPickKindName(resourceKind, interactiveOptions) : await promptKindName(
        resourceKind,
        '',  // unused because options specify prompt
        interactiveOptions
    );

    if (kindName) {
        switchToNamespace(kubectl, currentNS, kindName);
    }
}

async function switchToNamespace(kubectl: Kubectl, currentNS: string, resource: string) {
    if (!resource) {
        return;
    }

    let toSwitchNamespace = resource;
    // resource will be of format <kind>/<name>, when picked up from the quickpick
    if (toSwitchNamespace.lastIndexOf('/') !== -1) {
        toSwitchNamespace = toSwitchNamespace.substring(toSwitchNamespace.lastIndexOf('/') + 1);
    }

    // Switch if an only if the currentNS and toSwitchNamespace are different
    if (toSwitchNamespace && currentNS !== toSwitchNamespace) {
        if (await kubectlUtils.switchNamespace(kubectl, toSwitchNamespace)) {
            refreshExplorer();
            host.showInformationMessage(`Switched to namespace ${toSwitchNamespace}`);
        }
    }
}
