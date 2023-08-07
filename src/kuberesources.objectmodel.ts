export interface KubernetesResource {
    readonly kind: string;
    readonly metadata: ObjectMeta;
}

export interface KubernetesCollection<T extends KubernetesResource> {
    readonly items: T[];
}

export interface ObjectMeta {
    readonly name: string;
    readonly namespace: string;
    readonly labels?: KeyValuePairs;
}

export interface KeyValuePairs {
    [key: string]: string;
}

export interface DataResource extends KubernetesResource {
    readonly data: KeyValuePairs;
}

export interface Namespace extends KubernetesResource {
}

export interface LivenessProbeHttpGet {
    readonly path: string;
    readonly port: number;
    readonly scheme: string;
}

export interface LivenessProbe {
    readonly httpGet: LivenessProbeHttpGet;
}

export interface Container {
    readonly name: string;
    readonly image: string;
    readonly livenessProbe?: LivenessProbe;
    readonly initContainer: boolean;
}

export interface Pod extends KubernetesResource {
    readonly spec: PodSpec;
    readonly status: PodStatus;
}

export interface Node extends KubernetesResource {
}

export interface PodSpec {
    readonly containers: Container[];
    readonly nodeName: string;
}

export interface PodStatus {
    readonly podIP: string;
    readonly phase: string;
    readonly containerStatuses: ContainerStatus[];
}

export interface ContainerStatus {
    readonly ready: boolean;
    readonly state: {
        readonly running: undefined | {
            readonly startedAt: string;
        };
    };
}

export interface Secret extends KubernetesResource {
    readonly type: string;
    readonly data: {
        release: string;
    };
}

function isObjectMeta(obj: any): obj is ObjectMeta {
    return obj && obj.name;
}

export function isKubernetesResource(obj: any): obj is KubernetesResource {
    return obj && obj.kind && isObjectMeta(obj.metadata);
}

export function isPod(obj: any): obj is Pod {
    return isKubernetesResource(obj) && obj.kind === 'Pod';
}
