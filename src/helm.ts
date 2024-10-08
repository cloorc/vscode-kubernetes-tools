export const PREVIEW_SCHEME = 'helm-template-preview';
export const PREVIEW_URI = PREVIEW_SCHEME + '://preview';
export const INSPECT_VALUES_SCHEME = 'helm-inspect-values';
export const INSPECT_CHART_SCHEME = 'helm-inspect-chart';
export const INSPECT_REPO_AUTHORITY = 'repo-chart';
export const INSPECT_FILE_AUTHORITY = 'chart-file';
export const DEPENDENCIES_SCHEME = 'helm-dependencies';
export const DEPENDENCIES_REPO_AUTHORITY = 'repo-chart';
export const FETCH_VALUES_SCHEME = "helm-get-values";
export const HELM_OUTPUT_COLUMN_SEPARATOR = /\t+/g;
export const HELM_VALUES_SCHEMA = 'helm-values';

export const HELM_ANNOTATION_RESOURCE_POLICY = 'helm.sh/resource-policy';
export const HELM_ANNOTATION_RELEASE_NAME = "meta.helm.sh/release-name";
export const HELM_ANNOTATION_RELEASE_NAMESPACE = "meta.helm.sh/release-namespace";

let previewShown = false;

export function hasPreviewBeenShown(): boolean {
    return previewShown;
}

export function recordPreviewHasBeenShown(): void {
    previewShown = true;
}
