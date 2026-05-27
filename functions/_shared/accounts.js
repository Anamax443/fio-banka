const DEFAULT_ACCOUNTS = {
  'ucet1': { name: 'Účet 1', tokenVar: 'TOKEN_UCET1' }
};

export function getAccounts(env) {
  if (env.ACCOUNTS_CONFIG) {
    try {
      return JSON.parse(env.ACCOUNTS_CONFIG);
    } catch {
      console.error('Invalid ACCOUNTS_CONFIG JSON, falling back to defaults');
    }
  }
  return DEFAULT_ACCOUNTS;
}
