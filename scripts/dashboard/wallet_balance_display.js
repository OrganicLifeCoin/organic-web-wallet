export function getEffectivePublicMode({
    shieldEnabled,
    publicMode,
    balance,
    shieldBalance,
}) {
    if (!shieldEnabled) return true;

    const hasPublicFunds = balance > 0;
    const hasShieldFunds = shieldBalance > 0;

    if (hasPublicFunds && !hasShieldFunds) return true;
    if (!hasPublicFunds && hasShieldFunds) return false;

    return publicMode;
}
