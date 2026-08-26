import { PIVXShield } from 'pivx-shield';
import { cChainParams } from './chain_params.js';

// Canonical serialization of an empty Sapling commitment tree.
export const EMPTY_SAPLING_TREE = '000000';

/**
 * Reset a PIVXShield instance to OrganicLifeCoin's first Sapling block.
 *
 * The upstream library's closest checkpoint can be block 0 or a PIVX-only
 * checkpoint. Neither is valid for OLC: block 0 has the pre-Sapling zero root,
 * while OLC's empty Sapling tree becomes active at block 1.
 */
export function resetShieldToOLCStart(
    shield,
    startBlock = cChainParams.current.defaultStartingShieldBlock
) {
    if (!Number.isInteger(startBlock) || startBlock < 1) {
        throw new Error('Invalid OLC shield start block');
    }

    shield.lastProcessedBlock = startBlock;
    shield.commitmentTree = EMPTY_SAPLING_TREE;
    shield.unspentNotes = [];
    shield.pendingSpentNotes = new Map();
    shield.pendingUnspentNotes = new Map();
    shield.mapNullifierNote = new Map();
    return shield;
}

/**
 * Create shield keys through the upstream library, but use OLC chain state.
 */
export async function createOLCShield(options) {
    const startBlock = cChainParams.current.defaultStartingShieldBlock;
    const shield = await PIVXShield.create({
        ...options,
        blockHeight: startBlock,
    });
    return resetShieldToOLCStart(shield, startBlock);
}
