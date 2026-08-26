import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const governanceSource = readFileSync(
    resolve(process.cwd(), 'scripts/governance/Governance.vue'),
    'utf8'
);
const masternodeSource = readFileSync(
    resolve(process.cwd(), 'scripts/masternode/Masternode.vue'),
    'utf8'
);

function getSetupBlock(source, hookName) {
    const match = source.match(
        new RegExp(`${hookName}\\(\\(\\) => \\{([\\s\\S]*?)\\n\\}\\);`)
    );
    return match?.[1] ?? '';
}

describe('startup fetch guards', () => {
    it('avoids eager governance fetches before the tab is used', () => {
        const onMountedBlock = getSetupBlock(governanceSource, 'onMounted');
        expect(governanceSource).toContain('hasOpenedGovernance');
        expect(onMountedBlock).not.toContain('fetchProposals();');
    });

    it('avoids eager masternode fetches before the tab is used', () => {
        const onMountedBlock = getSetupBlock(masternodeSource, 'onMounted');
        expect(onMountedBlock).not.toContain('getMasternodes');
        expect(onMountedBlock).not.toContain('getMasternodeInfo');
    });
});
