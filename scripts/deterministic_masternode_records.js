const PUBLIC_RECORD_FIELDS = [
    'id',
    'alias',
    'ip',
    'port',
    'collateralAddress',
    'collateralPath',
    'collateralTxId',
    'collateralIndex',
    'ownerAddress',
    'votingAddress',
    'payoutAddress',
    'operatorPublicKey',
    'proTxHash',
    'state',
    'createdAt',
    'withdrawalTxId',
];

export function sanitizeMasternodeRecords(records) {
    if (!Array.isArray(records)) return [];
    return records
        .filter((record) => record && typeof record === 'object')
        .map((record) => {
            const sanitized = {};
            for (const field of PUBLIC_RECORD_FIELDS) {
                if (record[field] !== undefined) {
                    sanitized[field] = record[field];
                }
            }
            return sanitized;
        });
}
