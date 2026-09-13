import english from '../../locale/en/pq.toml';

export const translation = Object.freeze({ ...english });

export function tr(message, variables = []) {
    let result = message || '';
    for (const variable of variables) {
        const [key, value] = Object.entries(variable)[0] || [];
        if (key !== undefined) result = result.replaceAll(`{${key}}`, value);
    }
    return result;
}
