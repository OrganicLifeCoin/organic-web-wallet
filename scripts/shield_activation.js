export function isShieldFeatureActive(chainTip, defaultStartingShieldBlock) {
    if (!Number.isFinite(defaultStartingShieldBlock)) {
        return true;
    }

    if (!Number.isFinite(chainTip)) {
        return false;
    }

    return chainTip >= defaultStartingShieldBlock;
}

export function resolveShieldModeSelection(
    requestedPublicMode,
    chainTip,
    defaultStartingShieldBlock
) {
    if (
        requestedPublicMode === false &&
        !isShieldFeatureActive(chainTip, defaultStartingShieldBlock)
    ) {
        return true;
    }

    return requestedPublicMode;
}
